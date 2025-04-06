const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const User = require("../models/User");

// Login
exports.loginUser = async (req, res) => {
  try {
    const { userName, password } = req.body;

    // Find user by userName
    const user = await User.findOne({ userName });
    if (!user) return res.status(404).json({ error: "Invalid credentials" });

    // Compare passwords
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ error: "Invalid credentials" });

    // Generate JWT token
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || "bhagare_super_market", {
      expiresIn: "15h",
    });

    res.json({ token });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// Create
exports.createUser = async (req, res) => {
  try {
    const user = new User(req.body);
    const saved = await user.save();
    res.status(201).json(saved.toJSON());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// Read all
exports.getUsers = async (req, res) => {
  try {
    const users = await User.find().select('-password'); // Exclude password
    res.json(users);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// Read one
exports.getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// Update
exports.updateUser = async (req, res) => {
  try {
    const updated = await User.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    if (!updated) return res.status(404).json({ error: "User not found" });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// Delete
exports.deleteUser = async (req, res) => {
  try {
    const deleted = await User.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: "User not found" });
    res.json({ message: "User deleted" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
