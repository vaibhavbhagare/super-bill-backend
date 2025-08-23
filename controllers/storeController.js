const Store = require("../models/store");

// ✅ Create a Store
exports.createStore = async (req, res) => {
  try {
    const store = new Store(req.body);
    const savedStore = await store.save();
    res.status(201).json({
      success: true,
      message: "Store created successfully",
      data: savedStore,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: "Failed to create store",
      error: error.message,
    });
  }
};

// ✅ Get all Stores
exports.getStores = async (req, res) => {
  try {
    const stores = await Store.find().sort({ createdAt: -1 });
    res.status(200).json({
      success: true,
      count: stores.length,
      data: stores,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch stores",
      error: error.message,
    });
  }
};

// ✅ Get Store by ID
exports.getStoreById = async (req, res) => {
  try {
    const store = await Store.findById(req.params.id);
    if (!store) {
      return res.status(404).json({
        success: false,
        message: "Store not found",
      });
    }
    res.status(200).json({
      success: true,
      data: store,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch store",
      error: error.message,
    });
  }
};

// ✅ Update Store
exports.updateStore = async (req, res) => {
  try {
    const updatedStore = await Store.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    if (!updatedStore) {
      return res.status(404).json({
        success: false,
        message: "Store not found",
      });
    }
    res.status(200).json({
      success: true,
      message: "Store updated successfully",
      data: updatedStore,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: "Failed to update store",
      error: error.message,
    });
  }
};

// ✅ Delete Store
exports.deleteStore = async (req, res) => {
  try {
    const deletedStore = await Store.findByIdAndDelete(req.params.id);
    if (!deletedStore) {
      return res.status(404).json({
        success: false,
        message: "Store not found",
      });
    }
    res.status(200).json({
      success: true,
      message: "Store deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to delete store",
      error: error.message,
    });
  }
};
