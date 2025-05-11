const Customer = require("../models/Customer");

const whatsappService = require('../controllers/whatsappService');
// Create
exports.createCustomer = async (req, res) => {
  try {
    const customer = new Customer(req.body);
    const saved = await customer.save();
    res.status(201).json(saved);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// Read all
exports.getCustomers = async (req, res) => {
  try {
    const customers = await Customer.find();
    whatsappService.sendWhatsAppMessage(
        'Ketan Ligade', 
        120, 
        '+919960038085', 
        'https://content.jdmagicbox.com/comp/solapur/u7/9999px217.x217.221207222759.g8u7/catalogue/bhagare-super-market-ankoli-solapur-general-stores-9o7ehqfh88.jpg'
      );
    res.json(customers);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// Read one
exports.getCustomerById = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    await createInvoice(req, res);
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