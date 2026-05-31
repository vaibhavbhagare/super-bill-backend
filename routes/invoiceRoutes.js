const express = require("express");
const router = express.Router();
const invoiceController = require("../controllers/invoiceController");
const { auth } = require("../middleware/auth");
const { loadStore } = require("../middleware/loadStore");
const { requireFeature } = require("../middleware/accessControl");
const { Features } = require("../access/features");

router.use(auth);
router.use(loadStore);

router.post("/", invoiceController.createInvoice);
router.get("/", invoiceController.getInvoices);
router.post(
  "/send-whatsapp",
  requireFeature(Features.INVOICE_WHATSAPP),
  invoiceController.sendWhatsAppByInvoiceNumber,
);
router.get("/:id", invoiceController.getInvoiceById);
router.put("/:id", invoiceController.updateInvoice);
router.delete("/:id", invoiceController.deleteInvoice);

module.exports = router;
