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

/** Build a printable one-line address from string or structured fields. */
function formatStructuredAddress(addr) {
  if (!addr) return "";
  if (typeof addr === "string") return addr.trim();
  const parts = [
    addr.name && addr.name !== "Home" ? addr.name : null,
    addr.addressLine1 || addr.line1 || addr.street,
    addr.addressLine2 || addr.line2,
    addr.city,
    addr.pincode || addr.pinCode || addr.zip,
    addr.state,
  ].filter((p) => p != null && String(p).trim() !== "");
  return parts.join(", ");
}

function normalizePhoneNumber(value) {
  if (value == null || value === "") return null;
  const digits = String(value).replace(/\D/g, "");
  if (!digits) return null;
  // Strip leading country code 91 when 12 digits
  const local =
    digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
  const n = Number(local);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function customerIdOf(ref) {
  if (!ref) return null;
  if (typeof ref === "object") {
    if (ref._id != null) return String(ref._id);
    return null;
  }
  const s = String(ref);
  if (!s || s === "[object Object]") return null;
  return s;
}

/**
 * Prefer checkout customerInfo (incl. addressId), then shopping-app
 * addresses[], then legacy customer.address.
 */
function resolveCustomerAddress(customer, customerInfo) {
  if (customerInfo?.addressId && Array.isArray(customer?.addresses)) {
    const match = customer.addresses.find(
      (a) => a && String(a._id) === String(customerInfo.addressId),
    );
    const fromId = formatStructuredAddress(match);
    if (fromId) return fromId;
  }

  const fromInfo =
    formatStructuredAddress(customerInfo?.address) ||
    formatStructuredAddress(customerInfo?.deliveryAddress) ||
    formatStructuredAddress(customerInfo?.shippingAddress) ||
    formatStructuredAddress({
      addressLine1: customerInfo?.addressLine1 || customerInfo?.line1,
      addressLine2: customerInfo?.addressLine2 || customerInfo?.line2,
      city: customerInfo?.city,
      pincode: customerInfo?.pincode || customerInfo?.pinCode,
      state: customerInfo?.state,
    });
  if (fromInfo) return fromInfo;

  const list = Array.isArray(customer?.addresses) ? customer.addresses : [];
  const preferred = list.find((a) => a && a.isDefault) || list[0];
  const fromList = formatStructuredAddress(preferred);
  if (fromList) return fromList;

  if (customer?.address && String(customer.address).trim()) {
    return String(customer.address).trim();
  }
  return null;
}

async function enrichOrdersWithCustomerProfile(orders) {
  const list = (orders || []).map((o) => (o?.toObject ? o.toObject() : o));
  if (list.length === 0) return list;

  const ids = [
    ...new Set(list.map((o) => customerIdOf(o.customer)).filter(Boolean)),
  ];
  const phones = [
    ...new Set(
      list
        .map((o) => normalizePhoneNumber(o.customerSnapshot?.phoneNumber))
        .filter(Boolean),
    ),
  ];

  const orConds = [];
  if (ids.length) orConds.push({ _id: { $in: ids } });
  if (phones.length) orConds.push({ phoneNumber: { $in: phones } });
  if (orConds.length === 0) return list;

  const customers = await Customer.find({ $or: orConds })
    .select("fullName phoneNumber address addresses")
    .lean();
  const byId = new Map(customers.map((c) => [String(c._id), c]));
  const byPhone = new Map(
    customers.map((c) => [String(c.phoneNumber), c]),
  );

  return list.map((o) => {
    const id = customerIdOf(o.customer);
    const phone = normalizePhoneNumber(o.customerSnapshot?.phoneNumber);
    const cust =
      (id && byId.get(id)) ||
      (phone != null ? byPhone.get(String(phone)) : null) ||
      null;
    if (!cust) return o;

    const address =
      resolveCustomerAddress(cust, null) ||
      (o.customerSnapshot?.address && String(o.customerSnapshot.address).trim()) ||
      undefined;
    const fullName =
      (cust.fullName && String(cust.fullName).trim()) ||
      o.customerSnapshot?.fullName;
    const phoneNumber =
      cust.phoneNumber != null
        ? cust.phoneNumber
        : o.customerSnapshot?.phoneNumber;

    return {
      ...o,
      customer: o.customer || cust?._id,
      customerSnapshot: {
        ...(o.customerSnapshot || {}),
        ...(fullName ? { fullName } : {}),
        ...(phoneNumber != null ? { phoneNumber } : {}),
        ...(address ? { address } : {}),
      },
    };
  });
}

/** @deprecated use enrichOrdersWithCustomerProfile */
async function enrichOrdersWithAddress(orders) {
  return enrichOrdersWithCustomerProfile(orders);
}

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
      addressId,
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

    const info = {
      ...(customerInfo || {}),
      addressId:
        addressId ||
        customerInfo?.addressId ||
        customerInfo?.selectedAddressId ||
        undefined,
    };
    const phone = normalizePhoneNumber(info.phoneNumber);

    // Prepare customer (existing or on-the-fly)
    let customer = null;
    if (customerId) {
      customer = await Customer.findById(customerId);
    }
    if (!customer && phone) {
      customer = await Customer.findOne({ phoneNumber: phone });
      if (!customer) {
        const resolved = resolveCustomerAddress(null, info);
        customer = await Customer.create({
          phoneNumber: phone,
          fullName: info.fullName || "Guest",
          address: resolved,
          ...(resolved && info.addressLine1
            ? {
                addresses: [
                  {
                    name: info.addressName || "Home",
                    addressLine1: info.addressLine1,
                    addressLine2: info.addressLine2 || null,
                    city: info.city || "",
                    pincode: String(info.pincode || info.pinCode || ""),
                    isDefault: true,
                  },
                ],
              }
            : {}),
        });
      }
    }

    const resolvedAddress = resolveCustomerAddress(customer, info);

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
        ? {
            fullName: customer.fullName,
            phoneNumber: customer.phoneNumber,
            address: resolvedAddress,
          }
        : {
            fullName: info.fullName || "Guest",
            phoneNumber: phone || info.phoneNumber,
            address: resolvedAddress,
          },
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
    const [enriched] = await enrichOrdersWithCustomerProfile([order]);
    res.json({ success: true, data: enriched });
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

    if (status) {
      const raw = String(status).trim().toUpperCase();
      const pendingStatuses = [
        "PLACED",
        "CONFIRMED",
        "PACKING",
        "READY FOR STORE PICKUP",
        "OUT FOR DELIVERY",
      ];
      if (raw === "PENDING") {
        andConditions.push({ status: { $in: pendingStatuses } });
      } else if (raw === "SALES" || raw === "COMPLETED_SALES") {
        andConditions.push({ status: { $in: ["DELIVERED", "COMPLETED"] } });
      } else if (String(status).includes(",")) {
        andConditions.push({
          status: {
            $in: String(status)
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          },
        });
      } else {
        andConditions.push({ status });
      }
    }
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

    // Date filters: createdAt range (date-only To includes full local day)
    if (dateFrom || dateTo) {
      const createdRange = {};
      if (dateFrom) {
        const from = new Date(String(dateFrom));
        if (!String(dateFrom).includes("T")) from.setHours(0, 0, 0, 0);
        createdRange.$gte = from;
      }
      if (dateTo) {
        const to = new Date(String(dateTo));
        if (!String(dateTo).includes("T")) to.setHours(23, 59, 59, 999);
        createdRange.$lte = to;
      }
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
    const enrichedOrders = await enrichOrdersWithCustomerProfile(orders);
    res.json({
      success: true,
      data: {
        orders: enrichedOrders,
        pagination: {
          currentPage: parseInt(page),
          total,
          limit: parseInt(limit),
        },
      },
    });
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

function productIdOf(item) {
  return String(item?.product?._id || item?.product || "");
}

function isPickingUnavailable(order, productId) {
  return (order.picking || []).some(
    (p) => String(p.product) === String(productId) && p.unavailable,
  );
}

function syncPickingQuantities(order) {
  const prevByProduct = new Map(
    (order.picking || []).map((p) => [String(p.product), p]),
  );
  order.picking = (order.items || []).map((it) => {
    const pid = productIdOf(it);
    const prev = prevByProduct.get(pid);
    if (prev) {
      prev.name = it.name;
      prev.quantity = it.quantity;
      return prev;
    }
    return {
      product: it.product,
      name: it.name,
      quantity: it.quantity,
      picked: false,
      unavailable: false,
    };
  });
  order.markModified("picking");
}

const EDITABLE_ORDER_STATUSES = new Set([
  "PLACED",
  "CONFIRMED",
  "PACKING",
  "READY FOR STORE PICKUP",
  "OUT FOR DELIVERY",
]);

/**
 * Staff: add / remove / set quantity on order lines.
 * Body: { action: "add"|"remove"|"setQuantity", productId?, itemId?, quantity? }
 * Adjusts stock (skips lines already marked unavailable in picking).
 */
exports.updateOrderItems = async (req, res) => {
  try {
    if (!requireOrderStaff(req, res)) return;
    const { id } = req.params;
    const { action, productId, itemId, quantity } = req.body || {};
    const act = String(action || "").toLowerCase();

    if (!["add", "remove", "setquantity"].includes(act)) {
      return res.status(400).json({
        success: false,
        error: "action must be add, remove, or setQuantity",
      });
    }

    const order = await Order.findById(id);
    if (!order) return res.status(404).json({ success: false, error: "Order not found" });

    if (!EDITABLE_ORDER_STATUSES.has(order.status)) {
      return res.status(400).json({
        success: false,
        error: `Cannot edit items when order is ${order.status}`,
      });
    }

    const actor = req.user?.userName || "admin";

    if (act === "add") {
      if (!productId) {
        return res.status(400).json({ success: false, error: "productId required" });
      }
      const qty = Math.max(1, Number(quantity) || 1);
      const product = await Product.findOne({ _id: productId, deletedAt: null });
      if (!product) {
        return res.status(404).json({ success: false, error: "Product not found" });
      }

      const existing = (order.items || []).find(
        (it) => productIdOf(it) === String(product._id),
      );
      if (existing) {
        existing.quantity = Number(existing.quantity || 0) + qty;
        const unitDiscount = Math.max(
          (existing.mrp || 0) - (existing.price || 0),
          0,
        );
        existing.discount = existing.quantity * unitDiscount;
        existing.subtotal = existing.quantity * (existing.price || 0);
      } else {
        order.items.push(snapshotItemFromProduct(product, qty));
      }

      if (!isPickingUnavailable(order, product._id)) {
        await Product.updateOne(
          { _id: product._id },
          { $inc: { stock: -qty }, $set: { updatedAt: new Date() } },
        );
      }

      order.tracking.push({
        status: order.status,
        note: `Added ${qty}× ${product.name}`,
        by: actor,
        at: new Date(),
      });
    } else if (act === "remove") {
      if (!itemId && !productId) {
        return res.status(400).json({
          success: false,
          error: "itemId or productId required",
        });
      }
      const idx = (order.items || []).findIndex((it) => {
        if (itemId && String(it._id) === String(itemId)) return true;
        if (productId && productIdOf(it) === String(productId)) return true;
        return false;
      });
      if (idx < 0) {
        return res.status(404).json({ success: false, error: "Item not found" });
      }
      if ((order.items || []).length <= 1) {
        return res.status(400).json({
          success: false,
          error: "Order must keep at least one item",
        });
      }

      const [removed] = order.items.splice(idx, 1);
      const pid = productIdOf(removed);
      const qty = Number(removed.quantity || 0);
      if (pid && qty > 0 && !isPickingUnavailable(order, pid)) {
        await Product.updateOne(
          { _id: pid },
          { $inc: { stock: qty }, $set: { updatedAt: new Date() } },
        );
      }

      order.tracking.push({
        status: order.status,
        note: `Removed ${qty}× ${removed.name}`,
        by: actor,
        at: new Date(),
      });
    } else {
      // setQuantity
      if (!itemId && !productId) {
        return res.status(400).json({
          success: false,
          error: "itemId or productId required",
        });
      }
      const newQty = Number(quantity);
      if (!Number.isFinite(newQty) || newQty < 1) {
        return res.status(400).json({
          success: false,
          error: "quantity must be at least 1",
        });
      }
      const item = (order.items || []).find((it) => {
        if (itemId && String(it._id) === String(itemId)) return true;
        if (productId && productIdOf(it) === String(productId)) return true;
        return false;
      });
      if (!item) {
        return res.status(404).json({ success: false, error: "Item not found" });
      }

      const oldQty = Number(item.quantity || 0);
      const delta = newQty - oldQty;
      item.quantity = newQty;
      const unitDiscount = Math.max((item.mrp || 0) - (item.price || 0), 0);
      item.discount = newQty * unitDiscount;
      item.subtotal = newQty * (item.price || 0);

      const pid = productIdOf(item);
      if (pid && delta !== 0 && !isPickingUnavailable(order, pid)) {
        await Product.updateOne(
          { _id: pid },
          { $inc: { stock: -delta }, $set: { updatedAt: new Date() } },
        );
      }

      order.tracking.push({
        status: order.status,
        note: `Qty ${item.name}: ${oldQty} → ${newQty}`,
        by: actor,
        at: new Date(),
      });
    }

    order.billingSummary = calculateSummary(order.items);
    syncPickingQuantities(order);
    order.updatedBy = actor;
    order.markModified("items");
    order.markModified("billingSummary");
    await order.save();

    const populated = await Order.findById(order._id).populate("items.product");
    const [enriched] = await enrichOrdersWithAddress([populated]);
    res.json({ success: true, data: enriched });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: "Failed to update order items",
      message: err.message,
    });
  }
};

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
