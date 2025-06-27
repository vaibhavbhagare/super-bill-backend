const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { isBlacklisted } = require("../services/tokenBlacklist");

// Custom error class for authentication errors
class AuthenticationError extends Error {
  constructor(message) {
    super(message);
    this.name = "AuthenticationError";
    this.status = 401;
  }
}

// Extract token from header
const extractToken = (req) => {
  const authHeader = req.header("Authorization");
  if (!authHeader) {
    throw new AuthenticationError("No authorization header");
  }

  const [bearer, token] = authHeader.split(" ");
  if (bearer !== "Bearer" || !token) {
    throw new AuthenticationError("Invalid authorization header format");
  }

  return token;
};

// Verify token and get user
const verifyToken = async (token) => {
  try {
    // Check if token is blacklisted
    const isTokenBlacklisted = await isBlacklisted(token);
    if (isTokenBlacklisted) {
      throw new AuthenticationError("Token has been invalidated");
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "bhagare_super_market",
    );
    const user = await User.findById(decoded.id).select("-password");

    if (!user) {
      throw new AuthenticationError("User not found");
    }

    return user;
  } catch (error) {
    if (error.name === "JsonWebTokenError") {
      throw new AuthenticationError("Invalid token");
    }
    if (error.name === "TokenExpiredError") {
      throw new AuthenticationError("Token expired");
    }
    throw error;
  }
};

// Main authentication middleware
const auth = async (req, res, next) => {
  try {
    const token = extractToken(req);
    const user = await verifyToken(token);
    req.user = user;
    next();
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return res.status(error.status).json({
        error: error.message,
        code: "AUTH_ERROR",
      });
    }
    res.status(500).json({
      error: "Internal server error",
      code: "INTERNAL_ERROR",
    });
  }
};

// Optional authentication middleware (for routes that can work with or without auth)
const optionalAuth = async (req, res, next) => {
  try {
    const token = extractToken(req);
    const user = await verifyToken(token);
    req.user = user;
  } catch (error) {
    // Continue without user if authentication fails
    req.user = null;
  }
  next();
};

module.exports = {
  auth,
  optionalAuth,
  AuthenticationError,
};
