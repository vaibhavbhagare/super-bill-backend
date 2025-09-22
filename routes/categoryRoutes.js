const express = require("express");
const router = express.Router();
const categoryController = require("../controllers/categoryController");
const { auth } = require("../middleware/auth");

// Apply auth middleware to all routes
router.use(auth);

// Category routes
router.post("/", categoryController.createCategory);
router.get("/", categoryController.getCategories);
router.get("/:id", categoryController.getCategoryById);
router.put("/:id", categoryController.updateCategory);
router.delete("/:id", categoryController.deleteCategory);

// Bulk create categories
router.post("/bulk", categoryController.bulkCreateCategories);

module.exports = router;


