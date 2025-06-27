const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    secondName: { type: String },
    searchKey: { type: String },
    category: { type: String },
    stock: { type: Number, required: true, default: 0 },
    mrp: { type: Number, required: true },
    sellingPrice1: { type: Number, required: true },
    sellingPrice2: { type: Number, required: true },
    brand: { type: String },
    purchasePrice: { type: Number, required: true },
    unit: {
      type: String,
      enum: ["KG", "GM", "PCS", "ML", "L", "PCS", "OTHER"],
    },
    createdBy: { type: String, required: true },
    updatedBy: { type: String },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("Product", productSchema);
