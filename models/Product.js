const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    secondName: { type: String },
    barcode: { type: Number, required: true, unique: true },
    searchKey: { type: String },
    category: { type: String },
    stock: { type: Number, required: true, default: 0 },
    mrp: { type: Number, required: true },
    sellingPrice1: { type: Number, required: true },
    sellingPrice2: { type: Number, required: true },
    brand: { type: String },
    purchasePrice: { type: Number, required: true },
    isSynced: { type: Boolean },
    hsnCode: { type: String },
    expiryDate: { type: Date },
    unit: {
      type: String,
      enum: ["KG", "GM", "PCS", "ML", "L", "PCS", "OTHER"],
    },
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

// TTL index to fully remove documents some time after deletion (e.g., 30 days)
productSchema.index(
  { deletedAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 30 },
);

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
  console.log(result);
  return result;
};

module.exports = mongoose.model("Product", productSchema);
