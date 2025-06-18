const Product = require("../models/Product");

// Create
exports.createProduct = async (req, res) => {
  try {
    const product = new Product({
      ...req.body,
      createdBy: req.user.userName, // Use logged-in user's username
      updatedBy: req.user.userName // Initially same as createdBy
    });
    const saved = await product.save();
    res.status(201).json(saved);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// Read all
exports.getProducts = async (req, res) => {
  try {
    const products = await Product.find();
    res.json(products);
  } catch (err) {
    res.status(400).json({ error: err.message });
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

// Update
exports.updateProduct = async (req, res) => {
  try {
    const updateData = {
      ...req.body,
      updatedBy: req.user.userName // Use logged-in user's username
    };
    
    const updated = await Product.findByIdAndUpdate(
      req.params.id, 
      updateData,
      {
        new: true,
        runValidators: true
      }
    );
    
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
      deletedAt: new Date()
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}; 