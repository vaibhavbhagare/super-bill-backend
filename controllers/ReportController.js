const Invoice = require("../models/Invoice");
const Product = require("../models/Product");
const ProductStats = require("../models/ProductStats");
const Expense = require("../models/Expense");
const mongoose = require("mongoose");

exports.getReport = async (req, res) => {
  try {
    let {
      customerId,
      billerId,
      startDate,
      endDate,
      paymentStatus,
      transactionType,
    } = req.query;

    const today = new Date();
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    // Normalize to full-day range
    const start = startDate ? new Date(startDate) : firstDayOfMonth;
    start.setHours(0, 0, 0, 0);

    const end = endDate ? new Date(endDate) : today;
    end.setHours(23, 59, 59, 999);

    // Validate + normalize enums (case-insensitive)
    const norm = (v) => (typeof v === "string" ? v.trim().toUpperCase() : null);

    const allowedPayment = ["PAID", "UNPAID"];
    const allowedTxn = ["ONLINE", "CASH", "CREDIT"];

    const ps = norm(paymentStatus);
    const tx = norm(transactionType);

    if (ps && !allowedPayment.includes(ps)) {
      return res.status(400).json({
        message: "Invalid paymentStatus. Use PAID or UNPAID (case-insensitive).",
      });
    }

    if (tx && !allowedTxn.includes(tx)) {
      return res.status(400).json({
        message: "Invalid transactionType. Use ONLINE, CASH, or CREDIT (case-insensitive).",
      });
    }

    // Build Mongo match filter
    const match = {
      deletedAt: null,
      createdAt: { $gte: start, $lte: end },
    };
    if (customerId) {
      // Cast to ObjectId if valid
      if (mongoose.Types.ObjectId.isValid(customerId)) {
        match.customer = new mongoose.Types.ObjectId(customerId);
      } else {
        return res.status(400).json({ message: "Invalid customerId" });
      }
    }
    if (billerId) match.billerId = billerId;
    if (ps) match.paymentStatus = ps;
    if (tx) match.transactionType = tx;

    const pipeline = [
      { $match: match },
      {
        $facet: {
          // Compute totals and profits via line-level math
          lineAgg: [
            { $unwind: { path: "$buyingProducts", preserveNullAndEmptyArrays: true } },
            {
              $lookup: {
                from: "products",
                localField: "buyingProducts.product",
                foreignField: "_id",
                as: "_prod",
              },
            },
            { $unwind: { path: "$_prod", preserveNullAndEmptyArrays: true } },
            {
              $addFields: {
                _lineQty: { $ifNull: ["$buyingProducts.quantity", 0] },
                _linePrice: { $ifNull: ["$buyingProducts.price", 0] },
                _lineSubtotal: { $ifNull: ["$buyingProducts.subtotal", null] },
                _purchasePrice: { $ifNull: ["$buyingProducts.purchasePrice", { $ifNull: ["$_prod.purchasePrice", 0] }] },
              },
            },
            {
              $addFields: {
                _lineTotal: {
                  $cond: [
                    { $and: [ { $ne: ["$_lineSubtotal", null] }, { $not: { $gt: [ { $type: "$_lineSubtotal" }, "string" ] } } ] },
                    "$_lineSubtotal",
                    { $multiply: ["$_linePrice", "$_lineQty"] },
                  ],
                },
                _lineProfit: {
                  $multiply: [ { $subtract: ["$_linePrice", "$_purchasePrice"] }, "$_lineQty" ],
                },
              },
            },
            {
              $group: {
                _id: "$_id",
                invoiceTotal: { $sum: { $ifNull: ["$_lineTotal", 0] } },
                invoiceProfit: { $sum: { $ifNull: ["$_lineProfit", 0] } },
              },
            },
            {
              $group: {
                _id: null,
                totalSales: { $sum: "$invoiceTotal" },
                totalProfit: { $sum: "$invoiceProfit" },
                totalOrders: { $sum: 1 },
              },
            },
          ],
          // Sales trend by day using billingSummary.total (faster)
          trendAgg: [
            {
              $group: {
                _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
                sales: { $sum: { $ifNull: ["$billingSummary.total", 0] } },
              },
            },
            { $sort: { _id: 1 } },
          ],
        },
      },
      {
        $project: {
          summary: {
            $let: {
              vars: { s: { $arrayElemAt: ["$lineAgg", 0] } },
              in: {
                totalSales: { $ifNull: ["$$s.totalSales", 0] },
                totalProfit: { $ifNull: ["$$s.totalProfit", 0] },
                totalOrders: { $ifNull: ["$$s.totalOrders", 0] },
              },
            },
          },
          salesTrend: {
            $map: {
              input: "$trendAgg",
              as: "t",
              in: { date: "$$t._id", sales: "$$t.sales" },
            },
          },
        },
      },
    ];

    // Execute invoice aggregation
    const [invoiceResult] = await Invoice.aggregate(pipeline).allowDiskUse(true);

    // Build expense filter with same date range and filters
    const expenseMatch = {
      $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
      expenseDate: { $gte: start, $lte: end },
    };

    // Add billerId filter for expenses if provided (assuming expenses have createdBy field)
    if (billerId) {
      expenseMatch.createdBy = billerId;
    }

    // Execute expense aggregation
    const expensePipeline = [
      { $match: expenseMatch },
      {
        $group: {
          _id: null,
          totalExpense: { $sum: "$amount" },
          totalExpenseCount: { $sum: 1 },
        },
      },
    ];

    const [expenseResult] = await Expense.aggregate(expensePipeline).allowDiskUse(true);

    return res.json({
      summary: {
        ...(invoiceResult?.summary || { totalSales: 0, totalProfit: 0, totalOrders: 0 }),
        totalExpense: expenseResult?.totalExpense || 0,
        totalExpenseCount: expenseResult?.totalExpenseCount || 0,
      },
      salesTrend: invoiceResult?.salesTrend || [],
    });
  } catch (error) {
    console.error("Error generating report:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};




const NOT_SOLD_DAYS_DEFAULT = 35;
const LOW_STOCK_THRESHOLD_DEFAULT = 5;

const daysAgo = (days) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
};

exports.getProductStatsReport = async (req, res) => {
  try {
    let { startDate, endDate, transactionType, limit, lowStock, notSoldDays } = req.query;

    const today = new Date();
    const start = startDate
      ? new Date(startDate)
      : new Date(today.getFullYear(), today.getMonth(), 1);
    start.setHours(0, 0, 0, 0);
    const end = endDate ? new Date(endDate) : today;
    end.setHours(23, 59, 59, 999);

    const norm = (v) => (typeof v === "string" ? v.trim().toUpperCase() : null);
    const tx = norm(transactionType);
    const isOnline = tx === "ONLINE";
    const useChannelBreakdown = Boolean(tx);

    const topLimit = Math.min(Math.max(parseInt(limit || "10", 10), 1), 100);
    const lowStockThreshold = parseInt(lowStock || LOW_STOCK_THRESHOLD_DEFAULT, 10);
    const notSellingDays = parseInt(notSoldDays || NOT_SOLD_DAYS_DEFAULT, 10);

    const match = { lastSoldAt: { $gte: start, $lte: end } };

    const pipeline = [
      { $match: match },
      {
        $lookup: {
          from: "products",
          localField: "product",
          foreignField: "_id",
          as: "_prod",
        },
      },
      { $unwind: { path: "$_prod", preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          _units: useChannelBreakdown
            ? (isOnline ? "$onlineUnitsSold" : "$posUnitsSold")
            : "$totalUnitsSold",
          _times: useChannelBreakdown
            ? (isOnline ? "$onlineTimesSold" : "$posTimesSold")
            : "$totalTimesSold",
        },
      },
      {
        $facet: {
          topProducts: [
            {
              $project: {
                _id: 0,
                productId: "$product",
                name: "$_prod.name",
                secondName: "$_prod.secondName",
                stock: "$_prod.stock",
                expiryDate: "$_prod.expiryDate",
                unitsSold: { $ifNull: ["$_units", 0] },
                timesSold: { $ifNull: ["$_times", 0] },
                lastSoldAt: "$lastSoldAt",
                lastInvoice: "$lastInvoice",
              },
            },
            { $sort: { unitsSold: -1 } },
            { $limit: topLimit },
          ],
          expiredProducts: [
            { $match: { "_prod.expiryDate": { $lt: today } } },
            {
              $project: {
                productId: "$product",
                name: "$_prod.name",
                secondName: "$_prod.secondName",
                stock: "$_prod.stock",
                expiryDate: "$_prod.expiryDate",
              },
            },
          ],
          lowStockProducts: [
            { $match: { "_prod.stock": { $lte: lowStockThreshold } } },
            {
              $project: {
                productId: "$product",
                name: "$_prod.name",
                secondName: "$_prod.secondName",
                stock: "$_prod.stock",
              },
            },
          ],
          notSellingProducts: [
            {
              $match: {
                $or: [
                  { lastSoldAt: null },
                  { lastSoldAt: { $lt: daysAgo(notSellingDays) } },
                ],
              },
            },
            {
              $project: {
                productId: "$product",
                name: "$_prod.name",
                secondName: "$_prod.secondName",
                stock: "$_prod.stock",
                lastSoldAt: "$lastSoldAt",
              },
            },
          ],
          summary: [
            {
              $group: {
                _id: null,
                totalUnitsSold: { $sum: { $ifNull: ["$_units", 0] } },
                totalTimesSold: { $sum: { $ifNull: ["$_times", 0] } },
                uniqueProductsSold: {
                  $sum: { $cond: [{ $gt: [{ $ifNull: ["$_units", 0] }, 0] }, 1, 0] },
                },
              },
            },
          ],
        },
      },
      {
        $project: {
          topProducts: 1,
          expiredProducts: 1,
          lowStockProducts: 1,
          notSellingProducts: 1,
          summary: {
            $let: {
              vars: { s: { $arrayElemAt: ["$summary", 0] } },
              in: {
                totalUnitsSold: { $ifNull: ["$$s.totalUnitsSold", 0] },
                totalTimesSold: { $ifNull: ["$$s.totalTimesSold", 0] },
                uniqueProductsSold: { $ifNull: ["$$s.uniqueProductsSold", 0] },
                scope: useChannelBreakdown ? (isOnline ? "ONLINE" : "POS") : "TOTAL",
                dateRange: { start, end },
              },
            },
          },
        },
      },
    ];

    const [result] = await ProductStats.aggregate(pipeline).allowDiskUse(true);

    return res.json({
      summary: result?.summary || {},
      topProducts: result?.topProducts || [],
      expiredProducts: result?.expiredProducts || [],
      lowStockProducts: result?.lowStockProducts || [],
      notSellingProducts: result?.notSellingProducts || [],
    });
  } catch (error) {
    console.error("Error fetching product stats:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};


