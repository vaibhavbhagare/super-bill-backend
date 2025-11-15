const mongoose = require("mongoose");

const productStatsSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true, unique: true, index: true },
    totalUnitsSold: { type: Number, default: 0, index: true },
    totalTimesSold: { type: Number, default: 0, index: true },
    posUnitsSold: { type: Number, default: 0, index: true },
    posTimesSold: { type: Number, default: 0, index: true },
    onlineUnitsSold: { type: Number, default: 0, index: true },
    onlineTimesSold: { type: Number, default: 0, index: true },
    lastSoldAt: { type: Date },
    lastInvoice: { type: mongoose.Schema.Types.ObjectId, ref: "Invoice" },
  },
  { timestamps: true }
);

productStatsSchema.index({ totalUnitsSold: -1 });
productStatsSchema.index({ lastSoldAt: -1 });

module.exports = mongoose.model("ProductStats", productStatsSchema);


