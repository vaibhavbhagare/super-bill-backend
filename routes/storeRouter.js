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
  getStoreSubscription,
  updateStoreSubscription,
} = require("../controllers/storeController");

const router = express.Router();
const { auth } = require("../middleware/auth");
const { requireSuperAdmin } = require("../middleware/accessControl");
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

// Subscription (super_admin only)
router.get("/:id/subscription", getStoreSubscription);
router.patch(
  "/:id/subscription",
  requireSuperAdmin,
  updateStoreSubscription,
);

// Delete
router.delete("/:id", deleteStore);

module.exports = router;
