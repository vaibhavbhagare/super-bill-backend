const mongoose = require("mongoose");

const customerSchema = new mongoose.Schema(
  {
    phoneNumber: { type: Number, required: true, unique: true },
    fullName: { type: String, required: true },
    address: { type: String, default: null },
    notepadPage: { type: String, default: null },
    isSynced: { type: Boolean, required: true },
    createdBy: String,
  },
  {
    timestamps: true,
  },
);

customerSchema.statics.markAsSynced = async function(id) {
   const result=  await this.findByIdAndUpdate(
    { _id: id, isSynced: false },
    { $set: { isSynced: true } }
  );
  console.log(result);
  return result;
};

module.exports = mongoose.model("Customer", customerSchema);
