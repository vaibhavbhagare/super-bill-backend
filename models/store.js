const mongoose = require("mongoose");

const storeSchema = new mongoose.Schema(
  {
    storeProfile: {
      storeName: { type: String, required: true, trim: true },
      storeAddress: { type: String, required: true, trim: true },
      storePhone: { type: String, required: true, trim: true },
      isActive: { type: Boolean, default: false },
      storeOwnerName: { type: String, trim: true },
      storeOwnerAddress: { type: String, trim: true },
      storeOwnerEmail: { type: String, lowercase: true, trim: true },
      storeLogo: { type: String },
    },

    printBillSetting: {
      template: {
        type: String,
        enum: ["Modern", "Simple", "New"],
        required: true,
        default: "Modern",
      },
      storeNameFont: {
        type: String,
        enum: ["Large", "Small"],
        default: "Small",
      },
      //hasShow...
      address: { type: Boolean, required: true },
      phoneNumber: { type: Boolean, required: true },
      billerName: { type: Boolean, required: true },
      customerName: { type: Boolean, required: true },
      customerPhone: { type: Boolean, required: true },
      showMRP: { type: Boolean, required: true },
      showSummary: { type: Boolean, required: true },

      footer1: {
        enabled: { type: Boolean, default: false },
        text: { type: String, default: "" },
      },
      footer2: {
        enabled: { type: Boolean, default: false },
        text: { type: String, default: "" },
      },
    },

    barcodeSetting: {
      template: {
        type: String,
        enum: ["Modern", "Simple", "New"],
        required: true,
      },
      showStoreName: { type: Boolean, required: true },
      showExpiryDate: { type: Boolean, default: "No" },
      barcodeSize: {
        type: String,
        enum: ["Small", "Medium", "Large"],
        default: "Medium",
      },
      showMRP: {
        type: String,
        enum: ["Small", "Medium", "Large"],
        default: "Small",
      },
      showSP: {
        type: String,
        enum: ["Small", "Medium", "Large"],
        default: "Small",
      },
      showDiscountCount: {
        type: String,
        enum: ["Small", "Medium", "Large"],
        default: "Small",
      },
    },
  },
  { timestamps: true }
);

// 👇 this prevents Mongoose from reusing the old model definition
mongoose.models = {};

const Store = mongoose.model("Store", storeSchema);

module.exports = Store;
