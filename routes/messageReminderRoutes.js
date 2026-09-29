const express = require("express");
const router = express.Router();
const messageReminderController = require("../controllers/messageReminderController");
const khataController = require("../controllers/khataController");
const { auth } = require("../middleware/auth");

router.use(auth);

router.get("/templates", messageReminderController.getTemplates);
router.get("/customers", messageReminderController.getCustomersForReminders);
router.post("/send", messageReminderController.sendReminders);
router.get("/history", messageReminderController.getReminderHistory);

// Khata Book ledger
router.get("/khata/summary", khataController.getKhataSummary);
router.get("/khata/customers/pending-report", khataController.getKhataPendingReport);
router.get("/khata/customers", khataController.getKhataCustomers);
router.post("/khata/customers/upsert", khataController.upsertKhataCustomer);
router.get("/khata/customers/:customerId/transactions", khataController.getKhataTransactions);
router.post("/khata/transactions", khataController.addKhataTransaction);
router.post("/khata/customers/:customerId/send-reminder", khataController.sendKhataReminder);

module.exports = router;
