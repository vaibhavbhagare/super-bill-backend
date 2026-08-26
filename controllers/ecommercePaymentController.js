const Payment = require("../models/Payment");
const Product = require("../models/Product");
const mongoose = require("mongoose");
const {
  getRazorpayClient,
  getRazorpayKeys,
  verifyRazorpaySignature,
  verifyRazorpayWebhook,
} = require("../services/razorpay");

function quoteFromProducts(dbProducts, requested) {
  const idToProduct = new Map(dbProducts.map((doc) => [String(doc._id), doc]));
  let itemsTotal = 0;

  for (const line of requested) {
    const product = idToProduct.get(String(line.productId));
    if (!product || product.isActive === false) {
      const err = new Error("UNAVAILABLE");
      throw err;
    }
    itemsTotal += Number(product.sellingPrice1 || 0) * line.quantity;
  }

  const amountInPaise = Math.round(itemsTotal * 100);
  if (amountInPaise < 100) {
    throw new Error("MIN_AMOUNT");
  }

  return { amountInPaise, itemsTotal };
}

function normalizeProducts(products) {
  if (!Array.isArray(products)) return [];
  const merged = new Map();
  for (const item of products) {
    const productId = String(item.productId || item.id || "");
    const quantity = Number(item.quantity || 0);
    if (!productId || quantity < 1) continue;
    merged.set(productId, (merged.get(productId) || 0) + Math.min(quantity, 99));
  }
  return [...merged.entries()].map(([productId, quantity]) => ({
    productId,
    quantity,
  }));
}

exports.createOrder = async (req, res) => {
  try {
    const requested = normalizeProducts(req.body.products);
    if (requested.length === 0 || requested.length > 50) {
      return res.status(400).json({ success: false, error: "Invalid checkout items." });
    }

    const orderType = ["HOME_DELIVERY", "STORE_PICKUP"].includes(
      String(req.body.orderType || "").toUpperCase(),
    )
      ? String(req.body.orderType).toUpperCase()
      : "HOME_DELIVERY";
    const channel = req.body.channel === "web" ? "web" : "mobile";

    const productIds = requested
      .map((line) => line.productId)
      .filter((id) => mongoose.Types.ObjectId.isValid(id));
    if (productIds.length !== requested.length) {
      return res.status(400).json({
        success: false,
        error: "One or more items are unavailable. Please review your cart.",
      });
    }

    const dbProducts = await Product.find({
      _id: { $in: productIds },
      deletedAt: null,
    });

    let quote;
    try {
      quote = quoteFromProducts(dbProducts, requested);
    } catch (error) {
      const code = error.message;
      const message =
        code === "MIN_AMOUNT"
          ? "Order amount is too small to pay online."
          : "One or more items are unavailable. Please review your cart.";
      return res.status(400).json({ success: false, error: message });
    }

    const receipt = `es_${Date.now().toString(36)}${Math.random()
      .toString(36)
      .slice(2, 6)}`.slice(0, 40);

    const razorpay = getRazorpayClient();
    const order = await razorpay.orders.create({
      amount: quote.amountInPaise,
      currency: "INR",
      receipt,
      notes: {
        customerId: String(req.customer._id),
        channel,
        orderType,
      },
    });

    await Payment.create({
      customerId: req.customer._id,
      amountInPaise: quote.amountInPaise,
      currency: "INR",
      status: "CREATED",
      razorpayOrderId: String(order.id),
      receipt,
      channel,
      orderType,
      products: requested,
      itemsTotal: quote.itemsTotal,
    });

    const { keyId } = getRazorpayKeys();
    return res.json({
      success: true,
      data: {
        keyId,
        orderId: order.id,
        amount: Number(order.amount),
        currency: order.currency || "INR",
        receipt,
      },
    });
  } catch (error) {
    console.error("payments.create-order", error?.error || error);
    const unconfigured =
      error instanceof Error &&
      error.message.toLowerCase().includes("not configured");
    if (unconfigured) {
      return res.status(500).json({
        success: false,
        error:
          "Online payment is not available yet. Please pay with Cash on Delivery or try again later.",
      });
    }
    const description = String(error?.error?.description || error?.message || "");
    if (
      error?.statusCode === 401 ||
      description.toLowerCase().includes("authentication")
    ) {
      return res.status(502).json({
        success: false,
        error:
          "Razorpay authentication failed. Check RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in user-crud-api, then restart that server.",
      });
    }
    return res.status(500).json({
      success: false,
      error: "Could not start payment. Please try again.",
    });
  }
};

exports.verifyPayment = async (req, res) => {
  try {
    const razorpayOrderId = String(req.body.razorpay_order_id || "");
    const razorpayPaymentId = String(req.body.razorpay_payment_id || "");
    const razorpaySignature = String(req.body.razorpay_signature || "");

    if (
      razorpayOrderId.length < 8 ||
      razorpayPaymentId.length < 8 ||
      razorpaySignature.length < 10
    ) {
      return res.status(400).json({ success: false, error: "Invalid payment response." });
    }

    if (!verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature)) {
      return res.status(400).json({
        success: false,
        error: "Payment signature verification failed.",
      });
    }

    const pending = await Payment.findOne({
      razorpayOrderId,
      customerId: req.customer._id,
    });
    if (!pending) {
      return res.status(404).json({ success: false, error: "Payment order was not found." });
    }

    if (pending.status === "PAID") {
      return res.json({
        success: true,
        data: {
          status: "PAID",
          razorpayOrderId,
          razorpayPaymentId: pending.razorpayPaymentId || razorpayPaymentId,
          amountInPaise: pending.amountInPaise,
          method: pending.method,
        },
      });
    }

    const razorpay = getRazorpayClient();
    const payment = await razorpay.payments.fetch(razorpayPaymentId);

    if (payment.order_id !== razorpayOrderId) {
      return res.status(400).json({
        success: false,
        error: "Payment does not match this order.",
      });
    }

    if (Number(payment.amount) !== pending.amountInPaise) {
      return res.status(400).json({
        success: false,
        error: "Paid amount does not match the order.",
      });
    }

    const okStatus = payment.status === "captured" || payment.status === "authorized";
    if (!okStatus) {
      pending.status = "FAILED";
      pending.razorpayPaymentId = razorpayPaymentId;
      pending.failureReason = payment.status;
      pending.failedAt = new Date();
      await pending.save();
      return res.status(400).json({ success: false, error: "Payment was not captured." });
    }

    pending.status = "PAID";
    pending.razorpayPaymentId = razorpayPaymentId;
    pending.razorpaySignature = razorpaySignature;
    pending.method = typeof payment.method === "string" ? payment.method : undefined;
    pending.email = typeof payment.email === "string" ? payment.email : undefined;
    pending.contact = typeof payment.contact === "string" ? payment.contact : undefined;
    pending.paidAt = new Date();
    await pending.save();

    return res.json({
      success: true,
      data: {
        status: "PAID",
        razorpayOrderId,
        razorpayPaymentId,
        amountInPaise: pending.amountInPaise,
        method: payment.method,
      },
    });
  } catch {
    return res.status(500).json({
      success: false,
      error: "Could not verify payment.",
    });
  }
};

exports.getByOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const payment = await Payment.findOne({
      storeOrderId: orderId,
      customerId: req.customer._id,
    });
    if (!payment) {
      return res.status(404).json({
        success: false,
        error: "Payment was not found for this order.",
      });
    }

    return res.json({
      success: true,
      data: {
        status: payment.status,
        razorpayOrderId: payment.razorpayOrderId,
        razorpayPaymentId: payment.razorpayPaymentId,
        amountInPaise: payment.amountInPaise,
        method: payment.method,
        paidAt: payment.paidAt,
      },
    });
  } catch {
    return res.status(500).json({
      success: false,
      error: "Could not load payment details.",
    });
  }
};

exports.webhook = async (req, res) => {
  const rawBody =
    typeof req.rawBody === "string"
      ? req.rawBody
      : Buffer.isBuffer(req.body)
        ? req.body.toString("utf8")
        : JSON.stringify(req.body || {});
  const signature = req.header("x-razorpay-signature") || "";

  if (!verifyRazorpayWebhook(rawBody, signature)) {
    return res.status(400).json({ success: false, error: "Invalid webhook signature." });
  }

  try {
    const event = typeof req.body === "object" && !Buffer.isBuffer(req.body)
      ? req.body
      : JSON.parse(rawBody);
    const payment = event?.payload?.payment?.entity;
    if (!payment?.order_id) {
      return res.json({ success: true });
    }

    if (event.event === "payment.captured") {
      await Payment.updateOne(
        { razorpayOrderId: payment.order_id },
        {
          $set: {
            status: "PAID",
            razorpayPaymentId: payment.id,
            method: payment.method,
            paidAt: new Date(),
          },
        },
      );
    } else if (event.event === "payment.failed") {
      await Payment.updateOne(
        { razorpayOrderId: payment.order_id, status: { $ne: "PAID" } },
        {
          $set: {
            status: "FAILED",
            razorpayPaymentId: payment.id,
            failureReason: payment.error_description || payment.status,
            failedAt: new Date(),
          },
        },
      );
    }

    return res.json({ success: true });
  } catch {
    return res.status(500).json({ success: false, error: "Webhook processing failed." });
  }
};

function canManagePayments(user) {
  return user && ["admin", "super_admin", "biller"].includes(user.role);
}

/** Admin: list all ecommerce payment transactions (+ COD/CASH order payments). */
exports.listAdminTransactions = async (req, res) => {
  try {
    if (!canManagePayments(req.user)) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }

    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "20", 10), 1), 100);
    const status = req.query.status ? String(req.query.status).toUpperCase() : "";
    const method = req.query.method ? String(req.query.method).toUpperCase() : "";
    const channel = req.query.channel ? String(req.query.channel).toLowerCase() : "";
    const q = (req.query.q || "").trim();
    const dateFrom = req.query.dateFrom ? new Date(req.query.dateFrom) : null;
    const dateTo = req.query.dateTo ? new Date(req.query.dateTo) : null;
    if (dateFrom) dateFrom.setHours(0, 0, 0, 0);
    if (dateTo) dateTo.setHours(23, 59, 59, 999);

    const Order = require("../models/Order");
    const Customer = require("../models/Customer");

    const paymentFilter = {};
    if (status && ["CREATED", "PAID", "FAILED", "REFUNDED"].includes(status)) {
      paymentFilter.status = status;
    }
    if (channel && ["mobile", "web"].includes(channel)) {
      paymentFilter.channel = channel;
    }
    if (dateFrom || dateTo) {
      paymentFilter.createdAt = {};
      if (dateFrom) paymentFilter.createdAt.$gte = dateFrom;
      if (dateTo) paymentFilter.createdAt.$lte = dateTo;
    }
    if (q) {
      const or = [
        { razorpayOrderId: { $regex: q, $options: "i" } },
        { razorpayPaymentId: { $regex: q, $options: "i" } },
        { receipt: { $regex: q, $options: "i" } },
        { contact: { $regex: q, $options: "i" } },
        { email: { $regex: q, $options: "i" } },
      ];
      const phoneNum = Number(q);
      if (!Number.isNaN(phoneNum) && q.length >= 8) {
        const customers = await Customer.find({
          phoneNumber: phoneNum,
        })
          .select("_id")
          .lean();
        if (customers.length) {
          or.push({ customerId: { $in: customers.map((c) => c._id) } });
        }
      }
      const nameCustomers = await Customer.find({
        fullName: { $regex: q, $options: "i" },
      })
        .select("_id")
        .limit(50)
        .lean();
      if (nameCustomers.length) {
        or.push({ customerId: { $in: nameCustomers.map((c) => c._id) } });
      }
      paymentFilter.$or = or;
    }

    // Online / Razorpay ledger
    let paymentRows = [];
    const includePayments =
      !method || method === "ONLINE" || method === "RAZORPAY";
    if (includePayments) {
      paymentRows = await Payment.find(paymentFilter)
        .populate("customerId", "fullName phoneNumber")
        .populate("storeOrderId", "status orderType paymentStatus paymentMethod")
        .sort({ createdAt: -1 })
        .lean();
    }

    // COD / CASH orders that never go through Payment collection
    let orderRows = [];
    const includeCodCash = !method || method === "COD" || method === "CASH";
    if (includeCodCash && (!status || status === "PAID" || status === "UNPAID")) {
      const orderFilter = {
        deletedAt: null,
        status: { $ne: "CART" },
        paymentMethod: method === "COD" || method === "CASH" ? method : { $in: ["COD", "CASH"] },
      };
      if (status === "PAID" || status === "UNPAID") {
        orderFilter.paymentStatus = status;
      }
      if (dateFrom || dateTo) {
        orderFilter.createdAt = {};
        if (dateFrom) orderFilter.createdAt.$gte = dateFrom;
        if (dateTo) orderFilter.createdAt.$lte = dateTo;
      }
      if (q) {
        orderFilter.$or = [
          { "customerSnapshot.fullName": { $regex: q, $options: "i" } },
          { "customerSnapshot.phoneNumber": Number.isNaN(Number(q)) ? -1 : Number(q) },
        ];
      }
      orderRows = await Order.find(orderFilter)
        .sort({ createdAt: -1 })
        .limit(500)
        .lean();
    }

    const fromPayments = paymentRows.map((p) => ({
      id: String(p._id),
      source: "payment",
      createdAt: p.createdAt,
      paidAt: p.paidAt || null,
      failedAt: p.failedAt || null,
      amount: Number(p.amountInPaise || 0) / 100,
      currency: p.currency || "INR",
      status: p.status,
      method: p.method || "ONLINE",
      paymentMethod: "ONLINE",
      channel: p.channel || null,
      orderType: p.orderType || p.storeOrderId?.orderType || null,
      receipt: p.receipt || null,
      razorpayOrderId: p.razorpayOrderId || null,
      razorpayPaymentId: p.razorpayPaymentId || null,
      failureReason: p.failureReason || null,
      customer: p.customerId
        ? {
            id: String(p.customerId._id || p.customerId),
            fullName: p.customerId.fullName,
            phoneNumber: p.customerId.phoneNumber,
          }
        : null,
      orderId: p.storeOrderId
        ? String(p.storeOrderId._id || p.storeOrderId)
        : null,
      orderStatus: p.storeOrderId?.status || null,
    }));

    const fromOrders = orderRows.map((o) => ({
      id: `order:${o._id}`,
      source: "order",
      createdAt: o.createdAt,
      paidAt: o.paymentStatus === "PAID" ? o.completedAt || o.updatedAt : null,
      failedAt: null,
      amount: Number(o.billingSummary?.subtotal ?? o.billingSummary?.total ?? 0),
      currency: "INR",
      status: o.paymentStatus === "PAID" ? "PAID" : "UNPAID",
      method: o.paymentMethod,
      paymentMethod: o.paymentMethod,
      channel: "order",
      orderType: o.orderType || null,
      receipt: null,
      razorpayOrderId: o.razorpayOrderId || null,
      razorpayPaymentId: o.razorpayPaymentId || null,
      failureReason: null,
      customer: o.customerSnapshot
        ? {
            id: o.customer ? String(o.customer) : null,
            fullName: o.customerSnapshot.fullName,
            phoneNumber: o.customerSnapshot.phoneNumber,
          }
        : null,
      orderId: String(o._id),
      orderStatus: o.status,
    }));

    const merged = [...fromPayments, ...fromOrders].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    const total = merged.length;
    const start = (page - 1) * limit;
    const pageRows = merged.slice(start, start + limit);

    const summary = {
      total,
      paidCount: merged.filter((r) => r.status === "PAID").length,
      unpaidCount: merged.filter((r) => r.status === "UNPAID").length,
      failedCount: merged.filter((r) => r.status === "FAILED").length,
      createdCount: merged.filter((r) => r.status === "CREATED").length,
      paidAmount: merged
        .filter((r) => r.status === "PAID")
        .reduce((s, r) => s + (Number(r.amount) || 0), 0),
    };

    return res.json({
      success: true,
      data: {
        transactions: pageRows,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / limit)),
        },
        summary,
      },
    });
  } catch (error) {
    console.error("listAdminTransactions", error);
    return res.status(500).json({
      success: false,
      error: "Could not load transactions.",
    });
  }
};

exports.getAdminTransaction = async (req, res) => {
  try {
    if (!canManagePayments(req.user)) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }
    const { id } = req.params;
    if (String(id).startsWith("order:")) {
      const Order = require("../models/Order");
      const order = await Order.findById(String(id).slice(6)).lean();
      if (!order) {
        return res.status(404).json({ success: false, error: "Not found" });
      }
      return res.json({ success: true, data: { source: "order", order } });
    }
    const payment = await Payment.findById(id)
      .populate("customerId", "fullName phoneNumber address")
      .populate("storeOrderId")
      .lean();
    if (!payment) {
      return res.status(404).json({ success: false, error: "Not found" });
    }
    return res.json({ success: true, data: { source: "payment", payment } });
  } catch (error) {
    console.error("getAdminTransaction", error);
    return res.status(500).json({ success: false, error: "Could not load transaction." });
  }
};
