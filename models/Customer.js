const mongoose = require("mongoose");

const customerSchema = new mongoose.Schema(
  {
    phoneNumber: { type: Number, required: true, unique: true },
    fullName: { type: String, required: true },
    address: { type: String, default: null },
    notepadPage: { type: String, default: null },
    createdBy: String,
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Customer", customerSchema);
