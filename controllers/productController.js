const Product = require("../models/Product");
const Category = require("../models/Category");
const { Parser } = require("json2csv");
// Create
exports.createProduct = async (req, res) => {
  try {
    let barcode = req.body.barcode;
    if (!barcode) {
      const timestamp = Date.now().toString().slice(-7);
      const random = Math.floor(100 + Math.random() * 900);
      barcode = timestamp + random;
    }
    // categories can be provided as categoryIds[] or legacy category name
    let categories = [];
    if (Array.isArray(req.body.categoryIds) && req.body.categoryIds.length) {
      categories = req.body.categoryIds;
    }

    const product = new Product({
      ...req.body,
      categories,
      barcode,
      createdBy: req.user.userName, // Use logged-in user's username
      updatedBy: req.user.userName, // Initially same as createdBy
    });
    const saved = await product.save();
    res.status(201).json(saved);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.getProducts = async (req, res) => {
  try {
    // Pagination
    const page = Number(req.query.page) > 0 ? Number(req.query.page) : 1;
    const limit = Number(req.query.limit) > 0 ? Number(req.query.limit) : 10;
    const skip = (page - 1) * limit;

    // Params
    const {
      search = "",
      hasImage,
      stockStatus,
      purchasePriceMin,
      purchasePriceMax,
      sellingPrice1Min,
      sellingPrice1Max,
      sellingPrice2Min,
      sellingPrice2Max,
      expiryStart,
      expiryEnd,
      updatedBy,
    } = req.query;

    // Build filter as $and of all conditions
    const andConditions = [];

    // Soft delete guard
    andConditions.push({
      $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
    });

    // Search block
    if (search && String(search).trim()) {
      const searchRegex = new RegExp(String(search).trim(), "i");
      andConditions.push({
        $or: [
          { name: { $regex: searchRegex } },
          {
            $expr: {
              $regexMatch: {
                input: { $toString: "$secondName" },
                regex: String(search),
                options: "i",
              },
            },
          },
          {
            $expr: {
              $regexMatch: {
                input: { $toString: "$searchKey" },
                regex: String(search),
                options: "i",
              },
            },
          },
          {
            $expr: {
              $regexMatch: {
                input: { $toString: "$barcode" },
                regex: String(search),
                options: "i",
              },
            },
          },
        ],
      });
    }

    // hasImage: YES|NO
    if (hasImage === "YES") andConditions.push({ hasImage: true });
    if (hasImage === "NO") andConditions.push({
      $or: [
        { hasImage: false },
        { hasImage: null },
        { hasImage: { $exists: false } }
      ]
    });

    // stockStatus: IN_STOCK|OUT_OF_STOCK
    if (stockStatus === "IN_STOCK") andConditions.push({ stock: { $gt: 0 } });
    if (stockStatus === "OUT_OF_STOCK")
      andConditions.push({ stock: { $lte: 0 } });

    // Helper for numeric range on a field
    const addNumberRange = (field, minVal, maxVal) => {
      const hasMin =
        minVal !== undefined && minVal !== "" && !isNaN(Number(minVal));
      const hasMax =
        maxVal !== undefined && maxVal !== "" && !isNaN(Number(maxVal));
      if (!hasMin && !hasMax) return;

      const cond = {};
      if (hasMin) cond.$gte = Number(minVal);
      if (hasMax) cond.$lte = Number(maxVal);
      andConditions.push({ [field]: cond });
    };

    addNumberRange("purchasePrice", purchasePriceMin, purchasePriceMax);
    addNumberRange("sellingPrice1", sellingPrice1Min, sellingPrice1Max);
    addNumberRange("sellingPrice2", sellingPrice2Min, sellingPrice2Max);

    // Expiry date range (inclusive)
    if (expiryStart || expiryEnd) {
      const cond = {};
      if (expiryStart) cond.$gte = new Date(expiryStart);
      if (expiryEnd) {
        const d = new Date(expiryEnd);
        d.setHours(23, 59, 59, 999);
        cond.$lte = d;
      }
      andConditions.push({ expiryDate: cond });
    }

    // Updated by
    if (updatedBy) andConditions.push({ updatedBy: String(updatedBy) });

    const filter = andConditions.length ? { $and: andConditions } : {};
    const sort = { updatedAt: -1 };

    const [products, total] = await Promise.all([
      Product.find(filter).sort(sort).skip(skip).limit(limit).populate('categories', 'name secondaryName slug'),
      Product.countDocuments(filter),
    ]);

    res.status(200).json({
      data: products,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("❌ Error in getProducts:", err.message);
    res.status(500).json({ error: "Server error" });
  }
};

// Read one
exports.getProductById = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).populate('categories', 'name secondaryName slug');
    if (!product) return res.status(404).json({ error: "Product not found" });
    res.json(product);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.getProductByBarcode = async (req, res) => {
  try {
    const product = await Product.findOne({ barcode: req.params.barcode });
    if (!product) return res.status(200).json(null);
    res.json(product);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// Update
exports.updateProduct = async (req, res) => {
  try {
    // Handle categories updates: accept categoryIds[] or legacy category string
    const updateData = {
      ...req.body,
      updatedBy: req.user.userName, // Use logged-in user's username
    };
    if (Array.isArray(req.body.categoryIds)) {
      updateData.categories = req.body.categoryIds;
    }

    const updated = await Product.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true,
    });

    if (!updated) return res.status(404).json({ error: "Product not found" });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// Delete
exports.deleteProduct = async (req, res) => {
  try {
    // Log the deletion with user information
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: "Product not found" });

    // You might want to store deletion information in a separate collection
    console.log(`Product ${product.name} deleted by ${req.user.userName}`);

    const deleted = await Product.softDelete(
      req.params.id,
      req.user?.userName || "system"
    );
    res.json({
      message: "Product deleted",
      deletedBy: req.user.userName,
      deletedAt: new Date(),
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.exportCsv = async (req, res) => {
  try {
    // Fetch products from DB
    const products = await Product.find().lean();
    const formatDate = (iso) =>
      iso ? new Date(iso).toLocaleDateString("en-GB") : "";
    // Inject running Sr No.
    const productsWithSr = products.map((p, idx) => ({
      srNo: idx + 1,
      expiryDate: formatDate(p.expiryDate), // <-- dd/mm/yyyy
      ...p,
    }));

    // Define CSV columns
    const fields = [
      { label: "Sr No.", value: "srNo" },
      { label: "Barcode", value: "barcode" },
      { label: "Name", value: "name" },
      { label: "Second Name", value: "secondName" },
      { label: "Stock", value: "stock" },
      { label: "Available Stock", value: "" },
      { label: "Purchase Price", value: "purchasePrice" },
      { label: "MRP", value: "mrp" },
      { label: "Selling Price 1", value: "sellingPrice1" },
      { label: "Expiry Date", value: "expiryDate" },
    ];

    const parser = new Parser({ fields, withBOM: true });
    const csv = parser.parse(productsWithSr);

    res
      .status(200)
      .header("Content-Type", "text/csv")
      .attachment("products.csv")
      .send(csv);
  } catch (err) {
    console.error("CSV export failed:", err);
    res.status(400).json({ error: err.message });
  }
};
