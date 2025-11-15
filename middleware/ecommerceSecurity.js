const rateLimit = require("express-rate-limit");
const helmet = require("helmet");

// Rate limiting for e-commerce APIs
const createEcommerceLimiter = (windowMs = 15 * 60 * 1000, max = 1000) => {
  return rateLimit({
    windowMs,
    max, // limit each IP to max requests per windowMs
    message: {
      error: "Too many requests from this IP, please try again later.",
      code: "RATE_LIMIT_EXCEEDED",
    },
    standardHeaders: true,
    legacyHeaders: false,
    // Skip rate limiting for certain conditions
    skip: (req) => {
      // Skip for internal requests or trusted sources
      return req.ip === "127.0.0.1" || req.ip === "::1";
    },
  });
};

// Specific rate limiters for different endpoints
const productSearchLimiter = createEcommerceLimiter(15 * 60 * 1000, 500); // 500 requests per 15 minutes
const productDetailLimiter = createEcommerceLimiter(15 * 60 * 1000, 500); // 200 requests per 15 minutes
// Higher capacity limiter for categories list (heavily used in UI boot)
const categoriesListLimiter = createEcommerceLimiter(15 * 60 * 1000, 2000);

// Security headers for e-commerce
const ecommerceSecurityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https:"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "https:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
});

// Request validation middleware
const validateEcommerceRequest = (req, res, next) => {
  // Validate pagination parameters
  if (req.query.page) {
    const page = parseInt(req.query.page);
    if (isNaN(page) || page < 1) {
      return res.status(400).json({
        success: false,
        error: "Invalid page number",
        code: "INVALID_PAGE",
      });
    }
  }

  if (req.query.limit) {
    const limit = parseInt(req.query.limit);
    if (isNaN(limit) || limit < 1 || limit > 100) {
      return res.status(400).json({
        success: false,
        error: "Invalid limit. Must be between 1 and 100",
        code: "INVALID_LIMIT",
      });
    }
  }

  // Validate price filters
  if (req.query.minPrice) {
    const minPrice = parseFloat(req.query.minPrice);
    if (isNaN(minPrice) || minPrice < 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid minimum price",
        code: "INVALID_MIN_PRICE",
      });
    }
  }

  if (req.query.maxPrice) {
    const maxPrice = parseFloat(req.query.maxPrice);
    if (isNaN(maxPrice) || maxPrice < 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid maximum price",
        code: "INVALID_MAX_PRICE",
      });
    }
  }

  // Validate sort parameters
  const allowedSortFields = ["name", "price", "createdAt"];
  if (req.query.sortBy && !allowedSortFields.includes(req.query.sortBy)) {
    return res.status(400).json({
      success: false,
      error: "Invalid sort field",
      code: "INVALID_SORT_FIELD",
    });
  }

  if (req.query.sortOrder && !["asc", "desc"].includes(req.query.sortOrder)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid sort order. Must be "asc" or "desc"',
      code: "INVALID_SORT_ORDER",
    });
  }

  next();
};

// Search query validation
const validateSearchQuery = (req, res, next) => {
  const { q } = req.query;

  if (q && (typeof q !== "string" || q.trim().length < 2)) {
    return res.status(400).json({
      success: false,
      error: "Search query must be at least 2 characters long",
      code: "INVALID_SEARCH_QUERY",
    });
  }

  // Prevent very long search queries
  if (q && q.length > 100) {
    return res.status(400).json({
      success: false,
      error: "Search query too long",
      code: "SEARCH_QUERY_TOO_LONG",
    });
  }

  next();
};

// Response sanitization middleware
const sanitizeEcommerceResponse = (req, res, next) => {
  // Store original send method
  const originalSend = res.send;

  // Override send method to sanitize responses
  res.send = function (data) {
    if (typeof data === "string") {
      try {
        const parsed = JSON.parse(data);
        // Remove sensitive fields if they exist
        if (parsed.data && Array.isArray(parsed.data)) {
          parsed.data = parsed.data.map((item) => {
            if (item && typeof item === "object") {
              // Remove any sensitive fields that might have been added
              delete item.deletedAt;
              delete item.deletedBy;
              delete item.isSynced;
              delete item.createdBy;
              delete item.updatedBy;
              delete item.purchasePrice;
            }
            return item;
          });
        } else if (parsed.data && typeof parsed.data === "object") {
          delete parsed.data.deletedAt;
          delete parsed.data.deletedBy;
          delete parsed.data.isSynced;
          delete parsed.data.createdBy;
          delete parsed.data.updatedBy;
          delete parsed.data.purchasePrice;
        }

        // Convert back to string
        data = JSON.stringify(parsed);
      } catch (e) {
        // If parsing fails, send original data
      }
    }

    // Call original send method
    originalSend.call(this, data);
  };

  next();
};

module.exports = {
  productSearchLimiter,
  productDetailLimiter,
  ecommerceSecurityHeaders,
  validateEcommerceRequest,
  validateSearchQuery,
  sanitizeEcommerceResponse,
  categoriesListLimiter,
};
