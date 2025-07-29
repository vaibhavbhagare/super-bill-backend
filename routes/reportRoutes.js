const express = require('express');
const router = express.Router();
const ReportController = require('../controllers/ReportController');
const { auth } = require("../middleware/auth");

// Apply auth middleware to all routes
router.use(auth);

router.get('/', ReportController.getReport);

module.exports = router;