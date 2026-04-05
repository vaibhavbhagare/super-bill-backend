const Attendance = require("../models/Attendance");
const User = require("../models/User");

/**
 * Calculate total days in a month
 * @param {Date} date - The date to get the month from
 * @returns {number} - Total days in the month
 */
function getTotalDaysInMonth(date) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1; // getMonth() returns 0-11
  return new Date(year, month, 0).getDate();
}

/**
 * Calculate daily salary based on user's baseSalary, date, and attendance status
 * @param {number} baseSalary - User's base salary
 * @param {Date} date - Attendance date
 * @param {string} status - Attendance status (present, absent, leave, sick, halfday)
 * @returns {number} - Calculated daily salary
 */
function calculateDailySalary(baseSalary, date, status) {
  if (!baseSalary || baseSalary <= 0) {
    return 0;
  }

  const totalDaysInMonth = getTotalDaysInMonth(date);
  const perDay = baseSalary / totalDaysInMonth;

  switch (status) {
    case "present":
    case "leave":
    case "sick":
      return Math.floor(perDay); // Full day salary
    case "halfday":
      return Math.floor(perDay / 2); // Half day salary
    case "absent":
    default:
      return 0; // No salary
  }
}

exports.createAttendance = async (req, res) => {
  try {
    const { dailySalary, user, date, status } = req.body;

    // Validate dailySalary if provided
    if (dailySalary !== undefined && dailySalary !== null) {
      if (typeof dailySalary !== "number" || dailySalary < 0) {
        return res.status(400).json({
          error: "dailySalary must be a number greater than or equal to 0",
        });
      }
    }

    // If dailySalary is not provided, calculate it
    let calculatedDailySalary = dailySalary;
    if (calculatedDailySalary === undefined || calculatedDailySalary === null) {
      // Get user's baseSalary
      const userDoc = await User.findById(user);
      if (!userDoc) {
        return res.status(404).json({ error: "User not found" });
      }

      const attendanceDate = date ? new Date(date) : new Date();
      calculatedDailySalary = calculateDailySalary(
        userDoc.baseSalary || 0,
        attendanceDate,
        status,
      );
    }

    const attendanceData = {
      ...req.body,
      dailySalary: calculatedDailySalary,
    };

    const attendance = new Attendance(attendanceData);
    await attendance.save();
    
    // Populate user for response
    await attendance.populate("user");
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
    const { dailySalary, status } = req.body;

    // Validate dailySalary if provided
    if (dailySalary !== undefined && dailySalary !== null) {
      if (typeof dailySalary !== "number" || dailySalary < 0) {
        return res.status(400).json({
          error: "dailySalary must be a number greater than or equal to 0",
        });
      }
    }

    // Get existing attendance record
    const existingAttendance = await Attendance.findById(req.params.id).populate("user");
    if (!existingAttendance) {
      return res.status(404).json({ error: "Not found" });
    }

    // Determine the status to use (new status if provided, otherwise existing)
    const statusToUse = status !== undefined ? status : existingAttendance.status;
    
    // If status is being changed and dailySalary is not explicitly provided, recalculate
    let calculatedDailySalary = dailySalary;
    if (
      (status && status !== existingAttendance.status) &&
      (calculatedDailySalary === undefined || calculatedDailySalary === null)
    ) {
      const userDoc = existingAttendance.user;
      const attendanceDate = existingAttendance.date;
      calculatedDailySalary = calculateDailySalary(
        userDoc?.baseSalary || 0,
        attendanceDate,
        statusToUse,
      );
    } else if (
      calculatedDailySalary === undefined ||
      calculatedDailySalary === null
    ) {
      // If dailySalary is not provided and status hasn't changed, keep existing value
      calculatedDailySalary = existingAttendance.dailySalary;
    }

    // Prepare update data
    const updateData = {
      ...req.body,
      dailySalary: calculatedDailySalary,
    };

    const attendance = await Attendance.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true },
    ).populate("user");

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
