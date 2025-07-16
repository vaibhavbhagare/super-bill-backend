const Invoice = require("../models/Invoice");
const Product = require("../models/Product");
const Customer = require("../models/Customer");
const whatsappService = require("./whatsappService");

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
      createdBy,
      updatedBy,
    } = req.body;

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

    const prefix = `${month}-${billerShortName}-`;
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

    // Check stock for each product
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
        currentStock >= orderedQty
          ? currentStock - orderedQty 
          : 0; 

     

      await Product.updateOne(
        { _id: product._id },
        { $set: { stock: newStock } }
      );
    }
    // Decrement stock

    // Try to create invoice
    try {
      const invoice = new Invoice({
        buyingProducts,
        customer,
        billingSummary,
        billerId,
        billerName,
        sendWhatsappMessage,
        transactionType,
        invoiceNumber,
        paymentStatus,
        createdBy,
        updatedBy,
      });
      await invoice.save();
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
      .populate("buyingProducts.product");
    if (!invoice) return res.status(404).json({ error: "Invoice not found" });
    res.json(invoice);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Update invoice (optional, not typical in POS)
exports.updateInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    if (!invoice) return res.status(404).json({ error: "Invoice not found" });
    res.json(invoice);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Delete invoice (soft delete recommended)
exports.deleteInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findByIdAndDelete(req.params.id);
    if (!invoice) return res.status(404).json({ error: "Invoice not found" });
    res.json({ message: "Invoice deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    const filter = {};

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

    // Text search across multiple fields
    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search, "i");
      filter.$or = [
        { invoiceNumber: { $regex: searchRegex } },
        { billerName: { $regex: searchRegex } },
      ];
    }

    // Customer name filter - need to use aggregation for this
    let invoiceQuery = Invoice.find(filter);

    if (req.query.customerName) {
      // First populate customer to search by name
      invoiceQuery = invoiceQuery.populate({
        path: "customer",
        match: { fullName: new RegExp(req.query.customerName, "i") },
      });
    } else {
      // Regular population without filtering
      invoiceQuery = invoiceQuery.populate("customer");
    }

    // Always populate products
    invoiceQuery = invoiceQuery.populate("buyingProducts.product");

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
