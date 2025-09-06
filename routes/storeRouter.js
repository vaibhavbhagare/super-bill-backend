const express = require("express");
const router = express.Router();
const storeController = require("../controllers/storeController");

// CRUD routes
router.post("/", storeController.createStore);
router.get("/", storeController.getStores);
router.get("/:id", storeController.getStoreById);
router.put("/:id", storeController.updateStore);
router.delete("/:id", storeController.deleteStore);

// Extra: mark as synced
router.patch("/:id/sync", storeController.markStoreAsSynced);

module.exports = router;