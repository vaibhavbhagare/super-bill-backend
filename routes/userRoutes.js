const express = require("express");
const router = express.Router();
const userController = require("../controllers/userController");
const { auth } = require("../middleware/auth");
const { loadStore } = require("../middleware/loadStore");
const { requireFeature } = require("../middleware/accessControl");
const { Features } = require("../access/features");

// Public routes (no authentication required)
router.post("/login", userController.loginUser);
router.post("/logout", userController.logoutUser);

// Protected routes (authentication required)
router.use(auth);
router.use(loadStore);

const requireAdminOrSuperAdmin = (req, res, next) => {
  if (!req.user || !["admin", "super_admin"].includes(req.user.role)) {
    return res.status(403).json({ error: "Admin only", code: "FORBIDDEN" });
  }
  next();
};

// User management routes
router.get("/me", userController.getCurrentUser); // Get current user profile
router.post("/", requireAdminOrSuperAdmin, requireFeature(Features.USERS_CREATE), userController.createUser);
router.get("/", requireAdminOrSuperAdmin, requireFeature(Features.USERS_VIEW), userController.getUsers);
router.get("/:id", requireAdminOrSuperAdmin, requireFeature(Features.USERS_VIEW), userController.getUserById);
router.put("/:id", requireAdminOrSuperAdmin, requireFeature(Features.USERS_EDIT), userController.updateUser);
router.delete("/:id", requireAdminOrSuperAdmin, requireFeature(Features.USERS_DELETE), userController.deleteUser);

// WhatsApp broadcast route
router.post(
  "/whatsapp-broadcast-diwali",
  requireAdminOrSuperAdmin,
  userController.sendWhatsAppToAllUsers,
); // Send WhatsApp message to all users

module.exports = router;
