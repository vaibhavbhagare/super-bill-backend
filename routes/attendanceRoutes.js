const express = require("express");
const router = express.Router();
const attendanceController = require("../controllers/attendanceController");

const { auth } = require("../middleware/auth");
router.use(auth);

router.post("/", attendanceController.createAttendance);
router.get("/", attendanceController.listAttendance);
router.get("/:id", attendanceController.getAttendance);
router.put("/:id", attendanceController.updateAttendance);
router.delete("/:id", attendanceController.deleteAttendance);

module.exports = router;
