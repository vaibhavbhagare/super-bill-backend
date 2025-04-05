const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: String,
    email: { type: String, unique: true },
    age: Number,
    createdBy: String,
    updatedBy: String,
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("User", userSchema);
