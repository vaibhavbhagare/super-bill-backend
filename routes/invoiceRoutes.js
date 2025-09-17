const express = require("express");
const router = express.Router();
const invoiceController = require("../controllers/invoiceController");
const { auth } = require("../middleware/auth");
router.use(auth);

router.post("/", invoiceController.createInvoice);
router.get("/", invoiceController.getInvoices);
router.get("/:id", invoiceController.getInvoiceById);
router.put("/:id", invoiceController.updateInvoice);
router.delete("/:id", invoiceController.deleteInvoice);

module.exports = router;
