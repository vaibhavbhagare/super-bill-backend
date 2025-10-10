const Order = require("../models/Order");
const Product = require("../models/Product");
const Customer = require("../models/Customer");
const Invoice = require("../models/Invoice");

// Helpers
const calculateSummary = (items) => {
  const subtotal = items.reduce((sum, it) => sum += (it.subtotal || (it.quantity * it.price)), 0);
  const discount = items.reduce((sum, it) => sum += (it.discount || 0), 0);
  const gst = 0; // Not specified in e-comm flow
  const total = subtotal - discount + gst;
  return { subtotal, discount, gst, total };
};

const snapshotItemFromProduct = (product, quantity) => {
  return {
    product: product._id,
    name: product.name,
    secondName: product.secondName,
    quantity,
    price: product.sellingPrice1,
    purchasePrice: product.purchasePrice,
    mrp: product.mrp,
    discount: product.discountPercentage ? Math.round(((product.mrp - product.sellingPrice1) / product.mrp) * 100) : 0,
    subtotal: quantity * product.sellingPrice1,
  };
};

// CART APIs (per-user simple cart backed by an Order with status CART)
const getOrCreateCart = async (req) => {
  const userId = req.user ? req.user._id : null;
  // For now, associate with user if logged in; otherwise create anonymous cart with createdBy
  let cart = await Order.findOne({ status: "CART", createdBy: userId ? String(userId) : undefined, deletedAt: null });
  if (!cart) {
    cart = await Order.create({ status: "CART", tracking: [{ status: "CART", note: "Cart created", by: userId ? req.user.userName : "guest" }], createdBy: userId ? String(userId) : "guest" });
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
    const { customerId, customerInfo, paymentMethod = "COD", products } = req.body;
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
    const dbProducts = await Product.find({ _id: { $in: productIds }, deletedAt: null, isActive: true });
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

    // Reserve stock
    for (const it of items) {
      const prod = idToProduct.get(String(it.product));
      // it.product is ObjectId, so map lookup by String
    }
    for (const reqItem of requested) {
      const prod = idToProduct.get(String(reqItem.productId));
      prod.stock -= reqItem.quantity;
      await prod.save();
    }

    // Create order directly
    const billingSummary = calculateSummary(items);
    const order = await Order.create({
      items,
      status: "PLACED",
      placedAt: new Date(),
      paymentMethod,
      paymentStatus: paymentMethod === "ONLINE" ? "PAID" : "UNPAID",
      customer: customer ? customer._id : undefined,
      customerSnapshot: customer
        ? { fullName: customer.fullName, phoneNumber: customer.phoneNumber, address: customer.address }
        : (customerInfo || {}),
      billingSummary,
      tracking: [{ status: "PLACED", note: "Order placed", by: req.user ? req.user.userName : "guest" }],
      channel: "ONLINE",
      createdBy: req.user ? req.user.userName : "guest",
    });

    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to place order", message: err.message });
  }
};

// ADMIN: update status and auto-invoice on COMPLETED
exports.updateStatus = async (req, res) => {
  try {
    if (!req.user || req.user.role !== "admin") {
      return res.status(403).json({ success: false, error: "Admin only" });
    }
    const { id } = req.params;
    const { status, note } = req.body;
    const allowed = ["CONFIRMED", "PACKING", "SHIPPED", "DELIVERED", "COMPLETED", "CANCELLED"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, error: "Invalid status" });
    }
    const order = await Order.findById(id).populate("items.product");
    if (!order) return res.status(404).json({ success: false, error: "Order not found" });

    order.status = status;
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
      // Create invoice if not exists
      if (!order.invoice) {
        const invoiceDoc = await Invoice.create({
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
          transactionType: order.paymentMethod === "ONLINE" ? "ONLINE" : (order.paymentMethod === "CASH" ? "CASH" : "CREDIT"),
          channel: "ONLINE",
          createdBy: req.user ? req.user.userName : "system",
        });
        order.invoice = invoiceDoc._id;
        order.paymentStatus = "PAID"; // assume completed means paid
      }
    }

    order.tracking.push({ status, note, by: req.user ? req.user.userName : "system" });
    await order.save();
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to update status", message: err.message });
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
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to cancel order", message: err.message });
  }
};

exports.getOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const order = await Order.findById(id).populate("items.product");
    if (!order) return res.status(404).json({ success: false, error: "Order not found" });
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to fetch order", message: err.message });
  }
};

exports.listOrders = async (req, res) => {
  try {
    if (!req.user || req.user.role !== "admin") {
      return res.status(403).json({ success: false, error: "Admin only" });
    }
    const { status, page = 1, limit = 20 } = req.query;
    const filter = { deletedAt: null };
    if (status) filter.status = status;
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


