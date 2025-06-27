const express = require("express");
const router = express.Router();
const productController = require("../controllers/productController");
const { auth } = require("../middleware/auth");

// Apply auth middleware to all routes
router.use(auth);

// Product routes
router.post("/", productController.createProduct);
router.get("/", productController.getProducts);
router.get("/:id", productController.getProductById);
router.put("/:id", productController.updateProduct);
router.delete("/:id", productController.deleteProduct);

module.exports = router;
