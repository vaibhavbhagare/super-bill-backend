const mongoose = require("mongoose");

const SalarySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    month: { type: String, required: true }, // e.g., '2024-06'

    baseSalary: { type: Number, required: true },
    presentDays: { type: Number, default: 0 },
    absentDays: { type: Number, default: 0 },
    leaveDays: { type: Number, default: 0 },
    sickDays: { type: Number, default: 0 },
    halfDays: { type: Number, default: 0 },
    paidAmount: { type: Number, required: true },
    comment: {
      type: String,
      trim: true,
    },
    amount: { type: Number, required: true }, // This can mirror `calculatedSalary` or `paidAmount`
    paid: { type: Boolean, default: false },
    paidAt: { type: Date },
    remarks: String,
  },
  { timestamps: true }
);

SalarySchema.index({ user: 1, month: 1 }, { unique: true }); // Prevent duplicate salary for user/month

module.exports = mongoose.model("Salary", SalarySchema);
