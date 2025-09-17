const express = require("express");
const {
  createStore,
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
router.get("/", getStores);
router.get("/:id", getStoreById);

// Update
router.put("/:id", updateStore);

// Update Print Bill Settings
router.put("/:id/print-bill-settings", updatePrintBillSettings);

// Update Barcode Settings
router.put("/:id/barcode-settings", updateBarcodeSettings);

// Delete
router.delete("/:id", deleteStore);

module.exports = router;
