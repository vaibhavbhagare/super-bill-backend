const Order = require("../models/Order");
const Product = require("../models/Product");
const Customer = require("../models/Customer");
const Invoice = require("../models/Invoice");
const Payment = require("../models/Payment");
const orderWhatsApp = require("../services/whatsappOrderNotificationService");

// Helpers: generate a unique-ish online invoice number
function generateOnlineInvoiceNumber() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `ONLINE-${y}${m}${d}-${hh}${mm}${ss}-${rnd}`;
}

// Helpers
const calculateSummary = (items) => {
  const subtotal = items.reduce((sum, it) => sum + (it.subtotal || (it.quantity * it.price)), 0);
  const discount = items.reduce((sum, it) => sum + (it.discount || 0), 0);
  const gst = 0; // Not specified in e-comm flow
  // Payable amount is selling price total. `discount` is savings vs MRP only.
  const total = Math.max(subtotal + gst, 0);
  return { subtotal, discount, gst, total };
};

const snapshotItemFromProduct = (product, quantity) => {
  const unitDiscount = Math.max((product.mrp || 0) - (product.sellingPrice1 || 0), 0);
  const discountAmount = quantity * unitDiscount;
  return {
    product: product._id,
    name: product.name,
    secondName: product.secondName,
    quantity,
    price: product.sellingPrice1,
    purchasePrice: product.purchasePrice,
    mrp: product.mrp,
    // store discount as amount, not percentage
    discount: discountAmount,
    subtotal: quantity * product.sellingPrice1,
  };
};

// CART APIs (per-user simple cart backed by an Order with status CART)
const getOrCreateCart = async (req) => {
  const actorName = req.user
    ? req.user.userName
    : (req.customer ? (req.customer.fullName || req.customer.userName || String(req.customer.phoneNumber) || "customer") : "guest");
  // Associate by actor label for simplicity
  let cart = await Order.findOne({ status: "CART", createdBy: actorName, deletedAt: null });
  if (!cart) {
    cart = await Order.create({ status: "CART", tracking: [{ status: "CART", note: "Cart created", by: actorName }], createdBy: actorName });
  }
  return cart;
};

exports.getCart = async (req, res) => {
  try {
    const cart = await getOrCreateCart(req);
    res.json({ success: true, data: cart });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to get cart", message: err.message });
  }
};

exports.addToCart = async (req, res) => {
  try {
    const { productId, quantity = 1 } = req.body;
    if (!productId || quantity <= 0) {
      return res.status(400).json({ success: false, error: "productId and quantity>0 required" });
    }
    const product = await Product.findOne({ _id: productId, deletedAt: null });
    if (!product || !product.isActive) {
      return res.status(404).json({ success: false, error: "Product not available" });
    }
    if (product.stock < quantity) {
      return res.status(400).json({ success: false, error: "Insufficient stock" });
    }

    const cart = await getOrCreateCart(req);
    const existing = cart.items.find((it) => String(it.product) === String(product._id));
    if (existing) {
      existing.quantity += quantity;
      existing.subtotal = existing.quantity * existing.price;
    } else {
      cart.items.push(snapshotItemFromProduct(product, quantity));
    }
    cart.billingSummary = calculateSummary(cart.items);
    await cart.save();
    res.json({ success: true, data: cart });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to add to cart", message: err.message });
  }
};

exports.updateCartItem = async (req, res) => {
  try {
    const { productId, quantity } = req.body;
    if (!productId || quantity == null) {
      return res.status(400).json({ success: false, error: "productId and quantity required" });
    }
    const cart = await getOrCreateCart(req);
    const item = cart.items.find((it) => String(it.product) === String(productId));
    if (!item) return res.status(404).json({ success: false, error: "Item not in cart" });
    if (quantity <= 0) {
      cart.items = cart.items.filter((it) => String(it.product) !== String(productId));
    } else {
      item.quantity = quantity;
      item.subtotal = item.quantity * item.price;
    }
    cart.billingSummary = calculateSummary(cart.items);
    await cart.save();
    res.json({ success: true, data: cart });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to update cart", message: err.message });
  }
};

exports.clearCart = async (req, res) => {
  try {
    const cart = await getOrCreateCart(req);
    cart.items = [];
    cart.billingSummary = calculateSummary(cart.items);
    await cart.save();
    res.json({ success: true, data: cart });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to clear cart", message: err.message });
  }
};

// PLACE ORDER (no server-side cart)
exports.placeOrder = async (req, res) => {
  try {
    const {
      customerId,
      customerInfo,
      paymentMethod = "COD",
      products,
      orderType,
      razorpayOrderId,
      razorpayPaymentId,
    } = req.body;
    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ success: false, error: "products array required" });
    }

    // Validate products payload
    const requested = products
      .map((p) => ({ productId: p.productId || p.id, quantity: Number(p.quantity || 0) }))
      .filter((p) => p.productId && p.quantity > 0);
    if (requested.length === 0) {
      return res.status(400).json({ success: false, error: "Each product must have productId and quantity>0" });
    }

    const productIds = requested.map((r) => r.productId);
    const dbProducts = await Product.find({ _id: { $in: productIds }, deletedAt: null });
    const idToProduct = new Map(dbProducts.map((doc) => [String(doc._id), doc]));

    // Build order items and check stock
    const items = [];
    for (const reqItem of requested) {
      const prod = idToProduct.get(String(reqItem.productId));
      if (!prod) {
        return res.status(404).json({ success: false, error: `Product not available: ${reqItem.productId}` });
      }
      // if (prod.stock < reqItem.quantity) {
      //   return res.status(400).json({ success: false, error: `Insufficient stock for ${prod.name}` });
      // }
      items.push(snapshotItemFromProduct(prod, reqItem.quantity));
    }

    // Prepare customer (existing or on-the-fly)
    let customer = null;
    if (customerId) {
      customer = await Customer.findById(customerId);
    } else if (customerInfo && customerInfo.phoneNumber) {
      customer = await Customer.findOne({ phoneNumber: customerInfo.phoneNumber });
      if (!customer) {
        customer = await Customer.create({
          phoneNumber: customerInfo.phoneNumber,
          fullName: customerInfo.fullName || "Guest",
          address: customerInfo.address || null,
        });
      }
    }

    const billingSummary = calculateSummary(items);
    const method = String(paymentMethod || "COD").toUpperCase();
    let verifiedPayment = null;

    if (method === "ONLINE") {
      if (!req.customer) {
        return res.status(401).json({
          success: false,
          error: "Please sign in to pay online.",
        });
      }
      if (!razorpayOrderId || !razorpayPaymentId) {
        return res.status(400).json({
          success: false,
          error: "Online payment is required before placing this order.",
        });
      }
      verifiedPayment = await Payment.findOne({
        razorpayOrderId,
        razorpayPaymentId,
        customerId: req.customer._id,
        status: "PAID",
      });
      if (!verifiedPayment) {
        return res.status(400).json({
          success: false,
          error: "Payment was not verified.",
        });
      }
      if (verifiedPayment.storeOrderId) {
        return res.status(400).json({
          success: false,
          error: "This payment was already used for an order.",
        });
      }
      if (verifiedPayment.amountInPaise !== Math.round(billingSummary.total * 100)) {
        return res.status(400).json({
          success: false,
          error: "Paid amount does not match the order.",
        });
      }
    }

    for (const reqItem of requested) {
      const prod = idToProduct.get(String(reqItem.productId));
      prod.stock -= reqItem.quantity;
      await prod.save();
    }

    const actorName = req.user
      ? req.user.userName
      : (req.customer ? (req.customer.fullName || req.customer.userName || String(req.customer.phoneNumber) || "customer") : "guest");
    const order = await Order.create({
      items,
      // Both HOME_DELIVERY and STORE_PICKUP start at PLACED so staff
      // can walk the same ACTION flow (pickup skips delivery steps later).
      status: "PLACED",
      placedAt: new Date(),
      orderType: ["HOME_DELIVERY", "STORE_PICKUP"].includes((orderType || "").toUpperCase())
        ? (orderType || "").toUpperCase()
        : "HOME_DELIVERY",
      paymentMethod: method === "ONLINE" ? "ONLINE" : method === "CASH" ? "CASH" : "COD",
      paymentStatus: method === "ONLINE" ? "PAID" : "UNPAID",
      razorpayOrderId: verifiedPayment ? verifiedPayment.razorpayOrderId : undefined,
      razorpayPaymentId: verifiedPayment ? verifiedPayment.razorpayPaymentId : undefined,
      customer: customer ? customer._id : undefined,
      customerSnapshot: customer
        ? { fullName: customer.fullName, phoneNumber: customer.phoneNumber, address: customer.address }
        : (customerInfo || {}),
      billingSummary,
      tracking: [{ status: "PLACED", note: "Order placed", by: actorName }],
      picking: items.map((it) => ({
        product: it.product,
        name: it.name,
        quantity: it.quantity,
        picked: false,
        unavailable: false,
      })),
      channel: "ONLINE",
      createdBy: actorName,
    });

    if (verifiedPayment) {
      verifiedPayment.storeOrderId = order._id;
      await verifiedPayment.save();
    }

    orderWhatsApp.scheduleOrderWhatsApp(() => orderWhatsApp.onOrderPlaced(order.toObject ? order.toObject() : order));

  res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to place order", message: err.message });
  }
};

// ADMIN: update status and auto-invoice on COMPLETED
exports.updateStatus = async (req, res) => {
  try {
    if (
      !req.user ||
      !["admin", "super_admin", "biller"].includes(req.user.role)
    ) {
      return res.status(403).json({ success: false, error: "Admin only" });
    }
    const { id } = req.params;
    const { status: rawStatus, note, orderWhatsAppExtras } = req.body;
    // Normalize incoming statuses to canonical enum
    const normalize = (s) => String(s || "").trim().toUpperCase()
      .replace(/\s+/g, " ")
      .replace(/^APPROVED$/, "CONFIRMED")
      .replace(/^APPROVE$/, "CONFIRMED")
      .replace(/^PACKED$/, "PACKING")
      .replace(/^PACK$/, "PACKING")
      .replace(/^SHIPPED$/, "OUT FOR DELIVERY")
      .replace(/^OUT_FOR_DELIVERY$/, "OUT FOR DELIVERY")
      .replace(/^OUT-FOR-DELIVERY$/, "OUT FOR DELIVERY");
    const status = normalize(rawStatus);
    const allowed = [
      "CONFIRMED",
      "PACKING",
      "READY FOR STORE PICKUP",
      "OUT FOR DELIVERY",
      "DELIVERED",
      "COMPLETED",
      "CANCELLED",
    ];
    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, error: "Invalid status" });
    }
    const order = await Order.findById(id).populate("items.product");
    if (!order) return res.status(404).json({ success: false, error: "Order not found" });

    const previousStatus = order.status;

  order.status = status;
    order.updatedBy = req.user ? req.user.userName : order.updatedBy;
    if (status === "PLACED" && !order.placedAt) {
      order.placedAt = new Date();
    }
    if (status === "CANCELLED") {
      order.cancelledAt = new Date();
      order.cancelledBy = req.user ? req.user.userName : "admin";
      // Restock
      for (const item of order.items) {
        const prod = await Product.findById(item.product._id);
        if (prod) { prod.stock += item.quantity; await prod.save(); }
      }
    }
    if (status === "COMPLETED") {
      order.completedAt = new Date();
      // Create invoice if not exists, with a unique ONLINE invoiceNumber
      if (!order.invoice) {
        let invoiceDoc = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            invoiceDoc = await Invoice.create({
              buyingProducts: order.items.map((it) => ({
                product: it.product._id,
                name: it.name,
                secondName: it.secondName,
                quantity: it.quantity,
                price: it.price,
                purchasePrice: it.purchasePrice,
                mrp: it.mrp,
                discount: it.discount,
                subtotal: it.subtotal,
              })),
              customer: order.customer,
              billingSummary: order.billingSummary,
              billerId: req.user ? String(req.user._id) : "system",
              billerName: req.user ? req.user.userName : "system",
              transactionType: "ONLINE", // e-comm completes as ONLINE
              invoiceNumber: generateOnlineInvoiceNumber(),
              channel: "ONLINE",
              createdBy: req.user ? req.user.userName : "system",
            });
            break; // success
          } catch (err) {
            if (err && err.code === 11000) {
              // duplicate invoiceNumber, retry
              continue;
            }
            throw err;
          }
        }
        if (!invoiceDoc) {
          throw new Error("Failed to create unique invoice number");
        }
        order.invoice = invoiceDoc._id;
        order.paymentStatus = "PAID"; // assume completed means paid
      }
    }

  order.tracking.push({ status, note, by: req.user ? req.user.userName : "system", at: new Date() });
    await order.save();

    const orderPlain = order.toObject ? order.toObject() : order;
    orderWhatsApp.scheduleOrderWhatsApp(() =>
      orderWhatsApp.onOrderStatusUpdated(orderPlain, status, {
        previousStatus,
        orderWhatsAppExtras,
        statusNote: note,
      }),
    );

    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to update status", message: err.message });
  }
};

/** Admin: fire any order WhatsApp catalog event (delay, OTP, refund, ops SLA, etc.). */
exports.dispatchWhatsAppOrderEvent = async (req, res) => {
  try {
    if (!req.user || !["admin", "super_admin"].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: "Admin only" });
    }
    const { id } = req.params;
    const body = req.body || {};
    const eventId = body.eventId || body.event;
    if (!eventId || !orderWhatsApp.isValidOrderWhatsAppEventId(eventId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid or missing eventId",
        allowed: orderWhatsApp.ORDER_NOTIFICATION_EVENT_IDS,
      });
    }
    const order = await Order.findById(id).populate("items.product");
    if (!order) return res.status(404).json({ success: false, error: "Order not found" });

    const meta = { ...body };
    delete meta.eventId;
    delete meta.event;

    orderWhatsApp.scheduleOrderWhatsApp(() =>
      orderWhatsApp.dispatchOrderNotification(eventId, order.toObject ? order.toObject() : order, meta),
    );

    return res.json({ success: true, queued: true, eventId });
  } catch (err) {
    return res.status(500).json({ success: false, error: "Failed to queue WhatsApp", message: err.message });
  }
};

// USER: cancel order (only if PLACED/CONFIRMED/PACKING)
exports.cancelOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const order = await Order.findById(id);
    if (!order) return res.status(404).json({ success: false, error: "Order not found" });
    if (["COMPLETED", "CANCELLED"].includes(order.status)) {
      return res.status(400).json({ success: false, error: "Order cannot be cancelled" });
    }
    order.status = "CANCELLED";
    order.cancelledAt = new Date();
    order.cancelledBy = req.user ? req.user.userName : "user";
    order.cancelledReason = reason || "";
    order.tracking.push({ status: "CANCELLED", note: reason, by: req.user ? req.user.userName : "user" });
    // Restock
    for (const item of order.items) {
      const prod = await Product.findById(item.product);
      if (prod) { prod.stock += item.quantity; await prod.save(); }
    }
    await order.save();

    orderWhatsApp.scheduleOrderWhatsApp(() =>
      orderWhatsApp.onOrderCancelled(order.toObject ? order.toObject() : order, { reason: order.cancelledReason }),
    );

    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to cancel order", message: err.message });
  }
};

exports.getOrder = async (req, res) => {
  try {
    if (
      !req.user ||
      !["admin", "super_admin", "biller"].includes(req.user.role)
    ) {
      // customers may also fetch own order elsewhere; keep staff gate for admin portal
      if (!req.customer) {
        return res.status(403).json({ success: false, error: "Admin only" });
      }
    }
    const { id } = req.params;
    const mongoose = require("mongoose");
    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      return res.status(400).json({ success: false, error: "Invalid order id" });
    }
    const order = await Order.findById(id).populate("items.product");
    if (!order) return res.status(404).json({ success: false, error: "Order not found" });
    // Ensure picking checklist exists for older orders
    if (!order.picking || order.picking.length === 0) {
      order.picking = order.items.map((it) => ({
        product: it.product?._id || it.product,
        name: it.name,
        quantity: it.quantity,
        picked: false,
        unavailable: false,
      }));
      await order.save();
    }
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to fetch order", message: err.message });
  }
};

exports.listOrders = async (req, res) => {
  try {
    if (
      !req.user ||
      !["admin", "super_admin", "biller"].includes(req.user.role)
    ) {
      return res.status(403).json({ success: false, error: "Admin only" });
    }
    const {
      status,
      paymentMethod,
      paymentStatus,
      customerId,
      customer, // can be id or name/phone search string
      dateFrom,
      dateTo,
      placedFrom,
      placedTo,
      orderType,
      q,
      page = 1,
      limit = 20,
    } = req.query;

    const andConditions = [
      { $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }] },
      { status: { $ne: "CART" } },
    ];

    if (status) andConditions.push({ status });
    if (paymentMethod) andConditions.push({ paymentMethod });
    if (paymentStatus) andConditions.push({ paymentStatus });
    if (orderType) andConditions.push({ orderType: String(orderType).toUpperCase() });

    if (q && String(q).trim()) {
      const term = String(q).trim();
      const orSearch = [
        { "customerSnapshot.fullName": { $regex: term, $options: "i" } },
        { "items.name": { $regex: term, $options: "i" } },
      ];
      const asNumber = Number(term);
      if (!Number.isNaN(asNumber)) {
        orSearch.push({ "customerSnapshot.phoneNumber": asNumber });
      }
      if (require("mongoose").Types.ObjectId.isValid(term)) {
        orSearch.push({ _id: term });
      }
      andConditions.push({ $or: orSearch });
    }

    // Customer filters
    if (customerId) {
      try {
        andConditions.push({ customer: require("mongoose").Types.ObjectId.createFromHexString(String(customerId)) });
      } catch (_) {
        // ignore invalid id
      }
    } else if (customer) {
      const mongoose = require("mongoose");
      const conds = [];
      if (mongoose.Types.ObjectId.isValid(String(customer))) {
        conds.push({ customer: new mongoose.Types.ObjectId(String(customer)) });
      }
      // name regex and phone equality from snapshot
      conds.push({ "customerSnapshot.fullName": { $regex: String(customer), $options: "i" } });
      const asNumber = Number(customer);
      if (!Number.isNaN(asNumber)) {
        conds.push({ "customerSnapshot.phoneNumber": asNumber });
      }
      andConditions.push({ $or: conds });
    }

    // Date filters: createdAt range
    if (dateFrom || dateTo) {
      const createdRange = {};
      if (dateFrom) createdRange.$gte = new Date(dateFrom);
      if (dateTo) createdRange.$lte = new Date(dateTo);
      andConditions.push({ createdAt: createdRange });
    }
    // placedAt range
    if (placedFrom || placedTo) {
      const placedRange = {};
      if (placedFrom) placedRange.$gte = new Date(placedFrom);
      if (placedTo) placedRange.$lte = new Date(placedTo);
      andConditions.push({ placedAt: placedRange });
    }

    const filter = andConditions.length > 1 ? { $and: andConditions } : andConditions[0];

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [orders, total] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
      Order.countDocuments(filter),
    ]);
    res.json({ success: true, data: { orders, pagination: { currentPage: parseInt(page), total, limit: parseInt(limit) } } });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to list orders", message: err.message });
  }
};

// LIST ORDERS BY CUSTOMER ID (public with optional auth)
exports.listOrdersByCustomer = async (req, res) => {
  try {
    const { customerId } = req.params;
    const { status, page = 1, limit = 20 } = req.query;
    if (!customerId) {
      return res.status(400).json({ success: false, error: "customerId is required" });
    }

    const filter = { deletedAt: null, customer: customerId };
    if (status) filter.status = status;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [orders, total] = await Promise.all([
      Order.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Order.countDocuments(filter),
    ]);
    return res.json({ success: true, data: { orders, pagination: { currentPage: parseInt(page), total, limit: parseInt(limit) } } });
  } catch (err) {
    return res.status(500).json({ success: false, error: "Failed to list customer orders", message: err.message });
  }
};

// LIST AUTHENTICATED CUSTOMER'S ORDERS
exports.listMyOrders = async (req, res) => {
  try {
    if (!req.customer || !req.customer._id) {
      return res.status(401).json({ success: false, error: "Customer authentication required" });
    }
    const { status, page = 1, limit = 20 } = req.query;
    const filter = { deletedAt: null, customer: req.customer._id };
    if (status) filter.status = status;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [orders, total] = await Promise.all([
      Order.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Order.countDocuments(filter),
    ]);
    return res.json({ success: true, data: { orders, pagination: { currentPage: parseInt(page), total, limit: parseInt(limit) } } });
  } catch (err) {
    return res.status(500).json({ success: false, error: "Failed to list my orders", message: err.message });
  }
};



function requireOrderStaff(req, res) {
  if (
    !req.user ||
    !["admin", "super_admin", "biller"].includes(req.user.role)
  ) {
    res.status(403).json({ success: false, error: "Admin only" });
    return false;
  }
  return true;
}

function notDeleted() {
  return { $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }] };
}

/** Admin dashboard KPIs for online orders */
exports.getOrderDashboard = async (req, res) => {
  try {
    if (!requireOrderStaff(req, res)) return;

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const pendingStatuses = [
      "PLACED",
      "CONFIRMED",
      "PACKING",
      "READY FOR STORE PICKUP",
      "OUT FOR DELIVERY",
    ];

    const [
      pendingOrders,
      todayOrders,
      todaySalesAgg,
      salesAgg,
      recentPending,
      lowStock,
    ] = await Promise.all([
      Order.countDocuments({
        ...notDeleted(),
        status: { $in: pendingStatuses },
      }),
      Order.countDocuments({
        ...notDeleted(),
        status: { $ne: "CART" },
        createdAt: { $gte: startOfDay, $lte: endOfDay },
      }),
      Order.aggregate([
        {
          $match: {
            status: { $nin: ["CART", "CANCELLED"] },
            $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
            createdAt: { $gte: startOfDay, $lte: endOfDay },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: { $ifNull: ["$billingSummary.subtotal", { $ifNull: ["$billingSummary.total", 0] }] } },
            count: { $sum: 1 },
          },
        },
      ]),
      Order.aggregate([
        {
          $match: {
            status: { $in: ["DELIVERED", "COMPLETED"] },
            $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: { $ifNull: ["$billingSummary.subtotal", { $ifNull: ["$billingSummary.total", 0] }] } },
            count: { $sum: 1 },
          },
        },
      ]),
      Order.find({
        ...notDeleted(),
        status: { $in: pendingStatuses },
      })
        .sort({ createdAt: -1 })
        .limit(8)
        .select("status orderType customerSnapshot billingSummary createdAt paymentStatus paymentMethod"),
      Product.find({
        $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
        minStock: { $ne: null, $gt: 0 },
        $expr: { $lte: ["$stock", "$minStock"] },
      })
        .sort({ stock: 1 })
        .limit(10)
        .select("name stock minStock barcode"),
    ]);

    res.json({
      success: true,
      data: {
        sales: {
          totalRevenue: salesAgg[0]?.total || 0,
          completedOrders: salesAgg[0]?.count || 0,
        },
        today: {
          orders: todayOrders,
          revenue: todaySalesAgg[0]?.total || 0,
        },
        pendingOrders,
        lowStock,
        recentPending,
      },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: "Failed to load order dashboard",
      message: err.message,
    });
  }
};

/** Basic sales / order reports */
exports.getOrderReports = async (req, res) => {
  try {
    if (!requireOrderStaff(req, res)) return;
    const { dateFrom, dateTo, orderType } = req.query;
    const match = {
      status: { $nin: ["CART"] },
      $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
    };
    if (dateFrom || dateTo) {
      match.createdAt = {};
      if (dateFrom) match.createdAt.$gte = new Date(dateFrom);
      if (dateTo) match.createdAt.$lte = new Date(dateTo);
    }
    if (orderType) match.orderType = String(orderType).toUpperCase();

    const [byStatus, byPayment, byType, daily, totals] = await Promise.all([
      Order.aggregate([
        { $match: match },
        { $group: { _id: "$status", count: { $sum: 1 }, revenue: { $sum: { $ifNull: ["$billingSummary.subtotal", 0] } } } },
      ]),
      Order.aggregate([
        { $match: match },
        { $group: { _id: { method: "$paymentMethod", status: "$paymentStatus" }, count: { $sum: 1 }, revenue: { $sum: { $ifNull: ["$billingSummary.subtotal", 0] } } } },
      ]),
      Order.aggregate([
        { $match: match },
        { $group: { _id: "$orderType", count: { $sum: 1 }, revenue: { $sum: { $ifNull: ["$billingSummary.subtotal", 0] } } } },
      ]),
      Order.aggregate([
        { $match: match },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            count: { $sum: 1 },
            revenue: { $sum: { $ifNull: ["$billingSummary.subtotal", 0] } },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Order.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            orders: { $sum: 1 },
            revenue: { $sum: { $ifNull: ["$billingSummary.subtotal", 0] } },
            cancelled: {
              $sum: { $cond: [{ $eq: ["$status", "CANCELLED"] }, 1, 0] },
            },
            completed: {
              $sum: {
                $cond: [{ $in: ["$status", ["DELIVERED", "COMPLETED"]] }, 1, 0],
              },
            },
          },
        },
      ]),
    ]);

    res.json({
      success: true,
      data: {
        totals: totals[0] || { orders: 0, revenue: 0, cancelled: 0, completed: 0 },
        byStatus,
        byPayment,
        byType,
        daily,
      },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: "Failed to load order reports",
      message: err.message,
    });
  }
};

/** Update store picking checklist; optionally adjust stock for unavailable items */
exports.updateOrderPicking = async (req, res) => {
  try {
    if (!requireOrderStaff(req, res)) return;
    const { id } = req.params;
    const { items } = req.body || {};
    if (!Array.isArray(items)) {
      return res.status(400).json({ success: false, error: "items array required" });
    }

    const order = await Order.findById(id);
    if (!order) return res.status(404).json({ success: false, error: "Order not found" });

    if (!order.picking || order.picking.length === 0) {
      order.picking = order.items.map((it) => ({
        product: it.product,
        name: it.name,
        quantity: it.quantity,
        picked: false,
        unavailable: false,
      }));
    }

    const byId = new Map(
      items.map((row) => [String(row._id || row.product), row]),
    );
    const actor = req.user?.userName || "admin";

    for (const pick of order.picking) {
      const key = String(pick._id || pick.product);
      const update = byId.get(key) || byId.get(String(pick.product));
      if (!update) continue;

      const wasUnavailable = !!pick.unavailable;
      pick.picked = !!update.picked;
      pick.unavailable = !!update.unavailable;
      if (update.note != null) pick.note = String(update.note);
      if (pick.picked || pick.unavailable) {
        pick.pickedAt = new Date();
        pick.pickedBy = actor;
      }

      // If newly marked unavailable, restock that line (stock was decremented at place)
      if (!wasUnavailable && pick.unavailable && pick.product) {
        const qty = Number(pick.quantity || 0);
        if (qty > 0) {
          await Product.updateOne(
            { _id: pick.product },
            { $inc: { stock: qty }, $set: { updatedAt: new Date() } },
          );
        }
      }
      // If unavailable cleared, re-decrement stock
      if (wasUnavailable && !pick.unavailable && pick.product) {
        const qty = Number(pick.quantity || 0);
        if (qty > 0) {
          await Product.updateOne(
            { _id: pick.product },
            { $inc: { stock: -qty }, $set: { updatedAt: new Date() } },
          );
        }
      }
    }

    order.updatedBy = actor;
    order.markModified("picking");
    await order.save();
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: "Failed to update picking",
      message: err.message,
    });
  }
};

/** Assign / update delivery tracking */
exports.updateOrderDelivery = async (req, res) => {
  try {
    if (!requireOrderStaff(req, res)) return;
    const { id } = req.params;
    const { assignedTo, assignedToName, phone, vehicle, trackingNote } =
      req.body || {};

    const order = await Order.findById(id);
    if (!order) return res.status(404).json({ success: false, error: "Order not found" });

    const actor = req.user?.userName || "admin";
    order.delivery = {
      ...(order.delivery?.toObject ? order.delivery.toObject() : order.delivery || {}),
      assignedTo: assignedTo != null ? String(assignedTo) : order.delivery?.assignedTo,
      assignedToName:
        assignedToName != null
          ? String(assignedToName)
          : order.delivery?.assignedToName,
      phone: phone != null ? String(phone) : order.delivery?.phone,
      vehicle: vehicle != null ? String(vehicle) : order.delivery?.vehicle,
      trackingNote:
        trackingNote != null ? String(trackingNote) : order.delivery?.trackingNote,
      assignedAt: new Date(),
      assignedBy: actor,
    };
    order.updatedBy = actor;
    if (trackingNote) {
      order.tracking.push({
        status: order.status,
        note: `Delivery: ${trackingNote}`,
        by: actor,
        at: new Date(),
      });
    }
    await order.save();
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: "Failed to update delivery",
      message: err.message,
    });
  }
};

async function restockOrderItems(order) {
  // Only restock if order was not already cancelled (cancel already restocked)
  if (order.status === "CANCELLED") return;
  for (const item of order.items || []) {
    const productId = item.product?._id || item.product;
    const qty = Number(item.quantity || 0);
    if (!productId || !qty) continue;
    // Skip lines marked unavailable in picking (already restocked)
    const pick = (order.picking || []).find(
      (p) => String(p.product) === String(productId) && p.unavailable,
    );
    if (pick) continue;
    await Product.updateOne(
      { _id: productId },
      { $inc: { stock: qty }, $set: { updatedAt: new Date() } },
    );
  }
}

/** Super admin only: permanently delete an order (cleanup / test data) */
exports.deleteOrder = async (req, res) => {
  try {
    if (!req.user || req.user.role !== "super_admin") {
      return res.status(403).json({ success: false, error: "Super admin only" });
    }
    const { id } = req.params;
    const order = await Order.findById(id);
    if (!order) return res.status(404).json({ success: false, error: "Order not found" });

    await restockOrderItems(order);
    await Order.deleteOne({ _id: order._id });

    res.json({
      success: true,
      message: "Order permanently deleted",
      deletedId: String(order._id),
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: "Failed to delete order",
      message: err.message,
    });
  }
};

/** Super admin only: permanently delete many orders */
exports.deleteOrdersBulk = async (req, res) => {
  try {
    if (!req.user || req.user.role !== "super_admin") {
      return res.status(403).json({ success: false, error: "Super admin only" });
    }
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (!ids.length) {
      return res.status(400).json({ success: false, error: "ids array required" });
    }

    const orders = await Order.find({ _id: { $in: ids } });
    for (const order of orders) {
      await restockOrderItems(order);
    }
    const result = await Order.deleteMany({ _id: { $in: ids } });

    res.json({
      success: true,
      message: "Orders permanently deleted",
      deletedCount: result.deletedCount || 0,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: "Failed to delete orders",
      message: err.message,
    });
  }
};
