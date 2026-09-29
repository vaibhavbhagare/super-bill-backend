const mongoose = require("mongoose");
const Customer = require("../models/Customer");
const KhataTransaction = require("../models/KhataTransaction");
const ReminderHistory = require("../models/ReminderHistory");
const {
  getBalancesByCustomerId,
  getCustomerBalance,
  getTotalPending,
  activeMatch,
} = require("../services/khataBalanceService");
const { sendCustomerReminder } = require("../services/reminderSendService");

const normalizePhone = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return Number(digits);
  if (digits.length === 12 && digits.startsWith("91")) return Number(digits.slice(2));
  return null;
};

/** Parse YYYY-MM-DD (or Date) as local noon to avoid timezone day-shift. */
const parseTransactionDate = (value) => {
  if (value == null || value === "") return new Date();

  const raw = String(value).trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  let date;
  if (match) {
    date = new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      12,
      0,
      0,
      0,
    );
  } else {
    date = new Date(raw);
  }

  if (Number.isNaN(date.getTime())) return null;

  const today = new Date();
  today.setHours(23, 59, 59, 999);
  if (date.getTime() > today.getTime()) {
    return null;
  }
  return date;
};

const sortCustomers = (rows, sort) => {
  const list = [...rows];
  switch (sort) {
    case "balance_asc":
      return list.sort((a, b) => a.pendingBalance - b.pendingBalance);
    case "name_asc":
      return list.sort((a, b) =>
        String(a.fullName).localeCompare(String(b.fullName), "en", {
          sensitivity: "base",
        }),
      );
    case "name_desc":
      return list.sort((a, b) =>
        String(b.fullName).localeCompare(String(a.fullName), "en", {
          sensitivity: "base",
        }),
      );
    case "date_asc":
      return list.sort(
        (a, b) =>
          new Date(a.lastTransactionAt || 0).getTime() -
          new Date(b.lastTransactionAt || 0).getTime(),
      );
    case "date_desc":
      return list.sort(
        (a, b) =>
          new Date(b.lastTransactionAt || 0).getTime() -
          new Date(a.lastTransactionAt || 0).getTime(),
      );
    case "balance_desc":
    default:
      return list.sort((a, b) => b.pendingBalance - a.pendingBalance);
  }
};

exports.getKhataSummary = async (_req, res) => {
  try {
    const { totalPending, customersWithDue } = await getTotalPending();
    const transactionCount = await KhataTransaction.countDocuments(activeMatch);

    return res.json({
      data: {
        totalPending,
        customersWithDue,
        transactionCount,
      },
    });
  } catch (err) {
    console.error("getKhataSummary error:", err);
    return res.status(500).json({ error: err.message });
  }
};

exports.getKhataPendingReport = async (req, res) => {
  try {
    const sort = (req.query.sort || "balance_desc").trim();
    const balanceMap = await getBalancesByCustomerId();

    const customerFilter = {
      $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
    };

    const customers = await Customer.find(customerFilter).lean();

    const customerIds = customers
      .filter((c) => (balanceMap.get(String(c._id))?.balance ?? 0) > 0)
      .map((c) => c._id);

    const [latestPayments, latestNotes, latestReminders] = await Promise.all([
      KhataTransaction.aggregate([
        {
          $match: {
            ...activeMatch,
            type: "payment",
            customerId: { $in: customerIds },
          },
        },
        {
          $addFields: {
            effectiveDate: { $ifNull: ["$transactionDate", "$createdAt"] },
          },
        },
        { $sort: { effectiveDate: -1, createdAt: -1 } },
        {
          $group: {
            _id: "$customerId",
            amount: { $first: "$amount" },
            paidAt: { $first: "$effectiveDate" },
          },
        },
      ]),
      KhataTransaction.aggregate([
        {
          $match: {
            ...activeMatch,
            customerId: { $in: customerIds },
          },
        },
        {
          $addFields: {
            effectiveDate: { $ifNull: ["$transactionDate", "$createdAt"] },
          },
        },
        { $sort: { effectiveDate: -1, createdAt: -1 } },
        {
          $group: {
            _id: "$customerId",
            note: { $first: "$note" },
          },
        },
      ]),
      ReminderHistory.aggregate([
        {
          $match: {
            customerId: { $in: customerIds },
          },
        },
        { $sort: { sentAt: -1 } },
        {
          $group: {
            _id: "$customerId",
            sentAt: { $first: "$sentAt" },
            status: { $first: "$status" },
          },
        },
      ]),
    ]);

    const paymentMap = new Map(
      latestPayments.map((row) => [String(row._id), row]),
    );
    const noteMap = new Map(latestNotes.map((row) => [String(row._id), row]));
    const reminderMap = new Map(
      latestReminders.map((row) => [String(row._id), row]),
    );

    let rows = customers
      .map((customer) => {
        const id = String(customer._id);
        const stats = balanceMap.get(id);
        const pendingBalance = stats?.balance ?? 0;
        if (pendingBalance <= 0) return null;

        const payment = paymentMap.get(id);
        const noteRow = noteMap.get(id);
        const reminder = reminderMap.get(id);
        const note = String(noteRow?.note || "").trim();

        return {
          _id: id,
          fullName: customer.fullName,
          phoneNumber: customer.phoneNumber,
          pendingBalance,
          paidNewly: payment?.amount ?? null,
          paidNewlyAt: payment?.paidAt ?? null,
          lastReminderAt: reminder?.sentAt ?? null,
          lastReminderStatus: reminder?.status ?? null,
          comment: note || null,
          lastTransactionAt: stats?.lastTransactionAt ?? null,
        };
      })
      .filter(Boolean);

    rows = sortCustomers(rows, sort);

    const { totalPending } = await getTotalPending();

    return res.json({
      data: rows,
      total: rows.length,
      totalPending,
    });
  } catch (err) {
    console.error("getKhataPendingReport error:", err);
    return res.status(500).json({ error: err.message });
  }
};

exports.getKhataCustomers = async (req, res) => {
  try {
    const page = Number(req.query.page) > 0 ? Number(req.query.page) : 1;
    const limit = Number(req.query.limit) > 0 ? Number(req.query.limit) : 50;
    const skip = (page - 1) * limit;
    const search = (req.query.search || "").trim();
    const sort = (req.query.sort || "balance_desc").trim();

    const customerFilter = {
      $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
    };

    if (search) {
      const searchRegex = new RegExp(search, "i");
      customerFilter.$and = [
        {
          $or: [
            { fullName: { $regex: searchRegex } },
            {
              $expr: {
                $regexMatch: {
                  input: { $toString: "$phoneNumber" },
                  regex: search,
                  options: "i",
                },
              },
            },
          ],
        },
      ];
    }

    const customers = await Customer.find(customerFilter).lean();
    const balanceMap = await getBalancesByCustomerId();

    let rows = customers.map((customer) => {
      const stats = balanceMap.get(String(customer._id));
      return {
        _id: String(customer._id),
        fullName: customer.fullName,
        phoneNumber: customer.phoneNumber,
        pendingBalance: stats?.balance ?? 0,
        lastTransactionAt: stats?.lastTransactionAt ?? null,
        transactionCount: stats?.transactionCount ?? 0,
      };
    });

    if (!search) {
      rows = rows.filter(
        (row) => row.pendingBalance !== 0 || row.transactionCount > 0,
      );
    }

    rows = sortCustomers(rows, sort);
    const total = rows.length;
    const paginated = rows.slice(skip, skip + limit);

    return res.json({
      data: paginated,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    console.error("getKhataCustomers error:", err);
    return res.status(500).json({ error: err.message });
  }
};

exports.upsertKhataCustomer = async (req, res) => {
  try {
    const { phoneNumber, fullName } = req.body || {};
    const phone = normalizePhone(phoneNumber);
    const name = String(fullName || "").trim();

    if (!phone) {
      return res.status(400).json({ error: "Valid 10-digit phone number is required" });
    }
    if (!name) {
      return res.status(400).json({ error: "Customer name is required" });
    }

    const existing = await Customer.findOne({
      phoneNumber: phone,
      $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
    });

    let customer;
    let updatedNameOnly = false;

    if (existing) {
      existing.fullName = name;
      customer = await existing.save();
      updatedNameOnly = true;
    } else {
      customer = await Customer.create({
        phoneNumber: phone,
        fullName: name,
        createdBy: req.user?.userName || req.user?.name || "system",
      });
    }

    const balance = await getCustomerBalance(customer._id);

    return res.status(updatedNameOnly ? 200 : 201).json({
      message: updatedNameOnly ? "Customer name updated" : "Customer added",
      data: {
        _id: String(customer._id),
        fullName: customer.fullName,
        phoneNumber: customer.phoneNumber,
        pendingBalance: balance,
        updatedNameOnly,
      },
    });
  } catch (err) {
    console.error("upsertKhataCustomer error:", err);
    return res.status(400).json({ error: err.message });
  }
};

exports.getKhataTransactions = async (req, res) => {
  try {
    const { customerId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(customerId)) {
      return res.status(400).json({ error: "Invalid customer id" });
    }

    const customer = await Customer.findOne({
      _id: customerId,
      $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
    }).lean();

    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }

    const transactions = await KhataTransaction.find({
      customerId,
      ...activeMatch,
    })
      .sort({ transactionDate: -1, createdAt: -1 })
      .lean();

    const pendingBalance = await getCustomerBalance(customerId);

    return res.json({
      data: {
        customer: {
          _id: String(customer._id),
          fullName: customer.fullName,
          phoneNumber: customer.phoneNumber,
          pendingBalance,
        },
        transactions,
      },
    });
  } catch (err) {
    console.error("getKhataTransactions error:", err);
    return res.status(500).json({ error: err.message });
  }
};

exports.addKhataTransaction = async (req, res) => {
  try {
    const {
      customerId,
      phoneNumber,
      fullName,
      type,
      amount,
      note,
      transactionDate,
      sendAutoReminder = true,
      storeName,
    } = req.body || {};

    if (!["credit", "payment"].includes(type)) {
      return res.status(400).json({ error: "type must be credit or payment" });
    }

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ error: "amount must be greater than 0" });
    }

    const parsedTransactionDate = parseTransactionDate(transactionDate);
    if (transactionDate && !parsedTransactionDate) {
      return res.status(400).json({
        error: "Invalid transactionDate. Use YYYY-MM-DD and do not select a future date.",
      });
    }

    let customer = null;
    if (customerId) {
      customer = await Customer.findOne({
        _id: customerId,
        $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
      });
    } else {
      const phone = normalizePhone(phoneNumber);
      const name = String(fullName || "").trim();
      if (!phone) {
        return res.status(400).json({ error: "Valid phone number is required" });
      }
      if (!name) {
        return res.status(400).json({ error: "Customer name is required" });
      }

      customer = await Customer.findOne({
        phoneNumber: phone,
        $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
      });

      if (customer) {
        customer.fullName = name;
        await customer.save();
      } else {
        customer = await Customer.create({
          phoneNumber: phone,
          fullName: name,
          createdBy: req.user?.userName || req.user?.name || "system",
        });
      }
    }

    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }

    const currentBalance = await getCustomerBalance(customer._id);
    const balanceAfter =
      type === "credit"
        ? currentBalance + numericAmount
        : Math.max(0, currentBalance - numericAmount);

    if (type === "payment" && numericAmount > currentBalance) {
      return res.status(400).json({
        error: `Payment cannot exceed pending balance of ₹${currentBalance}`,
      });
    }

    const sentBy = req.user?.userName || req.user?.name || "system";
    let reminderStatus = sendAutoReminder ? "skipped" : null;
    let autoReminderSent = false;

    const transaction = await KhataTransaction.create({
      customerId: customer._id,
      type,
      amount: numericAmount,
      note: String(note || "").trim(),
      balanceAfter,
      transactionDate: parsedTransactionDate || new Date(),
      createdBy: sentBy,
      autoReminderSent: false,
      reminderStatus: null,
    });

    if (sendAutoReminder) {
      const outcome = await sendCustomerReminder({
        customerId: customer._id,
        customerName: customer.fullName,
        mobileRaw: customer.phoneNumber,
        balance: balanceAfter,
        transactionType: type,
        transactionAmount: numericAmount,
        storeName,
        sentBy,
      });
      autoReminderSent = outcome.status === "sent";
      reminderStatus = outcome.status;
      transaction.autoReminderSent = autoReminderSent;
      transaction.reminderStatus = reminderStatus;
      await transaction.save();
    }

    return res.status(201).json({
      message: "Transaction recorded",
      data: {
        transaction,
        customer: {
          _id: String(customer._id),
          fullName: customer.fullName,
          phoneNumber: customer.phoneNumber,
          pendingBalance: balanceAfter,
        },
        reminder: { autoReminderSent, reminderStatus },
      },
    });
  } catch (err) {
    console.error("addKhataTransaction error:", err);
    return res.status(500).json({ error: err.message });
  }
};

exports.sendKhataReminder = async (req, res) => {
  try {
    const { customerId } = req.params;
    const { templateId, storeName } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(customerId)) {
      return res.status(400).json({ error: "Invalid customer id" });
    }

    const customer = await Customer.findOne({
      _id: customerId,
      $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
    });

    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }

    const balance = await getCustomerBalance(customerId);
    const sentBy = req.user?.userName || req.user?.name || "system";

    const outcome = await sendCustomerReminder({
      customerId: customer._id,
      customerName: customer.fullName,
      mobileRaw: customer.phoneNumber,
      balance,
      templateId,
      storeName,
      sentBy,
    });

    if (outcome.status === "sent") {
      return res.json({ message: "Reminder sent", data: outcome });
    }

    return res.status(400).json({
      error: outcome.error || "Failed to send reminder",
      data: outcome,
    });
  } catch (err) {
    console.error("sendKhataReminder error:", err);
    return res.status(500).json({ error: err.message });
  }
};
