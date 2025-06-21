const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const User = require("../models/User");
const { AuthenticationError } = require("../middleware/auth");
const { addToBlacklist } = require("../services/tokenBlacklist");

// Generate JWT token
const generateToken = (user) => {
  return jwt.sign(
    {
      id: user._id,
      userName: user.userName,
      role: user.role || "user",
    },
    process.env.JWT_SECRET || "bhagare_super_market",
    {
      expiresIn: process.env.JWT_EXPIRES_IN || "15h",
    }
  );
};

// Login
exports.loginUser = async (req, res) => {
  try {
    const { userName, password } = req.body;

    // Input validation
    if (!userName || !password) {
      return res.status(400).json({
        error: "Username and password are required",
        code: "INVALID_INPUT",
      });
    }

    // Find user by userName
    const user = await User.findOne({ userName });
    if (!user) {
      return res.status(401).json({
        error: "Invalid credentials",
        code: "INVALID_CREDENTIALS",
      });
    }

    // Compare passwords
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({
        error: "Invalid credentials",
        code: "INVALID_CREDENTIALS",
      });
    }

    // Generate JWT token
    const token = generateToken(user);

    // Set token in HTTP-only cookie
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 15 * 60 * 60 * 1000, // 15 hours
    });

    // Send response
    res.json({
      user: {
        id: user._id,
        userName: user.userName,
        name: user.name,
        role: user.role || "user",
        language: user.language,
      },
      token,
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({
      error: "Internal server error",
      code: "INTERNAL_ERROR",
    });
  }
};

// Logout
exports.logoutUser = async (req, res) => {
  try {
    const token = req.header("Authorization")?.replace("Bearer ", "");

    if (token) {
      // Add token to blacklist
      const decoded = jwt.decode(token);
      const expiresIn = decoded.exp - Math.floor(Date.now() / 1000);
      await addToBlacklist(token, expiresIn);
    }

    // Clear cookie
    res.clearCookie("token");

    res.json({
      message: "Logged out successfully",
      code: "LOGOUT_SUCCESS",
    });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({
      error: "Error during logout",
      code: "LOGOUT_ERROR",
    });
  }
};

// Create user (protected route)
exports.createUser = async (req, res) => {
  try {
    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [
        { userName: req.body.userName },
        { phoneNumber: req.body.phoneNumber },
      ],
    });

    if (existingUser) {
      return res.status(400).json({
        error: "Username or phone number already exists",
        code: "DUPLICATE_USER",
      });
    }

    // Validate language
    const allowedLanguages = ["en", "mr", "hi"];
    if (!req.body.language || !allowedLanguages.includes(req.body.language)) {
      return res.status(400).json({
        error: "Language is required and must be one of: en, mr, hi",
        code: "INVALID_LANGUAGE",
      });
    }

    const user = new User({
      ...req.body,
      createdBy: req.user.userName,
    });

    const saved = await user.save();
    res.status(201).json(saved.toJSON());
  } catch (err) {
    console.error("Create user error:", err);
    res.status(400).json({
      error: err.message,
      code: "VALIDATION_ERROR",
    });
  }
};

// Get current user profile
exports.getCurrentUser = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    res.json(user);
  } catch (err) {
    res.status(500).json({
      error: "Internal server error",
      code: "INTERNAL_ERROR",
    });
  }
};

// Get all users (protected route)
{
  /*
exports.getUsers = async (req, res) => {
  try {
    const users = await User.find().select('-password');
    res.json(users);
  } catch (err) {
    res.status(500).json({ 
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
};

*/
}

exports.getUsers = async (req, res) => {
  try {
    // ✅ Parse and validate page and limit
    const page = Number(req.query.page) > 0 ? Number(req.query.page) : 1;
    const limit = Number(req.query.limit) > 0 ? Number(req.query.limit) : 10;
    const skip = (page - 1) * limit;

    // ✅ Build search filter
    const filter = {};
    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search, "i");
      filter.$or = [
        { name: { $regex: searchRegex } },
        {
          $expr: {
            $regexMatch: {
              input: { $toString: "$userName" },
              regex: req.query.search,
              options: "i",
            },
          },
        },
      ];
    }

    const [users, total] = await Promise.all([
      User.find(filter).skip(skip).limit(limit), // Apply skip & limit!
      User.countDocuments(filter),
    ]);

    console.log("✅ Users returned:", users.length);

    // ✅ Send response
    res.json({
      data : users,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
{/** */}
// Get user by ID (protected route)
exports.getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-password");
    if (!user)
      return res.status(404).json({
        error: "User not found",
        code: "NOT_FOUND",
      });
    res.json(user);
  } catch (err) {
    res.status(500).json({
      error: "Internal server error",
      code: "INTERNAL_ERROR",
    });
  }
};

// Update user (protected route)
exports.updateUser = async (req, res) => {
  try {
    const updateData = {
      ...req.body,
      updatedBy: req.user.userName,
    };

    const updated = await User.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true,
    }).select("-password");

    if (!updated)
      return res.status(404).json({
        error: "User not found",
        code: "NOT_FOUND",
      });
    res.json(updated);
  } catch (err) {
    res.status(400).json({
      error: err.message,
      code: "VALIDATION_ERROR",
    });
  }
};

// Delete user (protected route)
exports.deleteUser = async (req, res) => {
  try {
    const deleted = await User.findByIdAndDelete(req.params.id);
    if (!deleted)
      return res.status(404).json({
        error: "User not found",
        code: "NOT_FOUND",
      });
    res.json({
      message: "User deleted",
      deletedBy: req.user.userName,
      deletedAt: new Date(),
    });
  } catch (err) {
    res.status(500).json({
      error: "Internal server error",
      code: "INTERNAL_ERROR",
    });
  }
};
