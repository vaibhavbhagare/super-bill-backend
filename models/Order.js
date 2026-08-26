const mongoose = require("mongoose");

const orderItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    name: { type: String, required: true },
    secondName: { type: String },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true }, // selling price snapshot
    purchasePrice: { type: Number, required: true }, // purchase price snapshot
    mrp: { type: Number },
    discount: { type: Number },
    subtotal: { type: Number, required: true },
  },
  { _id: true },
);

const orderTrackingSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: [
        "CART",
        "PLACED",
        "CONFIRMED",
        "PACKING",
        "OUT FOR DELIVERY",
        "READY FOR STORE PICKUP",
        "DELIVERED",
        "COMPLETED",
        "CANCELLED",
      ],
      required: true,
    },
    note: { type: String },
    at: { type: Date, default: Date.now },
    by: { type: String }, // userName or system
  },
  { _id: false },
);

const orderPickingItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    name: { type: String },
    quantity: { type: Number, default: 0 },
    picked: { type: Boolean, default: false },
    unavailable: { type: Boolean, default: false },
    note: { type: String },
    pickedAt: { type: Date },
    pickedBy: { type: String },
  },
  { _id: true },
);

const orderDeliverySchema = new mongoose.Schema(
  {
    assignedTo: { type: String },
    assignedToName: { type: String },
    phone: { type: String },
    vehicle: { type: String },
    trackingNote: { type: String },
    assignedAt: { type: Date },
    assignedBy: { type: String },
  },
  { _id: false },
);

const orderSchema = new mongoose.Schema(
  {
    items: [orderItemSchema],
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "Customer" },
    customerSnapshot: {
      fullName: String,
      phoneNumber: Number,
      address: String,
    },
    status: {
      type: String,
      enum: [
        "CART",
        "PLACED",
        "CONFIRMED",
        "PACKING",
      "OUT FOR DELIVERY",
      "READY FOR STORE PICKUP",
        "DELIVERED",
        "COMPLETED",
        "CANCELLED",
      ],
      default: "CART",
      index: true,
    },
    tracking: [orderTrackingSchema],
    orderType: {
      type: String,
      enum: ["HOME_DELIVERY", "STORE_PICKUP"],
      default: "HOME_DELIVERY",
      index: true,
    },
    billingSummary: {
      total: Number,
      subtotal: Number,
      discount: Number,
      gst: Number,
    },
    paymentStatus: { type: String, enum: ["PAID", "UNPAID"], default: "UNPAID" },
    paymentMethod: { type: String, enum: ["ONLINE", "CASH", "COD"], default: "COD" },
    razorpayOrderId: { type: String, index: true, sparse: true },
    razorpayPaymentId: { type: String, index: true, sparse: true },
    channel: { type: String, enum: ["ONLINE"], default: "ONLINE", index: true },
    placedAt: { type: Date },
    completedAt: { type: Date },
    cancelledAt: { type: Date },
    cancelledBy: { type: String },
    cancelledReason: { type: String },
    picking: [orderPickingItemSchema],
    delivery: orderDeliverySchema,
    invoice: { type: mongoose.Schema.Types.ObjectId, ref: "Invoice" },
    createdBy: { type: String },
    updatedBy: { type: String },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: String },
  },
  { timestamps: true },
);

orderSchema.index({ createdAt: -1 });
orderSchema.index({ deletedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

module.exports = mongoose.model("Order", orderSchema);


