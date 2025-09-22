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
    
    // Soft delete fields
    deletedAt: { type: Date, default: null },
    deletedBy: { type: String },
  },
  { timestamps: true },
);

SalarySchema.index({ user: 1, month: 1 }, { unique: true }); // Prevent duplicate salary for user/month

// Add index for soft delete
SalarySchema.index({ deletedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

// Add soft delete method
SalarySchema.statics.softDelete = async function (id, deletedBy) {
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

module.exports = mongoose.model("Salary", SalarySchema);
