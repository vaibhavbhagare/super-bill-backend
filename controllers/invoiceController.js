const Invoice = require("../models/Invoice");
const Product = require("../models/Product");
const Customer = require("../models/Customer");
const whatsappService = require("./whatsappService");

// Create Invoice
exports.createInvoice = async (req, res) => {
  try {
    const {
      buyingProducts,
      customer,
      billingSummary,
      billerId,
      billerName,
      sendWhatsappMessage,
      transactionType,
      paymentStatus,
      createdBy,
      updatedBy,
    } = req.body;

    // Generate invoice number: MON-INV-XXXX (e.g., JUL-INV-0023)
    const monthNames = [
      "JAN",
      "FEB",
      "MAR",
      "APR",
      "MAY",
      "JUN",
      "JUL",
      "AUG",
      "SEP",
      "OCT",
      "NOV",
      "DEC",
    ];
    const now = new Date();
    const month = monthNames[now.getMonth()];
    const year = now.getFullYear();
    const prefix = `${month}-INV-`;
    // Find the max invoiceNumber for this month
    const lastInvoice = await Invoice.findOne(
      { invoiceNumber: { $regex: `^${prefix}\\d{4}$` } },
      {},
      { sort: { invoiceNumber: -1 } },
    );
    let nextNumber = 1;
    if (lastInvoice && lastInvoice.invoiceNumber) {
      // const match = lastInvoice.invoiceNumber.match(/(\\d{4})$/);
      const match = lastInvoice.invoiceNumber.match(/(\d{4})$/);
      if (match) {
        nextNumber = parseInt(match[1], 10) + 1;
      }
    }
    const invoiceNumber = `${prefix}${String(nextNumber).padStart(4, "0")}`;

    // Check stock for each product
    for (const item of buyingProducts) {
      const product = await Product.findById(item.product);
      if (!product) {
        return res
          .status(404)
          .json({ error: `Product not found: ${item.product}` });
      }
      if (product.stock < item.quantity) {
        return res
          .status(400)
          .json({ error: `Insufficient stock for product: ${product.name}` });
      }
    }

    // Decrement stock
    for (const item of buyingProducts) {
      await Product.findByIdAndUpdate(item.product, {
        $inc: { stock: -item.quantity },
      });
    }

    // Try to create invoice
    try {
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
        updatedBy,
      });
      await invoice.save();
      res.status(201).json(invoice);
    } catch (err) {
      if (
        err.code === 11000 &&
        err.keyPattern &&
        err.keyPattern.invoiceNumber
      ) {
        // Duplicate invoiceNumber, try again
        return res.status(500).json({
          error:
            "Failed to generate unique invoice number after multiple attempts.",
        });
      } else {
        throw err;
      }
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get all invoices
exports.getInvoices = async (req, res) => {
  try {
    const invoices = await Invoice.find()
      .populate("customer")
      .populate("buyingProducts.product")
      .sort({ updatedAt: -1 });
    res.json(invoices);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get invoice by ID
exports.getInvoiceById = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id)
      .populate("customer")
      .populate("buyingProducts.product");
    if (!invoice) return res.status(404).json({ error: "Invoice not found" });
    res.json(invoice);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Update invoice (optional, not typical in POS)
exports.updateInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    if (!invoice) return res.status(404).json({ error: "Invoice not found" });
    res.json(invoice);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Delete invoice (soft delete recommended)
exports.deleteInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findByIdAndDelete(req.params.id);
    if (!invoice) return res.status(404).json({ error: "Invoice not found" });
    res.json({ message: "Invoice deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
