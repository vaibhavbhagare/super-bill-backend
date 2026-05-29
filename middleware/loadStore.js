const Store = require("../models/store");

const loadStore = async (req, res, next) => {
  try {
    if (req.store) return next();

    const store = await Store.findOne({
      $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
    });

    req.store = store;
    next();
  } catch (error) {
    res.status(500).json({
      error: "Failed to load store",
      code: "STORE_LOAD_ERROR",
    });
  }
};

module.exports = { loadStore };
