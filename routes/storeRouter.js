const express = require("express");
const {
  createStore,
  getStores,
  getStoreById,
  updateStore,
  deleteStore,
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

// Delete
router.delete("/:id", deleteStore);

module.exports = router;
