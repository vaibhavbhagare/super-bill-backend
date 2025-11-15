const express = require("express");
const router = express.Router();
const productController = require("../controllers/productController");
const { auth, optionalAuth } = require("../middleware/auth");
const Product = require("../models/Product");

// Apply auth middleware to all routes
router.use(auth);

// Product routes
router.post("/", productController.createProduct);
router.get("/", productController.getProducts);
router.get("/export-csv", productController.exportCsv);

// Public autosuggest (no auth) at /api/products/autosuggest?query=sgar
router.get("/autosuggest", optionalAuth, async (req, res) => {
  try {
    const query = String(req.query.query || req.query.q || "").trim();
    if (!query) {
      return res.status(400).json({ success: false, message: "Query required" });
    }

    // Prefer simple regex fallback (Atlas $search variant can be added later)
    const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const suggestions = await Product.find({
      $or: [
        { name: regex },
        { secondName: regex },
        { searchKey: regex },
      ],
      $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
      isActive: true,
    })
      .select("name secondName categories hasImage sellingPrice1 mrp brand")
      .limit(20);

    return res.json({ success: true, count: suggestions.length, data: suggestions });
  } catch (error) {
    console.error("autosuggest error:", error);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
});

router.get("/:id", productController.getProductById);
router.put("/:id", productController.updateProduct);
router.delete("/:id", productController.deleteProduct);
router.get("/barcode/:barcode", productController.getProductByBarcode);

module.exports = router;
