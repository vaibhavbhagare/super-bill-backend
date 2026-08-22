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
