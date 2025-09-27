const Attendance = require("../models/Attendance");

exports.createAttendance = async (req, res) => {
  try {
    const attendance = new Attendance(req.body);
    await attendance.save();
    res.status(201).json(attendance);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.getAttendance = async (req, res) => {
  try {
    const attendance = await Attendance.findOne({
      _id: req.params.id,
      $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
    }).populate("user");
    if (!attendance) return res.status(404).json({ error: "Not found" });
    res.json(attendance);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.updateAttendance = async (req, res) => {
  try {
    const attendance = await Attendance.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true },
    );
    if (!attendance) return res.status(404).json({ error: "Not found" });
    res.json(attendance);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.deleteAttendance = async (req, res) => {
  try {
    const attendance = await Attendance.softDelete(
      req.params.id,
      req.user?.userName || "system",
    );
    if (!attendance) return res.status(404).json({ error: "Not found" });
    res.json({ 
      message: "Attendance deleted",
      deletedBy: req.user?.userName || "system",
      deletedAt: new Date(),
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.listAttendance = async (req, res) => {
  try {
    const filter = {
      $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
    };
    if (req.query.user) filter.user = req.query.user;
    if (req.query.date) filter.date = req.query.date;
    const attendance = await Attendance.find(filter).populate("user");
    res.json(attendance);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
