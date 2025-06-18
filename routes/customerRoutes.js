const express = require("express");
const router = express.Router();
const customerController = require("../controllers/customerController");
const { auth } = require("../middleware/auth");

// Apply auth middleware to all routes
router.use(auth);

// Customer routes
router.post("/", customerController.createCustomer);
router.get("/", customerController.getCustomers);
router.get("/:id", customerController.getCustomerById);
router.put("/:id", customerController.updateCustomer);
router.delete("/:id", customerController.deleteCustomer);

module.exports = router;