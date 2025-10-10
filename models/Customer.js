const mongoose = require("mongoose");

const customerSchema = new mongoose.Schema(
  {
    phoneNumber: { type: Number, required: true, unique: true },
    fullName: { type: String, required: true },
    address: { type: String, default: null },
    // New addresses array to support multiple addresses
    addresses: {
      type: [
        new mongoose.Schema(
          {
            name: { type: String, default: "Home" },
            addressLine1: { type: String, required: true },
            addressLine2: { type: String, default: null },
            city: { type: String, required: true },
            pincode: { type: String, required: true },
            isDefault: { type: Boolean, default: false },
          },
          { _id: true, timestamps: true }
        ),
      ],
      default: [],
    },
    notepadPage: { type: String, default: null },
    isSynced: { type: Boolean },
    createdBy: String,
    deletedAt: { type: Date, default: null },
    deletedBy: { type: String },
  },
  {
    timestamps: true,
  },
);

customerSchema.index(
  { deletedAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 30 },
);

customerSchema.statics.softDelete = async function (id, deletedBy) {
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

customerSchema.statics.markAsSynced = async function (id) {
  const result = await this.findByIdAndUpdate(
    { _id: id, isSynced: false },
    { $set: { isSynced: true } },
  );
  console.log(result);
  return result;
};

module.exports = mongoose.model("Customer", customerSchema);
