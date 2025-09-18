const Category = require("../models/Category");

// Generate a URL-friendly slug; keeps Unicode letters/numbers, replaces others with dashes
const toSlug = (input) => {
  return String(input || "")
    .normalize("NFKD")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
};

// Create (upsert by name)
exports.createCategory = async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: "'name' is required" });

    const secondaryName = req.body?.secondaryName ?? null;
    const subCategory = Array.isArray(req.body?.subCategory)
      ? req.body.subCategory
      : [];
    const createdBy = req.user?.userName || "system";
    const slug = toSlug(name);

    const update = {
      $set: {
        name,
        secondaryName,
        subCategory,
        slug,
      },
      $setOnInsert: { createdBy },
    };

    const result = await Category.findOneAndUpdate(
      { $or: [{ name }, { slug }] },
      update,
      { new: true, upsert: true, setDefaultsOnInsert: true, rawResult: true },
    );

    const wasInserted = Boolean(result?.lastErrorObject?.upserted);
    const doc = result?.value || result; // compatibility
    return res.status(wasInserted ? 201 : 200).json({
      data: doc,
      created: wasInserted,
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
};

// Read all with pagination and optional search on name/secondaryName
exports.getCategories = async (req, res) => {
  try {
    const page = parseInt(req.query.page) > 0 ? parseInt(req.query.page) : 1;
    const limit = parseInt(req.query.limit) > 0 ? parseInt(req.query.limit) : 50;
    const skip = (page - 1) * limit;

    const filter = { $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }] };
    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search, "i");
      filter.$or = [
        { name: { $regex: searchRegex } },
        { secondaryName: { $regex: searchRegex } },
      ];
    }

    const sort = { updatedAt: -1 };
    const [categories, total] = await Promise.all([
      Category.find(filter).sort(sort).skip(skip).limit(limit),
      Category.countDocuments(filter),
    ]);

    res.json({ data: categories, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// Read one
exports.getCategoryById = async (req, res) => {
  try {
    const doc = await Category.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: "Category not found" });
    res.json(doc);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// Update
exports.updateCategory = async (req, res) => {
  try {
    const updated = await Category.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!updated) return res.status(404).json({ error: "Category not found" });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// Delete (soft)
exports.deleteCategory = async (req, res) => {
  try {
    const deleted = await Category.softDelete(req.params.id, req.user?.userName || "system");
    if (!deleted) return res.status(404).json({ error: "Category not found" });
    res.json({ message: "Category deleted" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};


// Bulk create (upsert by name)
exports.bulkCreateCategories = async (req, res) => {
  try {
    const payloadArray = Array.isArray(req.body) ? req.body : req.body?.categories;
    if (!Array.isArray(payloadArray) || payloadArray.length === 0) {
      return res.status(400).json({ error: "Provide a non-empty array of categories" });
    }

    const createdBy = req.user?.userName || "system";
    const ops = [];
    for (const item of payloadArray) {
      const name = String(item?.name || "").trim();
      const secondaryName = item?.secondaryName ?? null;
      const subCategory = Array.isArray(item?.subCategory) ? item.subCategory : [];
      const slug = toSlug(name);
      ops.push({
        name,
        secondaryName,
        subCategory,
        slug,
      });
    }

    // Basic validation: ensure required 'name' exists
    const invalid = ops.find((d) => !d.name || String(d.name).trim().length === 0);
    if (invalid) {
      return res.status(400).json({ error: "Each category must have a non-empty name" });
    }

    const bulkOps = ops.map((d) => ({
      updateOne: {
        filter: { $or: [{ name: d.name }, { slug: d.slug }] },
        update: {
          $set: {
            name: d.name,
            secondaryName: d.secondaryName,
            subCategory: d.subCategory,
            slug: d.slug,
          },
          $setOnInsert: { createdBy },
        },
        upsert: true,
      },
    }));

    const result = await Category.bulkWrite(bulkOps, { ordered: false });
    const { upsertedCount = 0, modifiedCount = 0, matchedCount = 0 } = result || {};
    return res.status(200).json({
      upsertedCount,
      modifiedCount,
      matchedCount,
      result,
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
};


