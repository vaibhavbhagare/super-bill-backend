const Invoice = require("../models/Invoice");
const Product = require("../models/Product");
const Customer = require("../models/Customer");
const ProductStats = require("../models/ProductStats");
const Order = require("../models/Order");
const whatsappService = require("./whatsappService");
const { canAccess } = require("../access/accessControl");
const { Features } = require("../access/features");

const normalizeProductId = (ref) => {
  if (ref == null) return null;
  if (typeof ref === "object") {
    if (ref._id != null) return String(ref._id);
    if (ref.id != null) return String(ref.id);
    if (typeof ref.toString === "function") {
      const asString = ref.toString();
      if (/^[a-f\d]{24}$/i.test(asString)) return asString;
    }
  }
  const value = String(ref).trim();
  if (!value || value === "[object Object]") return null;
  return value;
};

/** Stock updates use updateOne; bump updatedAt so incremental sync picks them up. */
async function adjustProductStock(productId, delta) {
  if (!delta) return;
  await Product.updateOne(
    { _id: productId },
    { $inc: { stock: delta }, $set: { updatedAt: new Date() } },
  );
}

// Create Invoice
exports.createInvoice = async (req, res) => {
  try {
    const {
      buyingProducts,
      customer,
      billingSummary,
      billerId,
      billerName,
      sendWhatsappMessage,
      transactionType,
      paymentStatus,
      paidAmount: paidAmountInput,
      channel = "POS",
      createdBy,
      updatedBy,
    } = req.body;

    const billTotal = Number(billingSummary?.subtotal ?? 0);
    let paidAmount = 0;
    let unpaidAmount = 0;

    if (paymentStatus === "PAID") {
      paidAmount = billTotal;
      unpaidAmount = 0;
    } else {
      paidAmount = Math.min(
        Math.max(0, Number(paidAmountInput ?? 0)),
        billTotal,
      );
      unpaidAmount = billTotal - paidAmount;
    }

    // Generate invoice number: MON-INV-XXXX (e.g., JUL-INV-0023)
    const monthNames = [
      "JAN",
      "FEB",
      "MAR",
      "APR",
      "MAY",
      "JUN",
      "JUL",
      "AUG",
      "SEP",
      "OCT",
      "NOV",
      "DEC",
    ];
    const now = new Date();
    const month = monthNames[now.getMonth()];
    const billerShortName = billerName.slice(0, 3).toUpperCase() || "INV";
    // Add date-time components to the prefix to avoid collisions (DDMMHHmmss)
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const seconds = String(now.getSeconds()).padStart(2, "0");

    const prefix = `${month}-${billerShortName}-${hours}${minutes}${seconds}-`;
    // Find the max invoiceNumber for this month
    const lastInvoice = await Invoice.findOne(
      { invoiceNumber: { $regex: `^${prefix}\\d{4}$` } },
      {},
      { sort: { invoiceNumber: -1 } }
    );
    let nextNumber = 1;
    if (lastInvoice && lastInvoice.invoiceNumber) {
      // const match = lastInvoice.invoiceNumber.match(/(\\d{4})$/);
      const match = lastInvoice.invoiceNumber.match(/(\d{4})$/);
      if (match) {
        nextNumber = parseInt(match[1], 10) + 1;
      }
    }
    const invoiceNumber = `${prefix}${String(nextNumber).padStart(4, "0")}`;

    // Check stock for each product and populate purchasePrice
    const enrichedBuyingProducts = [];
    for (const item of buyingProducts) {
      const product = await Product.findById(item.product);
      if (!product) {
        return res
          .status(404)
          .json({ error: `Product not found: ${item.product}` });
      }
      
      // 👇 Convert to numbers to avoid string math bugs
      const currentStock = Number(product.stock || 0);
      const orderedQty = Number(item.quantity || 0);

      const newStock =
        currentStock >= orderedQty ? currentStock - orderedQty : 0;

      await Product.updateOne(
        { _id: product._id },
        { $set: { stock: newStock, updatedAt: new Date() } },
      );

      // Add purchasePrice to the enriched product data
      enrichedBuyingProducts.push({
        ...item,
        purchasePrice: Number(product.purchasePrice || 0), // Save historical purchase price
      });
    }
    // Decrement stock

    // Try to create invoice
    try {
      const invoice = new Invoice({
        buyingProducts: enrichedBuyingProducts,
        customer,
        billingSummary,
        billerId,
        billerName,
        sendWhatsappMessage,
        transactionType,
        invoiceNumber,
        paymentStatus,
        paidAmount,
        unpaidAmount,
        channel,
        createdBy,
        updatedBy,
      });
      await invoice.save();

      // Upsert product stats for reporting
      const nowTs = new Date();
      if (Array.isArray(enrichedBuyingProducts) && enrichedBuyingProducts.length) {
        const ops = enrichedBuyingProducts.map((item) => ({
          updateOne: {
            filter: { product: item.product },
            update: {
              $setOnInsert: { product: item.product },
              $inc: {
                totalUnitsSold: Number(item.quantity || 0),
                totalTimesSold: 1,
                ...(channel === "POS"
                  ? {
                      posUnitsSold: Number(item.quantity || 0),
                      posTimesSold: 1,
                    }
                  : {
                      onlineUnitsSold: Number(item.quantity || 0),
                      onlineTimesSold: 1,
                    }),
              },
              $set: { lastSoldAt: nowTs, lastInvoice: invoice._id },
            },
            upsert: true,
          },
        }));
        await ProductStats.bulkWrite(ops);
      }

      const customerData = await Customer.findById(customer);

      if (!customerData) {
        return res.status(404).json({ error: "Customer not found" });
      }
      const canSendWhatsapp = canAccess(
        {
          role: req.user?.role,
          subscriptionTier: req.store?.subscriptionTier,
          featureOverrides: req.store?.featureOverrides,
        },
        Features.INVOICE_WHATSAPP,
      );
      if (
        sendWhatsappMessage &&
        canSendWhatsapp &&
        customerData.phoneNumber !== 9764384901
      ) {
        whatsappService.sendWhatsAppMessageTwilioShortInvoice(invoice, customerData);
      }
      res.status(201).json(invoice);
    } catch (err) {
      if (
        err.code === 11000 &&
        err.keyPattern &&
        err.keyPattern.invoiceNumber
      ) {
        // Duplicate invoiceNumber, try again
        return res.status(500).json({
          error:
            "Failed to generate unique invoice number after multiple attempts.",
        });
      } else {
        throw err;
      }
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get invoice by ID
exports.getInvoiceById = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id)
      .populate("customer")
      .populate({
        path: "buyingProducts.product",
        select: "-purchasePrice",
      });
    if (!invoice) return res.status(404).json({ error: "Invoice not found" });
    res.json(invoice);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Update invoice — adjust line items and sync product stock
exports.updateInvoice = async (req, res) => {
  try {
    const invoiceId = req.params.id;
    const {
      buyingProducts,
      billingSummary,
      paymentStatus,
      transactionType,
      paidAmount: paidAmountInput,
      updatedBy,
    } = req.body;

    const existing = await Invoice.findById(invoiceId);
    if (!existing || existing.deletedAt) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    if (!Array.isArray(buyingProducts) || buyingProducts.length === 0) {
      return res.status(400).json({ error: "At least one product is required" });
    }

    const oldQtyMap = new Map();
    for (const item of existing.buyingProducts || []) {
      const pid = normalizeProductId(item.product);
      if (!pid) continue;
      oldQtyMap.set(pid, (oldQtyMap.get(pid) || 0) + Number(item.quantity || 0));
    }

    const enrichedBuyingProducts = [];
    const newQtyMap = new Map();

    for (const item of buyingProducts) {
      const productId = normalizeProductId(item.product ?? item._id);
      if (!productId) {
        return res.status(400).json({ error: "Each line item must include product id" });
      }

      const product = await Product.findById(productId);
      if (!product) {
        return res.status(404).json({ error: `Product not found: ${productId}` });
      }

      const qty = Number(item.quantity || 0);
      if (qty <= 0) {
        return res.status(400).json({ error: "Product quantity must be greater than 0" });
      }

      const price = Number(item.price ?? item.sellingPrice1 ?? 0);
      const mrp = Number(item.mrp ?? product.mrp ?? 0);

      enrichedBuyingProducts.push({
        product: product._id,
        name: item.name || product.name,
        secondName: item.secondName || product.secondName || "",
        quantity: qty,
        price,
        purchasePrice: Number(item.purchasePrice ?? product.purchasePrice ?? 0),
        mrp,
        discount: Math.max(0, mrp - price),
        subtotal: qty * price,
      });

      newQtyMap.set(productId, (newQtyMap.get(productId) || 0) + qty);
    }

    const allProductIds = new Set([...oldQtyMap.keys(), ...newQtyMap.keys()]);
    for (const pid of allProductIds) {
      const oldQty = oldQtyMap.get(pid) || 0;
      const newQty = newQtyMap.get(pid) || 0;
      if (oldQty === newQty) continue;

      const product = await Product.findById(pid);
      if (!product) continue;

      const currentStock = Number(product.stock || 0);
      // Stock already deducted for oldQty on this invoice — treat as available when editing
      const availableForEdit = currentStock + oldQty;

      if (newQty > availableForEdit) {
        const needed = newQty - availableForEdit;
        return res.status(400).json({
          error: `Insufficient stock for ${product.name}. Available: ${availableForEdit}, needed: ${needed}`,
        });
      }

      await adjustProductStock(pid, oldQty - newQty);
    }

    const computedSubtotal = enrichedBuyingProducts.reduce(
      (sum, item) => sum + Number(item.subtotal || 0),
      0,
    );
    const computedTotal = enrichedBuyingProducts.reduce(
      (sum, item) => sum + Number(item.mrp || 0) * Number(item.quantity || 0),
      0,
    );
    const billTotal = Number(billingSummary?.subtotal ?? computedSubtotal);

    const ps = paymentStatus || existing.paymentStatus;
    let paidAmount = 0;
    let unpaidAmount = 0;

    if (ps === "PAID") {
      paidAmount = billTotal;
      unpaidAmount = 0;
    } else {
      paidAmount = Math.min(
        Math.max(0, Number(paidAmountInput ?? existing.paidAmount ?? 0)),
        billTotal,
      );
      unpaidAmount = billTotal - paidAmount;
    }

    existing.buyingProducts = enrichedBuyingProducts;
    existing.billingSummary = {
      total: Number(billingSummary?.total ?? computedTotal),
      subtotal: billTotal,
      discount: Number(
        billingSummary?.discount ?? Math.max(0, computedTotal - billTotal),
      ),
      gst: Number(billingSummary?.gst ?? 0),
    };
    existing.paymentStatus = ps;
    if (transactionType) existing.transactionType = transactionType;
    existing.paidAmount = paidAmount;
    existing.unpaidAmount = unpaidAmount;
    existing.updatedBy = updatedBy || req.user?.userName || req.user?.id || "system";
    // save() bumps updatedAt; set explicitly so sync always sees invoice edits
    // (findByIdAndUpdate with req.body did not update timestamps)
    existing.updatedAt = new Date();

    await existing.save();

    const updated = await Invoice.findById(existing._id)
      .populate("customer")
      .populate({
        path: "buyingProducts.product",
        select: "-purchasePrice",
      });

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Delete invoice (soft delete recommended)
exports.deleteInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.softDelete(
      req.params.id,
      req.user?.userName || "system"
    );
    if (!invoice) return res.status(404).json({ error: "Invoice not found" });
    res.json({ message: "Invoice deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Public: recent purchases (live feed) combining invoices + orders
exports.getRecentPurchases = async (req, res) => {
  try {
    const limit = Number(req.query.limit) > 0 ? Math.min(Number(req.query.limit), 20) : 5;

    const baseNotDeleted = { $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }] };
    const excludedPhone = 9764384901;
    const phoneExclusion = {
      $or: [
        { "customerSnapshot.phoneNumber": { $nin: [excludedPhone, String(excludedPhone)] } },
        { "customerSnapshot.phoneNumber": { $exists: false } },
      ],
    };

    // Fetch latest invoices and orders, then merge
    const [invDocs, invCount, ordDocs, ordCount] = await Promise.all([
      Invoice.find({ ...baseNotDeleted, ...phoneExclusion })
        .select("buyingProducts customer customerSnapshot createdAt")
        .populate("customer", "fullName phoneNumber")
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean(),
      Invoice.countDocuments({ ...baseNotDeleted, ...phoneExclusion }),
      Order.find({ ...baseNotDeleted, status: { $ne: "CART" }, ...phoneExclusion })
        .select("items customer customerSnapshot createdAt")
        .populate("customer", "fullName phoneNumber")
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean(),
      Order.countDocuments({ ...baseNotDeleted, status: { $ne: "CART" }, ...phoneExclusion }),
    ]);

    const invMapped = invDocs.map((inv) => ({
      createdAt: inv.createdAt,
      customerName:
        (inv.customer && inv.customer.fullName) ||
        (inv.customerSnapshot && inv.customerSnapshot.fullName) ||
        "Customer",
      products: (inv.buyingProducts || []).map((p) => ({
        name: p.name,
        secondName: p.secondName,
        qty: p.quantity,
        price: p.price,
        subtotal: p.subtotal,
      })),
    }));

    const ordMapped = ordDocs.map((o) => ({
      createdAt: o.createdAt,
      customerName:
        (o.customer && o.customer.fullName) ||
        (o.customerSnapshot && o.customerSnapshot.fullName) ||
        "Customer",
      products: (o.items || []).map((it) => ({
        name: it.name,
        secondName: it.secondName,
        qty: it.quantity,
        price: it.price,
        subtotal: it.subtotal,
      })),
    }));

    // Merge by createdAt desc and take top N
    const merged = invMapped.concat(ordMapped).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, limit);

    const totalCount = invCount + ordCount;

    // Return only requested fields
    const recentPurchases = merged.map((m) => ({
      customerName: m.customerName,
      products: m.products,
    }));

    return res.status(200).json({ success: true, data: { totalCount, recentPurchases } });
  } catch (err) {
    console.error("❌ Error in getRecentPurchases:", err.message);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// Get all invoices
exports.getInvoices = async (req, res) => {
  try {
    // ✅ Parse and validate page and limit
    const page = Number(req.query.page) > 0 ? Number(req.query.page) : 1;
    const limit = Number(req.query.limit) > 0 ? Number(req.query.limit) : 10;
    const skip = (page - 1) * limit;

    // ✅ Build search filter
    const filter = {
      $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
    };

    // Date range filter
    if (req.query.startDate || req.query.endDate) {
      filter.createdAt = {};
      if (req.query.startDate) {
        filter.createdAt.$gte = new Date(req.query.startDate);
      }
      if (req.query.endDate) {
        // Set end date to end of the day
        const endDate = new Date(req.query.endDate);
        endDate.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = endDate;
      }
    }

    // Payment method (transactionType) filter
    if (req.query.paymentMethod) {
      filter.transactionType = req.query.paymentMethod;
    }

    // Payment status filter
    if (req.query.paymentStatus) {
      filter.paymentStatus = req.query.paymentStatus;
    }

    // Biller name filter
    if (req.query.billerName) {
      filter.billerName = new RegExp(req.query.billerName, "i");
    }

    // User filter (creator)
    if (req.query.billerId) {
      filter.billerId = req.query.billerId;
    }

    // Customer filter (by _id)
    if (req.query.customer) {
      filter.customer = req.query.customer;
    }
    console.log(filter);
    // Remove customerName filter and related population logic
    let invoiceQuery = Invoice.find(filter)
      .populate("customer")
      .populate({
        path: "buyingProducts.product",
        select: "-purchasePrice",
      });

    // Apply sorting, skip and limit
    const sort = { createdAt: -1 }; // Sort by newest first
    const [invoices, total] = await Promise.all([
      invoiceQuery.sort(sort).skip(skip).limit(limit),
      Invoice.countDocuments(filter),
    ]);

    // If customerName filter was applied, filter out null customers
    let filteredInvoices = invoices;
    if (req.query.customerName) {
      filteredInvoices = invoices.filter((invoice) => invoice.customer);
    }

    console.log("✅ Invoices returned:", filteredInvoices.length);

    // ✅ Send response
    res.status(200).json({
      data: filteredInvoices,
      total: req.query.customerName ? filteredInvoices.length : total,
      page,
      limit,
      totalPages: Math.ceil(
        (req.query.customerName ? filteredInvoices.length : total) / limit
      ),
    });
  } catch (err) {
    console.error("❌ Error in getInvoices:", err.message);
    res.status(500).json({ error: "Server error" });
  }
};

// Send WhatsApp by invoice number
exports.sendWhatsAppByInvoiceNumber = async (req, res) => {
  try {
    const { invoiceNumber } = req.body || {};
    if (!invoiceNumber) {
      return res.status(400).json({ error: "invoiceNumber is required" });
    }

    const invoice = await Invoice.findOne({ invoiceNumber });
    if (!invoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    const customer = await Customer.findById(invoice.customer);
    if (!customer) {
      return res.status(404).json({ error: "Customer not found for invoice" });
    }

    await whatsappService.sendWhatsAppMessageTwilioShortInvoice(invoice, customer);
    return res.status(200).json({ message: "WhatsApp message sent (or queued)" });
  } catch (err) {
    console.error("Error sending WhatsApp by invoiceNumber:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
