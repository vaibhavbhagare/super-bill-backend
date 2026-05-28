const express = require("express");
const router = express.Router();
const messageReminderController = require("../controllers/messageReminderController");
const { auth } = require("../middleware/auth");

router.use(auth);

router.get("/templates", messageReminderController.getTemplates);
router.get("/customers", messageReminderController.getCustomersForReminders);
router.post("/send", messageReminderController.sendReminders);
router.get("/history", messageReminderController.getReminderHistory);

module.exports = router;
