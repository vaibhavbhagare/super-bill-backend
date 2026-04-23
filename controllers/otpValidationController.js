const CustomerOtp = require("../models/CustomerOtp");
const twilio = require("twilio");

let smsClient = null;
const getSmsClient = () => {
  if (smsClient) return smsClient;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token || !String(sid).startsWith("AC")) return null;
  try {
    smsClient = twilio(sid, token);
    return smsClient;
  } catch (err) {
    console.error("❌ Twilio init failed:", err.message);
    return null;
  }
};

// Helper functions
const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString();

const normalizePhone = (input) => {
  let digits = String(input || "").replace(/\D/g, "");
  if (digits.startsWith("91")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = digits.slice(1);
  return digits.length === 10 ? digits : null;
};

// Send OTP for phone number validation
exports.sendOtp = async (req, res) => {
  try {
    const { phoneNumber, purpose = "validation" } = req.body || {};
    
    // Validate phone number
    const normalized = normalizePhone(phoneNumber);
    if (!normalized) {
      return res.status(400).json({
        success: false,
        error: "Valid 10-digit phone number required"
      });
    }

    // Check for recent OTP requests (rate limiting)
    const recentOtp = await CustomerOtp.findOne({
      phoneNumber: Number(normalized),
      createdAt: { $gte: new Date(Date.now() - 60 * 1000) } // 1 minute ago
    });

    if (recentOtp) {
      return res.status(429).json({
        success: false,
        error: "Please wait 1 minute before requesting another OTP"
      });
    }

    // Generate OTP
    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    // Save OTP to database
    await CustomerOtp.create({
      phoneNumber: Number(normalized),
      otp,
      purpose,
      expiresAt,
    });

    // Send OTP via SMS/WhatsApp
    try {
      const client = getSmsClient();
      if (!client) {
        console.warn("⚠️ Twilio not configured. OTP generated but not sent.");
      } else {
      // Try WhatsApp first if configured
      const waFrom = process.env.TWILIO_WHATSAPP_FROM;
      const waTo = `whatsapp:+91${normalized}`;
      
      if (waFrom) {
        const contentSid = process.env.TWILIO_OTP_CONTENT_SID;
        if (contentSid) {
          await client.messages.create({
            from: waFrom,
            to: waTo,
            contentSid,
            contentVariables: JSON.stringify({ 1: otp, 2: "5" }),
          });
        } else {
          await client.messages.create({
            from: waFrom,
            to: waTo,
            body: `Your verification OTP is ${otp}. It expires in 5 minutes.`,
          });
        }
      } else {
        // Fallback to SMS
        const smsFrom = process.env.TWILIO_PHONE_NUMBER;
        const smsTo = `+91${normalized}`;
        
        await client.messages.create({
          from: smsFrom,
          to: smsTo,
          body: `Your verification OTP is ${otp}. It expires in 5 minutes.`,
        });
      }
      }
    } catch (smsError) {
      console.error("SMS/WhatsApp sending error:", smsError);
      // Still return success as OTP is generated and stored
    }

    return res.json({
      success: true,
      message: "OTP sent successfully",
      phoneNumber: normalized,
      expiresIn: "5 minutes"
    });

  } catch (err) {
    console.error("sendOtp error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to send OTP"
    });
  }
};

// Verify OTP for phone number validation
exports.verifyOtp = async (req, res) => {
  try {
    const { phoneNumber, otp } = req.body || {};
    
    // Validate input
    const normalized = normalizePhone(phoneNumber);
    if (!normalized || !otp) {
      return res.status(400).json({
        success: false,
        error: "Phone number and OTP are required"
      });
    }

    // Find the most recent OTP record
    const record = await CustomerOtp.findOne({
      phoneNumber: Number(normalized),
    }).sort({ createdAt: -1 });

    if (!record) {
      return res.status(400).json({
        success: false,
        error: "No OTP found for this phone number"
      });
    }

    // Check if OTP is expired
    if (record.expiresAt < new Date()) {
      return res.status(400).json({
        success: false,
        error: "OTP has expired"
      });
    }

    // Check if OTP is already used
    if (record.verifiedAt) {
      return res.status(400).json({
        success: false,
        error: "OTP has already been used"
      });
    }

    // Check attempt limit
    if (record.attempts >= 5) {
      return res.status(429).json({
        success: false,
        error: "Too many failed attempts. Please request a new OTP"
      });
    }

    // Verify OTP
    if (record.otp !== String(otp)) {
      record.attempts += 1;
      await record.save();
      
      return res.status(400).json({
        success: false,
        error: "Invalid OTP",
        attemptsRemaining: 5 - record.attempts
      });
    }

    // Mark OTP as verified
    record.verifiedAt = new Date();
    await record.save();

    return res.json({
      success: true,
      message: "Phone number verified successfully",
      phoneNumber: normalized,
      verifiedAt: record.verifiedAt
    });

  } catch (err) {
    console.error("verifyOtp error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to verify OTP"
    });
  }
};

// Check OTP status (optional utility endpoint)
exports.checkOtpStatus = async (req, res) => {
  try {
    const { phoneNumber } = req.params;
    
    const normalized = normalizePhone(phoneNumber);
    if (!normalized) {
      return res.status(400).json({
        success: false,
        error: "Valid 10-digit phone number required"
      });
    }

    const record = await CustomerOtp.findOne({
      phoneNumber: Number(normalized),
    }).sort({ createdAt: -1 });

    if (!record) {
      return res.json({
        success: true,
        hasOtp: false,
        message: "No OTP found for this phone number"
      });
    }

    const isExpired = record.expiresAt < new Date();
    const isUsed = !!record.verifiedAt;

    return res.json({
      success: true,
      hasOtp: true,
      isExpired,
      isUsed,
      attempts: record.attempts,
      expiresAt: record.expiresAt,
      createdAt: record.createdAt
    });

  } catch (err) {
    console.error("checkOtpStatus error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to check OTP status"
    });
  }
};

