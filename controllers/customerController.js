const Customer = require("../models/Customer");

const whatsappService = require("../controllers/whatsappService");
// Create
exports.createCustomer = async (req, res) => {
  try {
    const customer = new Customer({
      ...req.body,
    });
    const saved = await customer.save();
    res.status(201).json(saved);
  } catch (err) {
    res.status(400).json({ error: err.message });
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
    const filter = {};
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
    const deleted = await Customer.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Customer not found" });
    res.json({ message: "Customer deleted" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
