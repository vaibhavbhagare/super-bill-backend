const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const userSchema = new mongoose.Schema(
  {
    userName: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    name: { type: String, required: true },
    phoneNumber: { type: Number, required: true, unique: true },
    isSynced: { type: Boolean },
    role: {
      type: String,
      required: true,
      enum: ["admin", "biller", "packer"],
    },
    language: {
      type: String,
      required: true,
      enum: ["en", "mr", "hi"],
    },
    updatedBy: String,
  },
  {
    timestamps: true,
  },
);

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Exclude password from responses
userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

userSchema.statics.markAsSynced = async function (id) {
  const result = await this.findByIdAndUpdate(
    { _id: id, isSynced: false },
    { $set: { isSynced: true } },
  );
  console.log(result);
  return result;
};

module.exports = mongoose.model("User", userSchema);
