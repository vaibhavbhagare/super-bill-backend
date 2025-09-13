const mongoose = require("mongoose");

const storeSchema = new mongoose.Schema(
  {
    storeProfile: {
      storeName: { type: String, required: true, trim: true },
      storeAddress: { type: String, required: true, trim: true },
      storePhone: { type: String, required: true, trim: true },
      isActive: { type: Boolean, default: false },
      storeOwnerName: { type: String, trim: true },
      storeOwnerEmail: { type: String, lowercase: true, trim: true },
      hasImage: { type: String },
    },

    printBillSetting: {
      template: {
        type: String,
        enum: ["Compact", "Detailed", "Modern"],
        default: "Modern",
      },
      storeNameFont: {
        type: String,
        enum: ["Large", "Medium", "Small"],
        default: "Small",
      },
      //hasShow...
      address: { type: Boolean, default: true },
      phoneNumber: { type: Boolean, default: true },
      billerName: { type: Boolean, default: true },
      customerName: { type: Boolean, default: true },
      customerPhone: { type: Boolean, default: true },
      showMRP: { type: Boolean, default: true },
      showSummary: { type: Boolean, default: true },

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
        enum: ["Compact", "Detailed", "Modern"],
        default: "Modern",
      },
      showStoreName: { type: Boolean, default: true },
      showExpiryDate: { type: Boolean, default: false },
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

    // Additional store information
    website: { type: String, trim: true },
    gstNumber: { type: String, trim: true },
    panNumber: { type: String, trim: true },
    establishedDate: { type: Date },
    licenseNumber: { type: String, trim: true },
    bankAccountNumber: { type: String, trim: true },
    ifscCode: { type: String, trim: true },
    upiId: { type: String, trim: true },
    
    // Soft delete fields
    deletedAt: { type: Date, default: null },
    deletedBy: { type: String },
  },
  { timestamps: true }
);

// Add index for soft delete
storeSchema.index({ deletedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

// Add soft delete method
storeSchema.statics.softDelete = async function (id, deletedBy) {
  return this.findByIdAndUpdate(
    id,
    {
      $set: {
        deletedAt: new Date(),
        deletedBy,
        updatedAt: new Date(),
      },
    },
    { new: true },
  );
};

// 👇 this prevents Mongoose from reusing the old model definition
mongoose.models = {};

const Store = mongoose.model("Store", storeSchema);

module.exports = Store;
