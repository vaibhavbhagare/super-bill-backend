const Expense = require("../models/Expense");

// Create expense
exports.createExpense = async (req, res) => {
  try {
    const expenseData = {
      ...req.body,
      createdBy: req.user.userName,
    };

    const expense = new Expense(expenseData);
    const savedExpense = await expense.save();

    res.status(201).json({
      message: "Expense created successfully",
      data: savedExpense,
    });
  } catch (err) {
    console.error("Create expense error:", err);
    res.status(400).json({
      error: err.message,
      code: "VALIDATION_ERROR",
    });
  }
};

// Get all expenses with pagination and filtering
exports.getExpenses = async (req, res) => {
  try {
    // Parse and validate page and limit
    const page = Number(req.query.page) > 0 ? Number(req.query.page) : 1;
    const limit = Number(req.query.limit) > 0 ? Number(req.query.limit) : 10;
    const skip = (page - 1) * limit;

    // Build filter
    const filter = {
      $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
    };

    // Add search filter
    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search, "i");
      filter.$and = [
        {
          $or: [
            { title: { $regex: searchRegex } },
            { description: { $regex: searchRegex } },
            { receiptNumber: { $regex: searchRegex } },
          ],
        },
      ];
    }

    // Add category filter
    if (req.query.category) {
      filter.category = req.query.category;
    }

    // Add status filter
    if (req.query.status) {
      filter.status = req.query.status;
    }

    // Add date range filter
    if (req.query.startDate || req.query.endDate) {
      filter.expenseDate = {};
      if (req.query.startDate) {
        filter.expenseDate.$gte = new Date(req.query.startDate);
      }
      if (req.query.endDate) {
        filter.expenseDate.$lte = new Date(req.query.endDate);
      }
    }

    // Sort by expense date (newest first)
    const sort = { expenseDate: -1 };

    const [expenses, total] = await Promise.all([
      Expense.find(filter).sort(sort).skip(skip).limit(limit),
      Expense.countDocuments(filter),
    ]);

    res.json({
      data: expenses,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("Get expenses error:", err);
    res.status(500).json({
      error: "Internal server error",
      code: "INTERNAL_ERROR",
    });
  }
};

// Get expense by ID
exports.getExpenseById = async (req, res) => {
  try {
    const expense = await Expense.findOne({
      _id: req.params.id,
      $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
    });

    if (!expense) {
      return res.status(404).json({
        error: "Expense not found",
        code: "NOT_FOUND",
      });
    }

    res.json(expense);
  } catch (err) {
    console.error("Get expense by ID error:", err);
    res.status(500).json({
      error: "Internal server error",
      code: "INTERNAL_ERROR",
    });
  }
};

// Update expense
exports.updateExpense = async (req, res) => {
  try {
    const updateData = {
      ...req.body,
      updatedBy: req.user.userName,
    };

    const updatedExpense = await Expense.findOneAndUpdate(
      {
        _id: req.params.id,
        $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
      },
      updateData,
      { new: true, runValidators: true }
    );

    if (!updatedExpense) {
      return res.status(404).json({
        error: "Expense not found",
        code: "NOT_FOUND",
      });
    }

    res.json({
      message: "Expense updated successfully",
      data: updatedExpense,
    });
  } catch (err) {
    console.error("Update expense error:", err);
    res.status(400).json({
      error: err.message,
      code: "VALIDATION_ERROR",
    });
  }
};

// Delete expense (soft delete)
exports.deleteExpense = async (req, res) => {
  try {
    const deletedExpense = await Expense.softDelete(
      req.params.id,
      req.user?.userName || "system"
    );

    if (!deletedExpense) {
      return res.status(404).json({
        error: "Expense not found",
        code: "NOT_FOUND",
      });
    }

    res.json({
      message: "Expense deleted successfully",
      deletedBy: req.user.userName,
      deletedAt: new Date(),
    });
  } catch (err) {
    console.error("Delete expense error:", err);
    res.status(500).json({
      error: "Internal server error",
      code: "INTERNAL_ERROR",
    });
  }
};

// Approve expense
exports.approveExpense = async (req, res) => {
  try {
    const approvedExpense = await Expense.approveExpense(
      req.params.id,
      req.user.userName
    );

    if (!approvedExpense) {
      return res.status(404).json({
        error: "Expense not found",
        code: "NOT_FOUND",
      });
    }

    res.json({
      message: "Expense approved successfully",
      data: approvedExpense,
    });
  } catch (err) {
    console.error("Approve expense error:", err);
    res.status(500).json({
      error: "Internal server error",
      code: "INTERNAL_ERROR",
    });
  }
};

// Reject expense
exports.rejectExpense = async (req, res) => {
  try {
    const { rejectedReason } = req.body;

    if (!rejectedReason) {
      return res.status(400).json({
        error: "Rejection reason is required",
        code: "INVALID_INPUT",
      });
    }

    const rejectedExpense = await Expense.rejectExpense(
      req.params.id,
      rejectedReason,
      req.user.userName
    );

    if (!rejectedExpense) {
      return res.status(404).json({
        error: "Expense not found",
        code: "NOT_FOUND",
      });
    }

    res.json({
      message: "Expense rejected successfully",
      data: rejectedExpense,
    });
  } catch (err) {
    console.error("Reject expense error:", err);
    res.status(500).json({
      error: "Internal server error",
      code: "INTERNAL_ERROR",
    });
  }
};

// Get expense statistics
exports.getExpenseStats = async (req, res) => {
  try {
    const filter = {
      $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
    };

    // Add date range filter if provided
    if (req.query.startDate || req.query.endDate) {
      filter.expenseDate = {};
      if (req.query.startDate) {
        filter.expenseDate.$gte = new Date(req.query.startDate);
      }
      if (req.query.endDate) {
        filter.expenseDate.$lte = new Date(req.query.endDate);
      }
    }

    const stats = await Expense.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          totalAmount: { $sum: "$amount" },
          totalCount: { $sum: 1 },
          averageAmount: { $avg: "$amount" },
          pendingAmount: {
            $sum: {
              $cond: [{ $eq: ["$status", "pending"] }, "$amount", 0],
            },
          },
          approvedAmount: {
            $sum: {
              $cond: [{ $eq: ["$status", "approved"] }, "$amount", 0],
            },
          },
          rejectedAmount: {
            $sum: {
              $cond: [{ $eq: ["$status", "rejected"] }, "$amount", 0],
            },
          },
        },
      },
    ]);

    // Get category-wise breakdown
    const categoryStats = await Expense.aggregate([
      { $match: filter },
      {
        $group: {
          _id: "$category",
          totalAmount: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
      { $sort: { totalAmount: -1 } },
    ]);

    res.json({
      overall: stats[0] || {
        totalAmount: 0,
        totalCount: 0,
        averageAmount: 0,
        pendingAmount: 0,
        approvedAmount: 0,
        rejectedAmount: 0,
      },
      byCategory: categoryStats,
    });
  } catch (err) {
    console.error("Get expense stats error:", err);
    res.status(500).json({
      error: "Internal server error",
      code: "INTERNAL_ERROR",
    });
  }
};
