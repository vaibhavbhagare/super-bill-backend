const mongoose = require("mongoose");

const khataTransactionSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["credit", "payment"],
      required: true,
    },
    amount: { type: Number, required: true, min: 0.01 },
    note: { type: String, default: "" },
    balanceAfter: { type: Number, required: true, default: 0 },
    autoReminderSent: { type: Boolean, default: false },
    reminderStatus: {
      type: String,
      enum: ["sent", "failed", "skipped", null],
      default: null,
    },
    createdBy: { type: String, default: "system" },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: String },
  },
  { timestamps: true },
);

khataTransactionSchema.index({ customerId: 1, createdAt: -1 });
khataTransactionSchema.index({ deletedAt: 1 });

module.exports = mongoose.model("KhataTransaction", khataTransactionSchema);
