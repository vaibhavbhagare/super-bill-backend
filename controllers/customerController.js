const Customer = require("../models/Customer");
const CustomerOtp = require("../models/CustomerOtp");
const jwt = require("jsonwebtoken");
const twilio = require("twilio");
const smsClient = new twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN,
);

const whatsappService = require("../controllers/whatsappService");
// Create
exports.createCustomer = async (req, res) => {
  try {
    const customer = new Customer({ ...req.body });
    const saved = await customer.save();
    return res.status(201).json(saved);
  } catch (err) {
    // Check for duplicate key error
    if (err.code === 11000 && err.keyPattern && err.keyPattern.phoneNumber) {
      try {
        const existingCustomer = await Customer.findOne({
          phoneNumber: req.body.phoneNumber,
        });

        const customerWithFlag = {
          ...existingCustomer.toObject(),
          isExisting: true,
        };

        if (customerWithFlag) {
          return res.status(200).json(customerWithFlag); // 👈 Return the existing customer
        } else {
          return res.status(404).json({ error: "Customer not found" });
        }
      } catch (findErr) {
        return res
          .status(500)
          .json({ error: "Error retrieving existing customer" });
      }
    }

    return res.status(400).json({ error: err.message });
  }
};

// Read all
exports.getCustomers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) > 0 ? parseInt(req.query.page) : 1;
    const limit =
      parseInt(req.query.limit) > 0 ? parseInt(req.query.limit) : 10;
    const skip = (page - 1) * limit;

    // Search logic: search on fullName and phoneNumber
    const filter = {
      $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
    };
    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search, "i");
      filter.$or = [
        { fullName: { $regex: searchRegex } },
        {
          $expr: {
            $regexMatch: {
              input: { $toString: "$phoneNumber" },
              regex: req.query.search,
              options: "i",
            },
          },
        },
      ];
    }
    const sort = { updatedAt: -1 };
    const [customers, total] = await Promise.all([
      Customer.find(filter).sort(sort).skip(skip).limit(limit),
      Customer.countDocuments(filter),
    ]);

    res.json({
      data: customers,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

//  whatsappService.sendWhatsAppMessage(
//         'Ketan Ligade',
//         120,
//         '+919960038085',
//         'https://content.jdmagicbox.com/comp/solapur/u7/9999px217.x217.221207222759.g8u7/catalogue/bhagare-super-market-ankoli-solapur-general-stores-9o7ehqfh88.jpg'
//       );
//     res.json(customers);
// Read one
exports.getCustomerById = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) return res.status(404).json({ error: "Customer not found" });
    res.json(customer);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// Update
exports.updateCustomer = async (req, res) => {
  try {
    const updated = await Customer.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    if (!updated) return res.status(404).json({ error: "Customer not found" });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// Delete
exports.deleteCustomer = async (req, res) => {
  try {
    const deleted = await Customer.softDelete(
      req.params.id,
      req.user?.userName || "system",
    );
    if (!deleted) return res.status(404).json({ error: "Customer not found" });
    res.json({ message: "Customer deleted" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// ---------------------- OTP LOGIN (PUBLIC) ----------------------
const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString();
const normalizePhone = (input) => {
  let digits = String(input || "").replace(/\D/g, "");
  if (digits.startsWith("91")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = digits.slice(1);
  return digits.length === 10 ? digits : null;
};
const signCustomerToken = (customer) => {
  return jwt.sign(
    {
      customerId: customer._id,
      phoneNumber: customer.phoneNumber,
      type: "customer",
    },
    process.env.JWT_SECRET || "bhagare_super_market",
    { expiresIn: process.env.CUSTOMER_JWT_EXPIRES_IN || "15h" },
  );
};

exports.sendLoginOtp = async (req, res) => {
  try {
    const { phoneNumber } = req.body || {};
    const normalized = normalizePhone(phoneNumber);
    if (!normalized) {
      return res.status(400).json({ success: false, error: "Valid 10-digit phoneNumber required" });
    }

    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
    await CustomerOtp.create({ phoneNumber: Number(normalized), otp, expiresAt });

    // Prefer WhatsApp via Twilio
    const waFrom = process.env.TWILIO_WHATSAPP_FROM; // e.g., whatsapp:+1415xxxxxxx
    const waTo = `whatsapp:+91${normalized}`;
    if (waFrom) {
      const contentSid = process.env.TWILIO_OTP_CONTENT_SID; // optional template SID
      if (contentSid) {
        await smsClient.messages.create({
          from: waFrom,
          to: waTo,
          contentSid,
          contentVariables: JSON.stringify({ 1: otp, 2: "5" }),
        });
      } else {
        await smsClient.messages.create({
          from: waFrom,
          to: waTo,
          body: `Your login OTP is ${otp}. It expires in 5 minutes.`,
        });
      }
    }
    return res.json({ success: true, message: "OTP sent" });
  } catch (err) {
    console.error("sendLoginOtp error:", err);
    return res.status(500).json({ success: false, error: "Failed to send OTP" });
  }
};

exports.verifyLoginOtp = async (req, res) => {
  try {
    const { phoneNumber, otp, fullName, address, addressLine2, city, pincode } = req.body || {};
    const normalized = normalizePhone(phoneNumber);
    if (!normalized || !otp) {
      return res.status(400).json({ success: false, error: "phoneNumber and otp required" });
    }

    const record = await CustomerOtp.findOne({ phoneNumber: Number(normalized) })
      .sort({ createdAt: -1 });
    if (!record || record.expiresAt < new Date()) {
      return res.status(400).json({ success: false, error: "OTP expired or not found" });
    }
    if (record.verifiedAt) {
      return res.status(400).json({ success: false, error: "OTP already used" });
    }
    if (record.attempts >= 5) {
      return res.status(429).json({ success: false, error: "Too many attempts" });
    }
    if (record.otp !== String(otp)) {
      record.attempts += 1;
      await record.save();
      return res.status(400).json({ success: false, error: "Invalid OTP" });
    }

    record.verifiedAt = new Date();
    await record.save();

    // Upsert customer
    let customer = await Customer.findOne({ phoneNumber: Number(normalized) });
    if (!customer) {
      customer = await Customer.create({
        phoneNumber: Number(normalized),
        fullName: fullName || "Guest",
        address: address || null,
        addressLine2: addressLine2 || null,
        city: city || null,
        pincode: pincode || null,
      });
    } else if (fullName || address || addressLine2 || city || pincode) {
      customer.fullName = fullName || customer.fullName;
      customer.address = address || customer.address;
      customer.addressLine2 = addressLine2 || customer.addressLine2;
      customer.city = city || customer.city;
      customer.pincode = pincode || customer.pincode;
      await customer.save();
    }

    const token = signCustomerToken(customer);
    return res.json({ success: true, token, customer: { id: customer._id, fullName: customer.fullName, phoneNumber: customer.phoneNumber, address: customer.address, addressLine2: customer.addressLine2, city: customer.city, pincode: customer.pincode } });
  } catch (err) {
    console.error("verifyLoginOtp error:", err);
    return res.status(500).json({ success: false, error: "Failed to verify OTP" });
  }
};
