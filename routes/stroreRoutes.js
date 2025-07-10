const express = require("express");
const { auth } = require("../middleware/auth");
const router = express.Router();
const storeController = require("../controllers/storeController");
router.use(auth);
router.post("/", storeController.createStore);
router.get("/", storeController.getStores);
router.get("/:id", storeController.getStoreById);
router.put("/:id", storeController.updateStore);
router.delete("/:id", storeController.deleteStore);

module.exports = router;
