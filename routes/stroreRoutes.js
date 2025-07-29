const express = require("express");
const router = express.Router();
const storeController = require("../controllers/storeController");
const { auth } = require("../middleware/auth");
router.use(auth);

router.post("/", storeController.createStore);
router.get("/", storeController.getStores);
router.get("/:id", storeController.getStoreById);
router.put("/:id", storeController.updateStore);
router.delete("/:id", storeController.deleteStore);

module.exports = router;
