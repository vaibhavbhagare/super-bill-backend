const Product = require("../models/Product");
const Category = require("../models/Category");

// Public API - Get products with advanced search and filtering
const getProducts = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search,
      category,
      brand,
      minPrice,
      maxPrice,
      onSale,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    // Build filter object - use existing product structure
    const filter = {
      deletedAt: null, // Only filter by deletedAt since that's what your products have
    };

    // Text search
    if (search) {
      filter.$text = { $search: search };
    }

    // Category filter (supports comma-separated category ids) and alias categoryId/categoryIds
    const categoryParam = category || req.query.categoryId || req.query.categoryIds;
    if (categoryParam) {
      const categoryIds = String(categoryParam)
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
      filter.categories = { $in: categoryIds };
    }

    // Brand filter
    if (brand) {
      filter.brand = brand;
    }
    filter.hasImage = true;
    // Price range filter
    if (minPrice || maxPrice) {
      filter.sellingPrice1 = {};
      if (minPrice) filter.sellingPrice1.$gte = parseFloat(minPrice);
      if (maxPrice) filter.sellingPrice1.$lte = parseFloat(maxPrice);
    }

    // Sale filter - check if discount exists
    if (onSale === "true") {
      filter.discountPercentage = { $gt: 0 };
    }

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === "desc" ? -1 : 1;

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const limitNum = parseInt(limit);

    // Execute query with pagination
    const products = await Product.find(filter)
      .select(
        "-deletedAt -deletedBy -isSynced -createdBy -updatedBy -purchasePrice"
      )
      .sort(sort)
      .skip(skip)
      .limit(limitNum)
      .lean();

    // Get total count for pagination
    const total = await Product.countDocuments(filter);

    // Calculate pagination info
    const totalPages = Math.ceil(total / limitNum);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    // Add discount calculation and e-commerce fields based on existing data
    const productsWithDiscount = products.map((product) => ({
      ...product,
      // Use existing discountPercentage or calculate from mrp and sellingPrice1
      discountPercentage:
        product.discountPercentage ||
        (product.mrp > 0
          ? Math.round(
              ((product.mrp - product.sellingPrice1) / product.mrp) * 100
            )
          : 0),
      discountAmount: product.mrp - product.sellingPrice1,
      // Set e-commerce fields based on existing data
      isActive: true, // Assume all non-deleted products are active
      isOnSale:
        (product.discountPercentage && product.discountPercentage > 0) ||
        product.mrp > product.sellingPrice1,
      // Add description if it doesn't exist
      description:
        product.description ||
        product.name ||
        product.secondName ||
        "Product description not available",
    }));

    res.json({
      success: true,
      data: {
        products: productsWithDiscount,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          total,
          limit: limitNum,
          hasNextPage,
          hasPrevPage,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch products",
      message: error.message,
    });
  }
};

// Public API - Get product by ID with enhanced details
const getProductById = async (req, res) => {
  try {
    const { id } = req.params;

    const product = await Product.findOne({
      _id: id,
      deletedAt: null,
    }).select(
      "-deletedAt -deletedBy -isSynced -createdBy -updatedBy -purchasePrice"
    );

    if (!product) {
      return res.status(404).json({
        success: false,
        error: "Product not found",
      });
    }

    // Add discount calculation and e-commerce fields
    const productWithDiscount = {
      ...product.toObject(),
      discountPercentage:
        product.discountPercentage ||
        (product.mrp > 0
          ? Math.round(
              ((product.mrp - product.sellingPrice1) / product.mrp) * 100
            )
          : 0),
      discountAmount: product.mrp - product.sellingPrice1,
      isActive: true,
      isOnSale:
        (product.discountPercentage && product.discountPercentage > 0) ||
        product.mrp > product.sellingPrice1,
      description:
        product.description ||
        product.name ||
        product.secondName ||
        "Product description not available",
    };

    res.json({
      success: true,
      data: productWithDiscount,
    });
  } catch (error) {
    console.error("Error fetching product:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch product",
      message: error.message,
    });
  }
};

// Public API - Get filters for products
const getProductFilters = async (req, res) => {
  try {
    const { category, brand } = req.query;

    // Build base filter
    const filter = {
      deletedAt: null,
    };

    const categoryParam = category || req.query.categoryId || req.query.categoryIds;
    if (categoryParam) {
      const categoryIds = String(categoryParam)
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
      filter.categories = { $in: categoryIds };
    }
    if (brand) filter.brand = brand;

    // Get price range
    const priceStats = await Product.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          minPrice: { $min: "$sellingPrice1" },
          maxPrice: { $max: "$sellingPrice1" },
        },
      },
    ]);

    // Get available brands
    const brands = await Product.distinct("brand", filter);

    // Get available categories (as objects) based on products
    const categoryIds = await Product.distinct("categories", filter);
    const categories = await Category.find({
      _id: { $in: categoryIds.filter(Boolean) },
      deletedAt: null,
    })
      .select("_id name slug hasImage")
      .lean();

    const filters = {
      priceRange: priceStats[0] || { minPrice: 0, maxPrice: 0 },
      brands: brands.filter(Boolean),
      categories,
    };

    res.json({
      success: true,
      data: filters,
    });
  } catch (error) {
    console.error("Error fetching filters:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch filters",
      message: error.message,
    });
  }
};

module.exports = {
  getProducts,
  getProductById,
  getProductFilters,
  // Public API - Get all categories for e-commerce
  async getCategories(req, res) {
    try {
      const categories = await Category.find({ deletedAt: null })
        .select("_id name secondaryName slug hasImage")
        .sort({ name: 1 })
        .lean();

      res.json({
        success: true,
        data: categories,
      });
    } catch (error) {
      console.error("Error fetching categories:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch categories",
        message: error.message,
      });
    }
  }
};
