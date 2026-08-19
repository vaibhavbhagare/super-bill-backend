const Salary = require("../models/Salary");
const { permanentDeleteById } = require("../services/permanentDeleteService");

exports.createSalary = async (req, res) => {
  try {
    const salary = new Salary(req.body);
    await salary.save();
    res.status(201).json(salary);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.getSalary = async (req, res) => {
  try {
    const salary = await Salary.findOne({
      _id: req.params.id,
      $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
    }).populate("user");
    if (!salary) return res.status(404).json({ error: "Not found" });
    res.json(salary);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.updateSalary = async (req, res) => {
  try {
    const salary = await Salary.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    if (!salary) return res.status(404).json({ error: "Not found" });
    res.json(salary);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.deleteSalary = async (req, res) => {
  try {
    const existing = await Salary.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Not found" });

    const deletedBy = req.user?.userName || "system";
    await permanentDeleteById("salaries", String(req.params.id), deletedBy);
    res.json({
      message: "Salary permanently deleted from local and production",
      deletedBy,
      deletedAt: new Date(),
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.listSalary = async (req, res) => {
  try {
    const filter = {
      $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
    };
    if (req.query.user) filter.user = req.query.user;
    if (req.query.month) filter.month = req.query.month;
    const salary = await Salary.find(filter).populate("user");
    res.json(salary);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
