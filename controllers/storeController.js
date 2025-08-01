const Store = require("../models/store");

// 🔽 Create Store
exports.createStore = async (req, res) => {
  try {
    if (!req.user || !req.user.userName) {
      return res.status(401).json({ error: "Unauthorized: User not logged in" });
    }

    const store = await Store.create({
      ...req.body,
      createdBy: req.user.userName,
    });

    return res.status(201).json({
      message: "Store created successfully",
      data: store,
    });
  } catch (err) {
    console.error("Store creation error:", err.message);
    return res.status(400).json({ error: err.message || "Failed to create store" });
  }
};


// 🔍 Get All Stores
exports.getStores = async (req, res) => {
  try {
    const stores = await Store.find().sort({ createdAt: -1 });
    res.json(stores);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// 🔍 Get Store by ID
exports.getStoreById = async (req, res) => {
  try {
    const store = await Store.findById(req.params.id);
    if (!store) return res.status(404).json({ error: "Store not found" });
    res.json(store);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ✏️ Update Store
exports.updateStore = async (req, res) => {
  try {
    const store = await Store.findByIdAndUpdate(
      req.params.id,
      { ...req.body, updatedBy: req.body.updatedBy },
      { new: true },
    );
    if (!store) return res.status(404).json({ error: "Store not found" });
    res.json(store);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// ❌ Delete Store
exports.deleteStore = async (req, res) => {
  try {
    const store = await Store.findByIdAndDelete(req.params.id);
    if (!store) return res.status(404).json({ error: "Store not found" });
    res.json({ message: "Store deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
