const express = require("express");
const router = express.Router();
const ecommerceController = require("../controllers/ecommerceController");
const {
  productSearchLimiter,
  productDetailLimiter,
  validateEcommerceRequest,
  sanitizeEcommerceResponse
} = require("../middleware/ecommerceSecurity");

// Apply security middleware to all routes
router.use(sanitizeEcommerceResponse);

// Public e-commerce routes (no authentication required)
// Products
router.get("/products", 
  productSearchLimiter, 
  validateEcommerceRequest, 
  ecommerceController.getProducts
);

router.get("/products/filters", 
  productSearchLimiter, 
  validateEcommerceRequest, 
  ecommerceController.getProductFilters
);

router.get("/products/:id", 
  productDetailLimiter, 
  ecommerceController.getProductById
);

module.exports = router;
