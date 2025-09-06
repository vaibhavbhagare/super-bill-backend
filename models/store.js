const mongoose = require("mongoose");

const storeSchema = new mongoose.Schema(
  {
    storeName: { type: String, required: true },
    ownerName: { type: String, required: true },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Invalid email address"],
    },
    phone: {
      type: String,
      required: true,
      match: [/^\d{10}$/, "Phone number must be 10 digits"],
    },
    address: { type: String, required: true, trim: true },
    website: { type: String, default: null },
    gstNumber: {
      type: String,
      match: [
        /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/,
        "Invalid GST number",
      ],
    },
    panNumber: {
      type: String,
      match: [/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, "Invalid PAN number"],
    },
    establishedDate: { type: Date, default: null },
    licenseNumber: { type: String, default: null },
    bankAccountNumber: { type: String, default: null },
    ifscCode: { type: String, default: null },
    upiId: {
      type: String,
      match: [
        /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/,
        "Invalid UPI ID format",
      ],
      default: null,
    },
    storeLogo: { type: String, default: null }, // base64 or URL
    isSynced: { type: Boolean, default: false },
    createdBy: { type: String },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: String },
  },
  {
    timestamps: true,
  }
);

// Auto-expire soft deleted docs after 30 days
storeSchema.index({ deletedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

// Soft delete function
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
    { new: true }
  );
};

// Mark store as synced
storeSchema.statics.markAsSynced = async function (id) {
  const result = await this.findByIdAndUpdate(
    { _id: id, isSynced: false },
    { $set: { isSynced: true } }
  );
  return result;
};

module.exports = mongoose.model("Store", storeSchema);