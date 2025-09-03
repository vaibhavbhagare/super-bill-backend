const express = require("express");
const router = express.Router();
const multer = require("multer");
const imageUploadController = require("../controllers/imageUploadController");
const { auth } = require("../middleware/auth");

const storage =
  process.env.NODE_ENV === "production"
    ? multer.memoryStorage()
    : multer.diskStorage({ dest: "./uploads/" });

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
});

// Protected routes (authentication required)
router.use(auth); // Apply auth middleware to all routes below

router.post(
  "/upload/:productId",
  upload.single("image"),
  imageUploadController.uploadProductImage
);

// Delete image
router.delete("/:productId", imageUploadController.deleteProductImage);
module.exports = router;
