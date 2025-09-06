const Store = require("../models/store");

// ✅ Create new store
exports.createStore = async (req, res) => {
  try {
    const store = new Store({
      ...req.body,
      createdBy: req.user?.id || "system", // attach user if auth exists
    });
    const savedStore = await store.save();
    return res.status(201).json(savedStore);
  } catch (err) {
    console.error("Error creating store:", err);
    return res.status(400).json({ error: err.message });
  }
};

// ✅ Get all stores (excluding soft-deleted)
exports.getStores = async (req, res) => {
  try {
    const stores = await Store.find({ deletedAt: null });
    return res.json(stores);
  } catch (err) {
    console.error("Error fetching stores:", err);
    return res.status(500).json({ error: "Server error" });
  }
};

// ✅ Get single store by ID
exports.getStoreById = async (req, res) => {
  try {
    const store = await Store.findOne({ _id: req.params.id, deletedAt: null });
    if (!store) {
      return res.status(404).json({ error: "Store not found" });
    }
    return res.json(store);
  } catch (err) {
    console.error("Error fetching store:", err);
    return res.status(500).json({ error: "Server error" });
  }
};

// ✅ Update store
exports.updateStore = async (req, res) => {
  try {
    const updatedStore = await Store.findOneAndUpdate(
      { _id: req.params.id, deletedAt: null },
      { $set: { ...req.body, updatedAt: new Date() } },
      { new: true, runValidators: true }
    );

    if (!updatedStore) {
      return res.status(404).json({ error: "Store not found or deleted" });
    }

    return res.json(updatedStore);
  } catch (err) {
    console.error("Error updating store:", err);
    return res.status(400).json({ error: err.message });
  }
};

// ✅ Soft delete store
exports.deleteStore = async (req, res) => {
  try {
    const deletedStore = await Store.softDelete(
      req.params.id,
      req.user?.id || "system"
    );

    if (!deletedStore) {
      return res.status(404).json({ error: "Store not found" });
    }

    return res.json({ message: "Store deleted successfully" });
  } catch (err) {
    console.error("Error deleting store:", err);
    return res.status(500).json({ error: "Server error" });
  }
};

// ✅ Mark store as synced
exports.markStoreAsSynced = async (req, res) => {
  try {
    const syncedStore = await Store.markAsSynced(req.params.id);
    if (!syncedStore) {
      return res.status(404).json({ error: "Store not found or already synced" });
    }
    return res.json({ message: "Store marked as synced" });
  } catch (err) {
    console.error("Error syncing store:", err);
    return res.status(500).json({ error: "Server error" });
  }
};