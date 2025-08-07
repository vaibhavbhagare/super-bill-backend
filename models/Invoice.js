const mongoose = require("mongoose");

const invoiceSchema = new mongoose.Schema(
  {
    buyingProducts: [
      {
        product: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
          required: true,
        },
        name: String,
        secondName: String,
        quantity: { type: Number, required: true },
        price: { type: Number, required: true }, // selling price at time of sale
        mrp: Number,
        discount: Number,
        subtotal: Number,
      },
    ],
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
    },
    billingSummary: {
      total: Number,
      subtotal: Number,
      discount: Number,
      gst: Number,
    },
    billerId: { type: String, required: true },
    billerName: { type: String, required: true },
    sendWhatsappMessage: { type: Boolean, default: false },
    transactionType: {
      type: String,
      enum: ["ONLINE", "CASH", "CREDIT"],
      required: true,
    },
    invoiceNumber: { type: String, unique: true }, // optional, for tracking
    paymentStatus: {
      type: String,
      enum: ["PAID", "UNPAID"],
      default: "PAID",
    }, // optional
    createdBy: { type: String, required: true },
    updatedBy: { type: String },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: String },
  },
  { timestamps: true },
);

invoiceSchema.index(
  { deletedAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 30 },
);

invoiceSchema.statics.softDelete = async function (id, deletedBy) {
  return this.findByIdAndUpdate(
    id,
    {
      $set: {
        deletedAt: new Date(),
        deletedBy,
        updatedAt: new Date(),
      },
    },
    { new: true },
  );
};

module.exports = mongoose.model("Invoice", invoiceSchema);
