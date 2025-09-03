const cloudinary = require("../middleware/cloudinary");
const Product = require("../models/Product");

// exports.uploadProductImage = async (req, res) => {
//   const { productId } = req.params;
//   console.log(req.params)
//   try {
//     await cloudinary.uploader.upload(req.file.path, {
//       folder: `products/${productId}`,
//       public_id: "main", // fixed name
//       overwrite: true,
//     });

//     // ✅ Update product to set hasImage = true
//     await Product.findByIdAndUpdate(productId, { hasImage: true });

//     res.json({ message: "Image uploaded successfully" });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// };

// // Delete product image
// exports.deleteProductImage = async (req, res) => {
//   const { productId } = req.params;
//   try {
//     await cloudinary.uploader.destroy(`products/${productId}/main`);

//     // ✅ Update product to set hasImage = false
//     await Product.findByIdAndUpdate(productId, { hasImage: false });

//     res.json({ message: "Image deleted successfully" });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// };

// Upload product image
exports.uploadProductImage = async (req, res) => {
  const { productId } = req.params;
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No image file uploaded" });
    }

    // If memory storage, Cloudinary can accept a data URI or buffer stream
    const uploadSource = req.file.buffer
      ? `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`
      : req.file.path;

    await cloudinary.uploader.upload(uploadSource, {
      folder: `products/${productId}`,
      public_id: "main",
      overwrite: true,
      invalidate: true, // important: purge CDN caches
      use_filename: false,
      unique_filename: false,
    });

    // Bump a version on the product so frontend can use ?v=<updatedAt>
    const updated = await Product.findByIdAndUpdate(
      productId,
      { hasImage: true, updatedAt: new Date() },
      { new: true }
    ).lean();

    // Return a version for ?v=
    res.json({
      message: "Image uploaded successfully",
      version: updated?.updatedAt ?? Date.now(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Delete product image
exports.deleteProductImage = async (req, res) => {
  const { productId } = req.params;
  try {
    await cloudinary.uploader.destroy(`products/${productId}/main`, {
      invalidate: true, // purge caches of derived assets too
    });

    const updated = await Product.findByIdAndUpdate(
      productId,
      { hasImage: false, updatedAt: new Date() },
      { new: true }
    ).lean();

    res.json({
      message: "Image deleted successfully",
      version: updated?.updatedAt ?? Date.now(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
