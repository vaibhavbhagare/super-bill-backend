const express = require("express");
const router = express.Router();
const userController = require("../controllers/userController");
const { auth } = require("../middleware/auth");

// Public routes (no authentication required)
router.post("/login", userController.loginUser);
router.post("/logout", userController.logoutUser);

// Protected routes (authentication required)
router.use(auth); // Apply auth middleware to all routes below

const requireAdminOrSuperAdmin = (req, res, next) => {
  if (!req.user || !["admin", "super_admin"].includes(req.user.role)) {
    return res.status(403).json({ error: "Admin only", code: "FORBIDDEN" });
  }
  next();
};

// User management routes
router.get("/me", userController.getCurrentUser); // Get current user profile
router.post("/", requireAdminOrSuperAdmin, userController.createUser); // Create new user
router.get("/", requireAdminOrSuperAdmin, userController.getUsers); // Get all users
router.get("/:id", requireAdminOrSuperAdmin, userController.getUserById); // Get user by ID
router.put("/:id", requireAdminOrSuperAdmin, userController.updateUser); // Update user
router.delete("/:id", requireAdminOrSuperAdmin, userController.deleteUser); // Delete user

// WhatsApp broadcast route
router.post(
  "/whatsapp-broadcast-diwali",
  requireAdminOrSuperAdmin,
  userController.sendWhatsAppToAllUsers,
); // Send WhatsApp message to all users

module.exports = router;
