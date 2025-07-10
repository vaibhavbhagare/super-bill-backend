const Product = require("../models/Product");

// Create
exports.createProduct = async (req, res) => {
  try {
    let barcode = req.body.barcode;
    if (!barcode) {
      // Find the max barcode in the collection, using the latest custom or auto barcode
      const lastProduct = await Product.findOne(
        {},
        {},
        { sort: { barcode: -1 } }
      );
      barcode =
        lastProduct && lastProduct.barcode ? lastProduct.barcode + 1 : 1;
    }
    const product = new Product({
      ...req.body,
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

// Read all
{
  /*
exports.getProducts = async (req, res) => {
  try {
    const products = await Product.find();
    res.json(products);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
*/
}

exports.getProducts = async (req, res) => {
  try {
    // ✅ Parse and validate page and limit
    const page = Number(req.query.page) > 0 ? Number(req.query.page) : 1;
    const limit = Number(req.query.limit) > 0 ? Number(req.query.limit) : 10;
    const skip = (page - 1) * limit;

    // ✅ Build search filter
    const filter = {};
    if (req?.query?.search) {
      const searchRegex = new RegExp(req.query.search, "i");
      filter.$or = [
        { name: { $regex: searchRegex } },
        {
          $expr: {
            $regexMatch: {
              input: { $toString: "$secondName" },
              regex: req.query.search,
              options: "i",
            },
          },
        },
        {
          $expr: {
            $regexMatch: {
              input: { $toString: "$searchKey" },
              regex: req.query.search,
              options: "i",
            },
          },
        },
        {
          $expr: {
            $regexMatch: {
              input: { $toString: "$barcode" },
              regex: req.query.search,
              options: "i",
            },
          },
        },
      ];
    }
    const sort = { updatedAt: -1 };
    const [products, total] = await Promise.all([
      Product.find(filter).sort(sort).skip(skip).limit(limit), // Apply skip & limit!
      Product.countDocuments(filter),
    ]);

    console.log("✅ Products returned:", products.length);

    // ✅ Send response
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
    const product = await Product.findById(req.params.id);
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
    const updateData = {
      ...req.body,
      updatedBy: req.user.userName, // Use logged-in user's username
    };

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

    const deleted = await Product.findByIdAndDelete(req.params.id);
    res.json({
      message: "Product deleted",
      deletedBy: req.user.userName,
      deletedAt: new Date(),
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
