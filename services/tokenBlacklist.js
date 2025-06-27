const mongoose = require("mongoose");

// Create a schema for blacklisted tokens
const blacklistedTokenSchema = new mongoose.Schema(
  {
    token: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

// Create index for automatic cleanup of expired tokens
blacklistedTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const BlacklistedToken = mongoose.model(
  "BlacklistedToken",
  blacklistedTokenSchema,
);

// Add token to blacklist
const addToBlacklist = async (token, expiresIn) => {
  try {
    const expiresAt = new Date(Date.now() + expiresIn * 1000);
    await BlacklistedToken.create({ token, expiresAt });
  } catch (error) {
    console.error("Error adding token to blacklist:", error);
  }
};

// Check if token is blacklisted
const isBlacklisted = async (token) => {
  try {
    const blacklistedToken = await BlacklistedToken.findOne({ token });
    return !!blacklistedToken;
  } catch (error) {
    console.error("Error checking token blacklist:", error);
    return false;
  }
};

module.exports = {
  addToBlacklist,
  isBlacklisted,
};
