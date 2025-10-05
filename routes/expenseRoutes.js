const express = require("express");
const router = express.Router();
const expenseController = require("../controllers/expenseController");
const { auth } = require("../middleware/auth");

// Apply authentication middleware to all routes
router.use(auth);

// Expense CRUD routes
router.post("/", expenseController.createExpense); // Create new expense
router.get("/", expenseController.getExpenses); // Get all expenses with pagination and filtering
router.get("/stats", expenseController.getExpenseStats); // Get expense statistics
router.get("/:id", expenseController.getExpenseById); // Get expense by ID
router.put("/:id", expenseController.updateExpense); // Update expense
router.delete("/:id", expenseController.deleteExpense); // Delete expense (soft delete)

// Expense approval routes
router.patch("/:id/approve", expenseController.approveExpense); // Approve expense
router.patch("/:id/reject", expenseController.rejectExpense); // Reject expense

module.exports = router;
