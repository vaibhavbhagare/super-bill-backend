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
    
    // Soft delete fields
    deletedAt: { type: Date, default: null },
    deletedBy: { type: String },
  },
  { timestamps: true },
);

AttendanceSchema.index({ user: 1, date: 1 }, { unique: true }); // Prevent duplicate entries per user per day

// Add index for soft delete
AttendanceSchema.index({ deletedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

// Add soft delete method
AttendanceSchema.statics.softDelete = async function (id, deletedBy) {
  return this.findByIdAndUpdate(
    id,
    {
      $set: {
        deletedAt: new Date(),
        deletedBy,
        updatedAt: new Date(),
      },
    },
    { new: true },
  );
};

module.exports = mongoose.model("Attendance", AttendanceSchema);
