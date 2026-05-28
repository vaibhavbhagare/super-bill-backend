const User = require("../models/User");

/**
 * Ensure the initial super_admin exists.
 * Runs safely on every startup (idempotent).
 */
async function seedSuperAdmin() {
  // Allow opt-out via env (useful for prod/CI)
  if (String(process.env.SEED_SUPER_ADMIN || "true").toLowerCase() === "false") {
    return { created: false, skipped: true, reason: "disabled_by_env" };
  }

  const seedUser = {
    userName: process.env.SUPER_ADMIN_USERNAME || "vaibhav",
    name: process.env.SUPER_ADMIN_NAME || "vaibhav bhagare",
    role: "super_admin",
    password: process.env.SUPER_ADMIN_PASSWORD || "Zaq@3234",
    phoneNumber: Number(process.env.SUPER_ADMIN_PHONE || "9960038085"),
    language: process.env.SUPER_ADMIN_LANGUAGE || "en",
  };

  // If DB is empty / first start, create user; otherwise do nothing.
  const existing = await User.findOne({
    $and: [
      {
        $or: [
          { phoneNumber: seedUser.phoneNumber },
          { userName: seedUser.userName },
          { role: "super_admin" },
        ],
      },
      { $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }] },
    ],
  });

  if (existing) {
    return { created: false, skipped: true, reason: "already_exists" };
  }

  const created = await new User(seedUser).save();
  return { created: true, id: created._id };
}

module.exports = { seedSuperAdmin };

