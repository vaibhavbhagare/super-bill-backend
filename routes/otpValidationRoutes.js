const express = require("express");
const router = express.Router();
const otpValidationController = require("../controllers/otpValidationController");

// Rate limiting middleware for OTP endpoints
const rateLimit = require("express-rate-limit");

// Apply stricter rate limiting for OTP endpoints
const otpRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 requests per windowMs
  message: {
    success: false,
    error: "Too many OTP requests, please try again later"
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiting to all OTP routes
router.use(otpRateLimit);

/**
 * @route POST /api/otp/send
 * @desc Send OTP to phone number for validation
 * @access Public
 * @body {phoneNumber: string, purpose?: string}
 */
router.post("/send", otpValidationController.sendOtp);

/**
 * @route POST /api/otp/verify
 * @desc Verify OTP for phone number validation
 * @access Public
 * @body {phoneNumber: string, otp: string}
 */
router.post("/verify", otpValidationController.verifyOtp);

/**
 * @route GET /api/otp/status/:phoneNumber
 * @desc Check OTP status for a phone number
 * @access Public
 * @params {phoneNumber: string}
 */
router.get("/status/:phoneNumber", otpValidationController.checkOtpStatus);

module.exports = router;

