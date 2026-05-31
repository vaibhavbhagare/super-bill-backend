const Store = require("../models/store");

const LOW_STOCK_THRESHOLD_DEFAULT = 5;

const clampMinStock = (value, fallback = LOW_STOCK_THRESHOLD_DEFAULT) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.floor(n), 0), 999999);
};

const getStoreDefaultMinStock = async () => {
  const store = await Store.findOne({
    $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
  })
    .select("defaultMinStock")
    .lean();

  if (store?.defaultMinStock != null) {
    return clampMinStock(store.defaultMinStock);
  }
  return LOW_STOCK_THRESHOLD_DEFAULT;
};

/** Mongo match: stock <= (product.minStock ?? storeDefault) */
const lowStockFindMatch = (storeDefaultMinStock, extra = {}) => ({
  ...extra,
  deletedAt: null,
  $expr: {
    $lte: ["$stock", { $ifNull: ["$minStock", storeDefaultMinStock] }],
  },
});

const lowStockExprMatch = (storeDefaultMinStock, stockField = "$stock", minField = "$minStock") => ({
  $expr: {
    $lte: [stockField, { $ifNull: [minField, storeDefaultMinStock] }],
  },
});

const mapLowStockProduct = (p, storeDefaultMinStock) => ({
  productId: p._id,
  name: p.name,
  secondName: p.secondName,
  stock: p.stock,
  minStock: p.minStock ?? null,
  effectiveMinStock: p.minStock != null ? clampMinStock(p.minStock) : storeDefaultMinStock,
});

const parseProductMinStock = (value) => {
  if (value === "" || value === null || value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return clampMinStock(n);
};

module.exports = {
  LOW_STOCK_THRESHOLD_DEFAULT,
  clampMinStock,
  getStoreDefaultMinStock,
  lowStockFindMatch,
  lowStockExprMatch,
  mapLowStockProduct,
  parseProductMinStock,
};
