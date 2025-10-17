const express = require("express");
const router = express.Router();
const userController = require("../controllers/userController");
const { auth } = require("../middleware/auth");

// Public routes (no authentication required)
router.post("/login", userController.loginUser);
router.post("/logout", userController.logoutUser);

// Protected routes (authentication required)
router.use(auth); // Apply auth middleware to all routes below

// User management routes
router.get("/me", userController.getCurrentUser); // Get current user profile
router.post("/", userController.createUser); // Create new user
router.get("/", userController.getUsers); // Get all users
router.get("/:id", userController.getUserById); // Get user by ID
router.put("/:id", userController.updateUser); // Update user
router.delete("/:id", userController.deleteUser); // Delete user

// WhatsApp broadcast route
router.post("/whatsapp-broadcast-diwali", userController.sendWhatsAppToAllUsers); // Send WhatsApp message to all users

module.exports = router;
