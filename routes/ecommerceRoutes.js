const express = require("express");
const router = express.Router();
const ecommerceController = require("../controllers/ecommerceController");
const ecommerceOrderController = require("../controllers/ecommerceOrderController");
const { auth, optionalAuth } = require("../middleware/auth");
const {
  productSearchLimiter,
  productDetailLimiter,
  validateEcommerceRequest,
  sanitizeEcommerceResponse,
  categoriesListLimiter
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

// Categories for e-commerce
router.get("/categories",
  categoriesListLimiter,
  ecommerceController.getCategories
);

// Orders (no server-side cart)
router.post("/orders/place", optionalAuth, ecommerceOrderController.placeOrder);
router.get("/orders", auth, ecommerceOrderController.listOrders);
router.get("/orders/:id", auth, ecommerceOrderController.getOrder);
router.post("/orders/:id/status", auth, ecommerceOrderController.updateStatus);
router.post("/orders/:id/cancel", optionalAuth, ecommerceOrderController.cancelOrder);

module.exports = router;
