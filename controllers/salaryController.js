const Salary = require("../models/Salary");

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
    const salary = await Salary.findById(req.params.id).populate("user");
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
    const salary = await Salary.findByIdAndDelete(req.params.id);
    if (!salary) return res.status(404).json({ error: "Not found" });
    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.listSalary = async (req, res) => {
  try {
    const filter = {};
    if (req.query.user) filter.user = req.query.user;
    if (req.query.month) filter.month = req.query.month;
    const salary = await Salary.find(filter).populate("user");
    res.json(salary);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
