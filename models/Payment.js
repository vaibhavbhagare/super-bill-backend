const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },
    amountInPaise: { type: Number, required: true, min: 100 },
    currency: { type: String, default: "INR" },
    status: {
      type: String,
      enum: ["CREATED", "PAID", "FAILED", "REFUNDED"],
      default: "CREATED",
      index: true,
    },
    razorpayOrderId: { type: String, required: true, unique: true },
    razorpayPaymentId: { type: String, sparse: true },
    razorpaySignature: { type: String },
    method: { type: String },
    email: { type: String },
    contact: { type: String },
    receipt: { type: String, required: true },
    storeOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      index: true,
      sparse: true,
    },
    channel: { type: String, enum: ["mobile", "web"], default: "mobile" },
    orderType: {
      type: String,
      enum: ["HOME_DELIVERY", "STORE_PICKUP"],
    },
    products: [
      {
        productId: String,
        quantity: Number,
      },
    ],
    itemsTotal: { type: Number },
    failureReason: { type: String },
    paidAt: { type: Date },
    failedAt: { type: Date },
  },
  { timestamps: true },
);

paymentSchema.index({ customerId: 1, createdAt: -1 });
paymentSchema.index({ razorpayPaymentId: 1 }, { sparse: true });

module.exports = mongoose.model("Payment", paymentSchema);
