const express = require("express");
const {
  createStore,
  getStore,
  getStores,
  getStoreById,
  updateStore,
  deleteStore,
  updatePrintBillSettings,
  updateBarcodeSettings,
} = require("../controllers/storeController");

const router = express.Router();
const { auth } = require("../middleware/auth");
router.use(auth);

// Create
router.post("/", createStore);

// Read
router.get("/", getStore); // Get single store (returns store if exists, message if not)
router.get("/all", getStores); // Get all stores (for admin purposes)
router.get("/:id", getStoreById); // Get store by specific ID

// Update
router.put("/:id", updateStore);

// Update Print Bill Settings
router.put("/:id/print-bill-settings", updatePrintBillSettings);

// Update Barcode Settings
router.put("/:id/barcode-settings", updateBarcodeSettings);

// Delete
router.delete("/:id", deleteStore);

module.exports = router;
