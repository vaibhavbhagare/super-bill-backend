const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    secondName: { type: String },
    barcode: { type: Number, required: true },
    searchKey: { type: String },
    category: { type: String },
    stock: { type: Number, required: true, default: 0 },
    mrp: { type: Number, required: true },
    sellingPrice1: { type: Number, required: true },
    sellingPrice2: { type: Number, required: true },
    brand: { type: String },
    purchasePrice: { type: Number, required: true },
    isSynced: { type: Boolean, required: true },
    unit: {
      type: String,
      enum: ["KG", "GM", "PCS", "ML", "L", "PCS", "OTHER"],
    },
    createdBy: { type: String, required: true },
    updatedBy: { type: String },
  },
  {
    timestamps: true,
  }
);

productSchema.statics.markAsSynced = async function (id) {
  const result=  await this.findByIdAndUpdate(
    { _id: id, isSynced: false },
    { $set: { isSynced: true } }
  );
  console.log(result);
  return result;
};

module.exports = mongoose.model("Product", productSchema);
