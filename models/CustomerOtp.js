const mongoose = require("mongoose");

const customerOtpSchema = new mongoose.Schema(
  {
    phoneNumber: { type: Number, required: true, index: true },
    otp: { type: String, required: true },
    purpose: { type: String, enum: ["login"], default: "login" },
    expiresAt: { type: Date, required: true, index: true },
    attempts: { type: Number, default: 0 },
    verifiedAt: { type: Date },
  },
  { timestamps: true },
);

// TTL on expiresAt so expired OTP docs are auto-removed
customerOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("CustomerOtp", customerOtpSchema);


