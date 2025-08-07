const express = require('express');
const router = express.Router();
const salaryController = require('../controllers/salaryController');

const { auth } = require("../middleware/auth");
router.use(auth);

router.post('/', salaryController.createSalary);
router.get('/', salaryController.listSalary);
router.get('/:id', salaryController.getSalary);
router.put('/:id', salaryController.updateSalary);
router.delete('/:id', salaryController.deleteSalary);

module.exports = router;