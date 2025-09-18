const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, index: 'text' },
    secondName: { type: String },
    barcode: { type: Number, required: true, unique: true },
    searchKey: { type: String, index: 'text' },
    categories: [{ type: mongoose.Schema.Types.ObjectId, ref: "Category", index: true }],
    stock: { type: Number, required: true, default: 0 },
    mrp: { type: Number, required: true },
    sellingPrice1: { type: Number, required: true, index: true },
    sellingPrice2: { type: Number, required: true },
    brand: { type: String, index: true },
    purchasePrice: { type: Number, required: true },
    
    // E-commerce specific fields (only the requested ones)
    description: { type: String },
    discountPercentage: { type: Number, default: 0 },
    isOnSale: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true, index: true },
    
    // Original fields
    unit: {
      type: String,
      enum: ["KG", "GM", "PCS", "ML", "L", "OTHER"],
    },
    hsnCode: { type: String },
    expiryDate: { type: Date },
    isSynced: { type: Boolean },
    createdBy: { type: String, required: true },
    updatedBy: { type: String },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: String },
    hasImage: { type: Boolean }
  },
  {
    timestamps: true,
  },
);

// Compound indexes for better search performance
productSchema.index({ brand: 1, isActive: 1 });
productSchema.index({ sellingPrice1: 1, isActive: 1 });
productSchema.index({ createdAt: -1, isActive: 1 });

// TTL index to fully remove documents some time after deletion (e.g., 2 days)
productSchema.index(
  { deletedAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 2 },
);

// Text search index
productSchema.index({ name: 'text', searchKey: 'text', description: 'text' });

// Soft-delete helper
productSchema.statics.softDelete = async function (id, deletedBy) {
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

productSchema.statics.markAsSynced = async function (id) {
  const result = await this.findByIdAndUpdate(
    { _id: id, isSynced: false },
    { $set: { isSynced: true } },
  );
  return result;
};

// Virtual for discount calculation
productSchema.virtual('discountAmount').get(function() {
  return this.mrp - this.sellingPrice1;
});

module.exports = mongoose.model("Product", productSchema);
