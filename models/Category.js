const mongoose = require("mongoose");

const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    slug: { type: String, trim: true, default: undefined },
    secondaryName: { type: String, default: null, trim: true },
    subCategory: { type: [String], default: [] },
    isSynced: { type: Boolean },
    createdBy: String,
    deletedAt: { type: Date, default: null },
    deletedBy: { type: String },
  },
  {
    timestamps: true,
  },
);

// TTL index to purge soft-deleted docs after 30 days
categorySchema.index({ deletedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

categorySchema.statics.softDelete = async function (id, deletedBy) {
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

categorySchema.statics.markAsSynced = async function (id) {
  const result = await this.findByIdAndUpdate(
    { _id: id, isSynced: false },
    { $set: { isSynced: true } },
  );
  return result;
};

// Ensure slug is unique only when it exists (avoid null duplication)
categorySchema.index({ slug: 1 }, { unique: true, partialFilterExpression: { slug: { $type: "string" } } });

module.exports = mongoose.model("Category", categorySchema);


