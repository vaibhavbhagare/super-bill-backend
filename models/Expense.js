const mongoose = require("mongoose");

const expenseSchema = new mongoose.Schema(
  {
    title: { 
      type: String, 
      required: true,
      trim: true 
    },
    description: { 
      type: String, 
      trim: true 
    },
    amount: { 
      type: Number, 
      required: true,
      min: 0 
    },
    category: { 
      type: String, 
      required: true,
      enum: [
        "office_supplies",
        "utilities", 
        "rent",
        "transportation",
        "marketing",
        "equipment",
        "maintenance",
        "food",
        "travel",
        "other"
      ]
    },
    paymentMethod: {
      type: String,
      required: true,
      enum: ["cash", "card", "bank_transfer", "cheque", "upi"]
    },
    receiptNumber: { 
      type: String, 
      trim: true 
    },
    receiptImage: { 
      type: String 
    },
    expenseDate: { 
      type: Date, 
      required: true,
      default: Date.now 
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending"
    },
    approvedBy: { 
      type: String 
    },
    approvedAt: { 
      type: Date 
    },
    rejectedReason: { 
      type: String 
    },
    isSynced: { 
      type: Boolean, 
      default: false 
    },
    createdBy: { 
      type: String, 
      required: true 
    },
    updatedBy: { 
      type: String 
    },
    deletedAt: { 
      type: Date, 
      default: null 
    },
    deletedBy: { 
      type: String 
    }
  },
  {
    timestamps: true,
  }
);

// Index for efficient queries
expenseSchema.index({ expenseDate: -1 });
expenseSchema.index({ category: 1 });
expenseSchema.index({ status: 1 });
expenseSchema.index({ deletedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

// Static method to mark as synced
expenseSchema.statics.markAsSynced = async function (id) {
  const result = await this.findByIdAndUpdate(
    { _id: id, isSynced: false },
    { $set: { isSynced: true } },
    { new: true }
  );
  return result;
};

// Static method for soft delete
expenseSchema.statics.softDelete = async function (id, deletedBy) {
  return this.findByIdAndUpdate(
    id,
    {
      $set: {
        deletedAt: new Date(),
        deletedBy,
        updatedAt: new Date(),
      },
    },
    { new: true }
  );
};

// Static method to approve expense
expenseSchema.statics.approveExpense = async function (id, approvedBy) {
  return this.findByIdAndUpdate(
    id,
    {
      $set: {
        status: "approved",
        approvedBy,
        approvedAt: new Date(),
        updatedAt: new Date(),
      },
    },
    { new: true }
  );
};

// Static method to reject expense
expenseSchema.statics.rejectExpense = async function (id, rejectedReason, rejectedBy) {
  return this.findByIdAndUpdate(
    id,
    {
      $set: {
        status: "rejected",
        rejectedReason,
        approvedBy: rejectedBy,
        approvedAt: new Date(),
        updatedAt: new Date(),
      },
    },
    { new: true }
  );
};

module.exports = mongoose.model("Expense", expenseSchema);
