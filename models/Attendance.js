const mongoose = require("mongoose");

const AttendanceSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    date: { type: Date, required: true },
    status: {
      type: String,
      enum: ["present", "absent", "leave", "sick", "halfday"],
      required: true,
    },
    remarks: String,
  },
  { timestamps: true },
);

AttendanceSchema.index({ user: 1, date: 1 }, { unique: true }); // Prevent duplicate entries per user per day

module.exports = mongoose.model("Attendance", AttendanceSchema);
