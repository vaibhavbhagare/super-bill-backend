const mongoose = require("mongoose");

const reminderHistorySchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      default: null,
    },
    customerName: { type: String, trim: true },
    mobile: { type: String, required: true, trim: true },
    message: { type: String, required: true },
    amount: { type: Number, default: null },
    status: {
      type: String,
      enum: ["sent", "failed"],
      required: true,
    },
    errorMessage: { type: String, default: null },
    sentBy: { type: String, required: true },
    sentAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

reminderHistorySchema.index({ customerId: 1, sentAt: -1 });
reminderHistorySchema.index({ mobile: 1 });
reminderHistorySchema.index({ status: 1 });
reminderHistorySchema.index({ sentAt: -1 });

module.exports = mongoose.model("ReminderHistory", reminderHistorySchema);
