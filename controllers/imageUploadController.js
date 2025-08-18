const cloudinary = require("../middleware/cloudinary");
const Product = require("../models/Product");


exports.uploadProductImage = async (req, res) => {
  const { productId } = req.params;
  console.log(req.params)
  try {
    await cloudinary.uploader.upload(req.file.path, {
      folder: `products/${productId}`,
      public_id: "main", // fixed name
      overwrite: true,
    });

    // ✅ Update product to set hasImage = true
    await Product.findByIdAndUpdate(productId, { hasImage: true });

    res.json({ message: "Image uploaded successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Delete product image
exports.deleteProductImage = async (req, res) => {
  const { productId } = req.params;
  try {
    await cloudinary.uploader.destroy(`products/${productId}/main`);

    // ✅ Update product to set hasImage = false
    await Product.findByIdAndUpdate(productId, { hasImage: false });

    res.json({ message: "Image deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};