const Invoice = require('../models/Invoice');
const Product = require('../models/Product');
const Customer = require('../models/Customer');
const whatsappService = require('./whatsappService');

// Create Invoice
exports.createInvoice = async (req, res) => {
  try {
    const { buyingProducts, customer, billingSummary, billerId, billerName, sendWhatsappMessage, transactionType, invoiceNumber, paymentStatus, createdBy, updatedBy } = req.body;

    // Check stock for each product
    for (const item of buyingProducts) {
      const product = await Product.findById(item.product);
      if (!product) {
        return res.status(404).json({ error: `Product not found: ${item.product}` });
      }
      if (product.stock < item.quantity) {
        return res.status(400).json({ error: `Insufficient stock for product: ${product.name}` });
      }
    }

    // Decrement stock
    for (const item of buyingProducts) {
      await Product.findByIdAndUpdate(item.product, { $inc: { stock: -item.quantity } });
    }

    // Create invoice
    const invoice = new Invoice({
      buyingProducts,
      customer,
      billingSummary,
      billerId,
      billerName,
      sendWhatsappMessage,
      transactionType,
      invoiceNumber,
      paymentStatus,
      createdBy,
      updatedBy
    });
    await invoice.save();

    // Send WhatsApp message if requested
    if (sendWhatsappMessage) {
      // Fetch customer details if only ID is provided
      let customerData = customer;
      if (typeof customer === 'string') {
        customerData = await Customer.findById(customer).lean();
      }
      const customerName = customerData.fullName || '';
      const phoneNumber = customerData.phoneNumber || '';
      const totalAmount = billingSummary?.total || 0;
      const imageUrl = 'https://content.jdmagicbox.com/comp/solapur/u7/9999px217.x217.221207222759.g8u7/catalogue/bhagare-super-market-ankoli-solapur-general-stores-9o7ehqfh88.jpg';
      console.log(`[INVOICE] Sending WhatsApp message to ${customerName} (${phoneNumber}) for amount ₹${totalAmount}`);
      try {
        await whatsappService.sendWhatsAppMessage(customerName, totalAmount, phoneNumber, imageUrl);
        console.log(`[INVOICE] WhatsApp message sent successfully to ${phoneNumber}`);
      } catch (err) {
        console.error(`[INVOICE] Failed to send WhatsApp message to ${phoneNumber}:`, err);
      }
    }

    res.status(201).json(invoice);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get all invoices
exports.getInvoices = async (req, res) => {
  try {
    const invoices = await Invoice.find().populate('customer').populate('buyingProducts.product');
    res.json(invoices);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get invoice by ID
exports.getInvoiceById = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id).populate('customer').populate('buyingProducts.product');
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    res.json(invoice);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Update invoice (optional, not typical in POS)
exports.updateInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    res.json(invoice);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Delete invoice (soft delete recommended)
exports.deleteInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findByIdAndDelete(req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    res.json({ message: 'Invoice deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}; 