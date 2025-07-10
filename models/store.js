const mongoose = require("mongoose");

const storeSchema = new mongoose.Schema(
  {
    logo: { type: String, default: "" },

    ownerName: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      match: [/\S+@\S+\.\S+/, "Invalid email format"],
    },
    storePhone: {
      type: String,
      required: true,
      match: [/^\d{10}$/, "Phone must be 10 digits"],
    },

    state: { type: String, required: true },
    city: { type: String, required: true },
    zipCode: { type: String, required: true },

    storeId: {
      type: String,
      required: true,
      unique: true,
    },
    storeName: {
      type: String,
      required: true,
    },
    address: {
      type: String,
      required: true,
    },

    subscription: {
      type: String,
      required: true,
      enum: [...Array(12)].map((_, i) => String(i + 1)), // "1" to "12"
    },

    createdBy: {
      type: String,
      
    },
    updatedBy: {
      type: String,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Store", storeSchema);
