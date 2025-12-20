/**
 * Migration Script: Populate dailySalary for existing Attendance records
 * 
 * This script:
 * 1. Finds all attendance records where dailySalary is null/undefined
 * 2. For each record, calculates dailySalary based on:
 *    - User's baseSalary
 *    - Total days in the month from the date field
 *    - Attendance status
 * 3. Updates the record with the calculated dailySalary
 * 
 * Usage:
 *   node scripts/migrate-daily-salary.js
 */

const mongoose = require("mongoose");
const dotenv = require("dotenv");
dotenv.config();

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

async function migrateDailySalary() {
  try {
    // Connect to MongoDB
    const isDev =
      process.env.NODE_ENV === "development" ||
      process.env.NODE_ENV === "local" ||
      process.env.NODE_ENV === "dev";

    const mongoUri = isDev
      ? process.env.LOCAL_MONGO_URI || process.env.MONGODB_URI
      : process.env.MONGODB_URI || process.env.REMOTE_MONGO_URI;

    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log("✅ Connected to MongoDB");
    console.log("🔄 Starting migration: Populate dailySalary for existing Attendance records...\n");

    // Find all attendance records where dailySalary is null/undefined
    const attendanceRecords = await Attendance.find({
      $and: [
        {
          $or: [
            { dailySalary: { $exists: false } },
            { dailySalary: null },
          ],
        },
        {
          $or: [
            { deletedAt: { $exists: false } },
            { deletedAt: null },
          ],
        },
      ],
    }).populate("user");

    console.log(`📊 Found ${attendanceRecords.length} attendance records without dailySalary\n`);

    if (attendanceRecords.length === 0) {
      console.log("✅ No records to migrate. All attendance records already have dailySalary.");
      await mongoose.connection.close();
      process.exit(0);
    }

    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    // Process each record
    for (let i = 0; i < attendanceRecords.length; i++) {
      const attendance = attendanceRecords[i];
      try {
        // Get user's baseSalary
        const user = attendance.user;
        if (!user) {
          console.log(`⚠️  Skipping attendance ${attendance._id}: User not found`);
          errorCount++;
          errors.push({
            attendanceId: attendance._id,
            error: "User not found",
          });
          continue;
        }

        const baseSalary = user.baseSalary || 0;
        const attendanceDate = attendance.date;
        const status = attendance.status;

        // Calculate dailySalary
        const calculatedDailySalary = calculateDailySalary(
          baseSalary,
          attendanceDate,
          status,
        );

        // Update the record
        await Attendance.findByIdAndUpdate(attendance._id, {
          $set: { dailySalary: calculatedDailySalary },
        });

        successCount++;

        // Log progress every 100 records
        if ((i + 1) % 100 === 0) {
          console.log(`📝 Processed ${i + 1}/${attendanceRecords.length} records...`);
        }
      } catch (err) {
        errorCount++;
        errors.push({
          attendanceId: attendance._id,
          error: err.message,
        });
        console.error(`❌ Error processing attendance ${attendance._id}:`, err.message);
      }
    }

    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("📊 Migration Summary:");
    console.log("=".repeat(60));
    console.log(`✅ Successfully migrated: ${successCount} records`);
    console.log(`❌ Errors: ${errorCount} records`);

    if (errors.length > 0) {
      console.log("\n⚠️  Errors encountered:");
      errors.slice(0, 10).forEach((err) => {
        console.log(`   - Attendance ${err.attendanceId}: ${err.error}`);
      });
      if (errors.length > 10) {
        console.log(`   ... and ${errors.length - 10} more errors`);
      }
    }

    console.log("\n✅ Migration completed!");
    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error("❌ Migration failed:", err);
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Run migration
migrateDailySalary();

