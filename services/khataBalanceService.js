const mongoose = require("mongoose");
const KhataTransaction = require("../models/KhataTransaction");

const activeMatch = {
  $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
};

const balanceDelta = {
  $cond: [{ $eq: ["$type", "credit"] }, "$amount", { $multiply: ["$amount", -1] }],
};

const toObjectIds = (customerIds) =>
  customerIds.map((id) => new mongoose.Types.ObjectId(id));

async function getBalancesByCustomerId(customerIds = null) {
  const match = { ...activeMatch };
  if (customerIds?.length) {
    match.customerId = { $in: toObjectIds(customerIds) };
  }

  const rows = await KhataTransaction.aggregate([
    { $match: match },
    {
      $addFields: {
        effectiveDate: { $ifNull: ["$transactionDate", "$createdAt"] },
      },
    },
    {
      $group: {
        _id: "$customerId",
        balance: { $sum: balanceDelta },
        lastTransactionAt: { $max: "$effectiveDate" },
        transactionCount: { $sum: 1 },
      },
    },
  ]);

  return new Map(
    rows.map((row) => [
      String(row._id),
      {
        balance: Number(row.balance) || 0,
        lastTransactionAt: row.lastTransactionAt,
        transactionCount: row.transactionCount || 0,
      },
    ]),
  );
}

async function getCustomerBalance(customerId) {
  const map = await getBalancesByCustomerId([customerId]);
  return map.get(String(customerId))?.balance ?? 0;
}

async function getTotalPending() {
  const rows = await KhataTransaction.aggregate([
    { $match: activeMatch },
    {
      $group: {
        _id: "$customerId",
        balance: { $sum: balanceDelta },
      },
    },
    { $match: { balance: { $gt: 0 } } },
    {
      $group: {
        _id: null,
        totalPending: { $sum: "$balance" },
        customersWithDue: { $sum: 1 },
      },
    },
  ]);

  return {
    totalPending: Number(rows[0]?.totalPending) || 0,
    customersWithDue: Number(rows[0]?.customersWithDue) || 0,
  };
}

module.exports = {
  getBalancesByCustomerId,
  getCustomerBalance,
  getTotalPending,
  activeMatch,
};
