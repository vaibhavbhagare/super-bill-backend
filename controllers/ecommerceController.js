const Product = require("../models/Product");
const Category = require("../models/Category");
const ProductStats = require("../models/ProductStats");
const Order = require("../models/Order");

// Public API - Get products with advanced search and filtering
const getProducts = async (req, res) => {
  try {
    // Pagination
    const page = Number(req.query.page) > 0 ? Number(req.query.page) : 1;
    const limit = Number(req.query.limit) > 0 ? Number(req.query.limit) : 20;
    const skip = (page - 1) * limit;

    // Params
    const {
      search = "",
      category,
      brand,
      hasImage,
      inStock,
      minPrice,
      maxPrice,
      onSale,
      sortBy = "updatedAt",
      sortOrder = "desc",
    } = req.query;

    // -----------------------------
    // Filter builder
    // -----------------------------
    const andConditions = [];

    // Soft delete filter
    andConditions.push({
      $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
    });

    // -----------------------------
    // 🔍 Fuzzy Search (handles typos)
    // -----------------------------
    if (search && String(search).trim()) {
      const normalized = String(search).trim();
      // "sakhar" → /s.*a.*k.*h.*a.*r/i
      const searchRegex = new RegExp(normalized.split("").join(".*"), "i");

      andConditions.push({
        $or: [
          { name: { $regex: searchRegex } },
          { secondName: { $regex: searchRegex } },
          { brand: { $regex: searchRegex } },
          {
            $expr: {
              $regexMatch: {
                input: { $toString: "$barcode" },
                regex: normalized,
                options: "i",
              },
            },
          },
        ],
      });
    }

    // -----------------------------
    // 🏷️ Category filter
    // -----------------------------
    if (category) {
      const categoryIds = String(category)
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
      andConditions.push({ categories: { $in: categoryIds } });
    }

    // -----------------------------
    // 🏭 Brand filter
    // -----------------------------
    if (brand) andConditions.push({ brand });

    // -----------------------------
    // 💰 Price range filter
    // -----------------------------
    const priceCond = {};
    if (minPrice) priceCond.$gte = Number(minPrice);
    if (maxPrice) priceCond.$lte = Number(maxPrice);
    if (Object.keys(priceCond).length > 0) {
      andConditions.push({ sellingPrice1: priceCond });
    }

    // -----------------------------
    // 🔥 On sale filter
    // -----------------------------
    if (onSale === "true") {
      andConditions.push({
        $or: [
          { discountPercentage: { $gt: 0 } },
          { $expr: { $gt: ["$mrp", "$sellingPrice1"] } },
        ],
      });
    }

    // -----------------------------
    // 📦 Stock filter
    // -----------------------------
    if (inStock === "true") {
      andConditions.push({ stock: { $gt: 0 } });
    }

    // -----------------------------
    // 🖼️ Image filter
    // -----------------------------
    if (hasImage === "YES") andConditions.push({ hasImage: true });
    if (hasImage === "NO") {
      andConditions.push({
        $or: [
          { hasImage: false },
          { hasImage: null },
          { hasImage: { $exists: false } },
        ],
      });
    }

    // -----------------------------
    // Final filter and sort
    // -----------------------------
    const filter = andConditions.length ? { $and: andConditions } : {};
    const sort = {};
    sort[sortBy] = sortOrder === "desc" ? -1 : 1;

    // -----------------------------
    // Fetch products + count
    // -----------------------------
    const [products, total] = await Promise.all([
      Product.find(filter)
        .select(
          "-deletedAt -deletedBy -isSynced -createdBy -updatedBy -purchasePrice -updatedAt"
        )
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .populate("categories", "name secondaryName slug")
        .lean(),
      Product.countDocuments(filter),
    ]);

    // -----------------------------
    // Add computed fields
    // -----------------------------
    const productsWithDiscount = products.map((product) => ({
      ...product,
      discountPercentage:
        product.discountPercentage ||
        (product.mrp > 0
          ? Math.round(((product.mrp - product.sellingPrice1) / product.mrp) * 100)
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
    }));

    // -----------------------------
    // Response (same structure)
    // -----------------------------
    res.status(200).json({
      success: true,
      data: {
        products: productsWithDiscount,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          total,
          limit,
          hasNextPage: page * limit < total,
          hasPrevPage: page > 1,
        },
      },
    });
  } catch (err) {
    console.error("❌ Error in getProducts:", err.message);
    res.status(500).json({
      success: false,
      error: "Server error",
      message: err.message,
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
      "-deletedAt -deletedBy -isSynced -createdBy -updatedBy -purchasePrice -updatedAt"
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

    const categoryParam =
      category || req.query.categoryId || req.query.categoryIds;
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
  // Autocomplete products: fuzzy match on name, secondName, searchKey, brand; filter by brand/category
  async getProductAutocomplete(req, res) {
    try {
      const q = String(req.query.q || req.query.search || "").trim();
      const limit = Number(req.query.limit) > 0 ? Math.min(Number(req.query.limit), 20) : 10;
      const brandParam = req.query.brand;
      const categoryParam = req.query.category || req.query.categoryId || req.query.categoryIds;

      const andConditions = [
        { $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }] },
        { isActive: true },
      ];

      if (q) {
        const safe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const fuzzy = new RegExp(q.split("").join(".*"), "i");
        const partial = new RegExp(safe, "i");
        const maybeNum = Number(q);
        const ors = [
          { name: { $regex: fuzzy } },
          { secondName: { $regex: fuzzy } },
          { searchKey: { $regex: fuzzy } },
          { brand: { $regex: partial } },
        ];
        if (!Number.isNaN(maybeNum)) ors.push({ barcode: maybeNum });
        andConditions.push({ $or: ors });
      }

      // Brand filter (comma separated)
      if (brandParam) {
        const brands = String(brandParam)
          .split(",")
          .map((b) => b.trim())
          .filter(Boolean);
        if (brands.length) {
          const brandRegexes = brands.map((b) => new RegExp(`^${b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$$`, "i"));
          andConditions.push({ brand: { $in: brandRegexes } });
        }
      }

      // Category filter (ids or slugs or names)
      if (categoryParam) {
        const raw = String(categoryParam)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const objectIdLike = [];
        const nameOrSlug = [];
        for (const token of raw) {
          if (/^[a-fA-F0-9]{24}$/.test(token)) objectIdLike.push(token);
          else nameOrSlug.push(token);
        }
        let resolvedIds = [...objectIdLike];
        if (nameOrSlug.length) {
          const slugTokens = nameOrSlug.map((s) => s.toLowerCase());
          const nameRegexes = nameOrSlug.map((s) => new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$$`, "i"));
          const cats = await Category.find({
            $or: [
              { slug: { $in: slugTokens } },
              { name: { $in: nameRegexes } },
            ],
            $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
          })
            .select("_id")
            .lean();
          resolvedIds = resolvedIds.concat(cats.map((c) => String(c._id)));
        }
        if (resolvedIds.length) {
          andConditions.push({ categories: { $in: resolvedIds } });
        }
      }

      const filter = andConditions.length ? { $and: andConditions } : {};

      const suggestions = await Product.find(filter)
        .select("name secondName searchKey brand categories sellingPrice1 mrp stock barcode hasImage")
        .populate("categories", "name secondaryName slug")
        .sort({ updatedAt: -1 })
        .limit(limit)
        .lean();

      res.json({ success: true, data: suggestions });
    } catch (error) {
      console.error("Error fetching autocomplete:", error);
      res.status(500).json({ success: false, error: "Failed to fetch suggestions", message: error.message });
    }
  },
  // Public API - Featured products: top sellers that are in stock, min 15
  async getFeaturedProducts(req, res) {
    try {
      const limit = Math.max(parseInt(req.query.limit || 15), 1);
      // 1) Get top selling product IDs from stats
      const topStats = await ProductStats.find({})
        .sort({ totalUnitsSold: -1 })
        .limit(limit * 3) // over-fetch then filter by availability
        .select("product totalUnitsSold")
        .lean();
      const ids = topStats.map((s) => s.product).filter(Boolean);

      // 2) Fetch products that are active, in stock, not deleted, have image
      const featured = await Product.find({
        _id: { $in: ids },
        deletedAt: null,
        isActive: true,
        stock: { $gt: 0 },
        hasImage: true,
      })
        .select(
          "name secondName barcode categories stock mrp sellingPrice1 brand description discountPercentage isOnSale hasImage"
        )
        .limit(limit)
        .lean();

      // 3) If not enough from stats (e.g., no stats yet), fallback to recent active in-stock products
      let products = featured;
      if (products.length < limit) {
        const fallback = await Product.find({
          deletedAt: null,
          isActive: true,
          stock: { $gt: 0 },
          hasImage: true,
        })
          .select(
            "name secondName barcode categories stock mrp sellingPrice1 brand description discountPercentage isOnSale hasImage"
          )
          .sort({ createdAt: -1 })
          .limit(limit - products.length)
          .lean();
        products = products.concat(fallback);
      }

      // Enrich with sale info similar to other endpoints
      const enriched = products.map((product) => ({
        ...product,
        discountPercentage:
          product.discountPercentage ||
          (product.mrp > 0
            ? Math.round(
                ((product.mrp - product.sellingPrice1) / product.mrp) * 100
              )
            : 0),
        discountAmount: product.mrp - product.sellingPrice1,
        isOnSale:
          (product.discountPercentage && product.discountPercentage > 0) ||
          product.mrp > product.sellingPrice1,
        description:
          product.description ||
          product.name ||
          product.secondName ||
          "Product description not available",
      }));

      return res.json({ success: true, data: { products: enriched } });
    } catch (error) {
      console.error("Error fetching featured products:", error);
      return res
        .status(500)
        .json({
          success: false,
          error: "Failed to fetch featured products",
          message: error.message,
        });
    }
  },
  // Public API - Trending products: recent high sales velocity
  async getTrendingProducts(req, res) {
    try {
      const limit = Math.max(parseInt(req.query.limit || 15), 1);
      const sinceDays = Math.max(parseInt(req.query.days || 14), 1); // lookback window
      const sinceDate = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

      // Trending heuristic: most units sold recently (online + pos)
      const recentTop = await ProductStats.aggregate([
        { $match: { lastSoldAt: { $gte: sinceDate } } },
        {
          $project: {
            product: 1,
            score: { $add: ["$onlineUnitsSold", "$posUnitsSold"] },
          },
        },
        { $sort: { score: -1 } },
        { $limit: limit * 3 },
      ]);
      const ids = recentTop.map((s) => s.product).filter(Boolean);

      let products = await Product.find({
        _id: { $in: ids },
        deletedAt: null,
        isActive: true,
        stock: { $gt: 0 },
        hasImage: true,
      })
        .select(
          "name secondName barcode categories stock mrp sellingPrice1 brand description discountPercentage isOnSale hasImage"
        )
        .limit(limit)
        .lean();

      // Fallback: newest active in-stock products if insufficient data
      if (products.length < limit) {
        const fallback = await Product.find({
          deletedAt: null,
          isActive: true,
          stock: { $gt: 0 },
          hasImage: true,
        })
          .select(
            "name secondName barcode categories stock mrp sellingPrice1 brand description discountPercentage isOnSale hasImage"
          )
          .sort({ updatedAt: -1 })
          .limit(limit - products.length)
          .lean();
        products = products.concat(fallback);
      }

      const enriched = products.map((product) => ({
        ...product,
        discountPercentage:
          product.discountPercentage ||
          (product.mrp > 0
            ? Math.round(
                ((product.mrp - product.sellingPrice1) / product.mrp) * 100
              )
            : 0),
        discountAmount: product.mrp - product.sellingPrice1,
        isOnSale:
          (product.discountPercentage && product.discountPercentage > 0) ||
          product.mrp > product.sellingPrice1,
        description:
          product.description ||
          product.name ||
          product.secondName ||
          "Product description not available",
      }));

      return res.json({ success: true, data: { products: enriched } });
    } catch (error) {
      console.error("Error fetching trending products:", error);
      return res
        .status(500)
        .json({
          success: false,
          error: "Failed to fetch trending products",
          message: error.message,
        });
    }
  },
  // Public API - Recommendations based on customer's recent category affinity
  async getRecommendedProducts(req, res) {
    try {
      const { customerId } = req.query;
      const limit = Math.max(parseInt(req.query.limit || 15), 1);
      const lookbackDays = Math.max(parseInt(req.query.days || 90), 1);
      const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

      let categoryScores = new Map();
      if (customerId) {
        // Aggregate customer's recent orders and tally categories from items
        const orders = await Order.find({
          customer: customerId,
          deletedAt: null,
          createdAt: { $gte: since },
        })
          .sort({ createdAt: -1 })
          .limit(50)
          .populate("items.product", "categories");

        for (const order of orders) {
          for (const it of order.items || []) {
            const prod = it.product;
            if (prod && Array.isArray(prod.categories)) {
              for (const cat of prod.categories) {
                const key = String(cat);
                categoryScores.set(
                  key,
                  (categoryScores.get(key) || 0) + (it.quantity || 1)
                );
              }
            }
          }
        }
      }

      // If no customer history, fallback to trending
      let products = [];
      if (categoryScores.size > 0) {
        const topCategoryIds = Array.from(categoryScores.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([id]) => id);

        products = await Product.find({
          categories: { $in: topCategoryIds },
          deletedAt: null,
          isActive: true,
          stock: { $gt: 0 },
          hasImage: true,
        })
          .select(
            "name secondName barcode categories stock mrp sellingPrice1 brand description discountPercentage isOnSale hasImage"
          )
          .sort({ updatedAt: -1 })
          .limit(limit)
          .lean();
      }

      if (products.length < limit) {
        // Reuse trending logic fallback
        const fallback = await Product.find({
          deletedAt: null,
          isActive: true,
          stock: { $gt: 0 },
          hasImage: true,
        })
          .select(
            "name secondName barcode categories stock mrp sellingPrice1 brand description discountPercentage isOnSale hasImage"
          )
          .sort({ updatedAt: -1 })
          .limit(limit - products.length)
          .lean();
        products = products.concat(fallback);
      }

      const enriched = products.map((product) => ({
        ...product,
        discountPercentage:
          product.discountPercentage ||
          (product.mrp > 0
            ? Math.round(
                ((product.mrp - product.sellingPrice1) / product.mrp) * 100
              )
            : 0),
        discountAmount: product.mrp - product.sellingPrice1,
        isOnSale:
          (product.discountPercentage && product.discountPercentage > 0) ||
          product.mrp > product.sellingPrice1,
        description:
          product.description ||
          product.name ||
          product.secondName ||
          "Product description not available",
      }));

      return res.json({ success: true, data: { products: enriched } });
    } catch (error) {
      console.error("Error fetching recommendations:", error);
      return res
        .status(500)
        .json({
          success: false,
          error: "Failed to fetch recommendations",
          message: error.message,
        });
    }
  },
  // Public API - Get all categories for e-commerce (with cache and cache headers)
  async getCategories(req, res) {
    try {
      // Simple in-memory cache for 5 minutes
      if (!global.__ecommCache) {
        global.__ecommCache = Object.create(null);
      }
      const cacheKey = "categories_all_v1";
      const cached = global.__ecommCache[cacheKey];
      const now = Date.now();
      const ttlMs = 5 * 60 * 1000; // 5 minutes
      if (cached && now - cached.ts < ttlMs) {
        res.set("Cache-Control", "public, max-age=60, s-maxage=60");
        return res.json({ success: true, data: cached.value });
      }

      const categories = await Category.find({ deletedAt: null })
        .select("_id name secondaryName slug hasImage")
        .sort({ name: 1 })
        .lean();

      // Save to cache
      global.__ecommCache[cacheKey] = { ts: now, value: categories };

      // Short CDN/browser cache to smooth bursts without risking staleness
      res.set("Cache-Control", "public, max-age=60, s-maxage=60");

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
  },
};
