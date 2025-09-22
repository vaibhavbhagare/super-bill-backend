const express = require("express");
const router = express.Router();
const multer = require("multer");
const imageUploadController = require("../controllers/imageUploadController");
const { auth } = require("../middleware/auth");


const upload = multer({ dest: "uploads/" });

// Protected routes (authentication required)
router.use(auth); // Apply auth middleware to all routes below
 
router.post("/upload/:productId", upload.single("image"), imageUploadController.uploadProductImage);
router.post("/upload/category/:categoryId", upload.single("image"), imageUploadController.uploadCategoryImage);

// Delete image
router.delete("/:productId", imageUploadController.deleteProductImage);
router.delete("/category/:categoryId", imageUploadController.deleteCategoryImage);
module.exports = router;
