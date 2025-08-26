const Invoice = require("../models/Invoice");
const Product = require("../models/Product");
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
                _purchasePrice: { $ifNull: ["$_prod.purchasePrice", 0] },
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

    const [result] = await Invoice.aggregate(pipeline).allowDiskUse(true);

    return res.json({
      summary: result?.summary || { totalSales: 0, totalProfit: 0, totalOrders: 0 },
      salesTrend: result?.salesTrend || [],
    });
  } catch (error) {
    console.error("Error generating report:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};




const NOT_SOLD_DAYS_DEFAULT = 35; // default value if not provided in query/body
const LOW_STOCK_THRESHOLD_DEFAULT = 5;

const daysAgo = (days) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
};

exports.getProductStatsReport = async (req, res) => {
  try {
    const NOT_SOLD_DAYS = parseInt(
      req.query.notSoldDays || req.body?.notSoldDays || NOT_SOLD_DAYS_DEFAULT
    );

    const LOW_STOCK = parseInt(
      req.query.lowStock || req.body?.lowStock || LOW_STOCK_THRESHOLD_DEFAULT
    );

    const today = new Date();
    const notSoldSince = daysAgo(NOT_SOLD_DAYS);

    const expiredProducts = await Product.find({
      expiryDate: { $lt: today },
      deletedAt: null,
    }).select("_id name secondName stock expiryDate");

    const lowStockProducts = await Product.find({
      stock: { $lt: LOW_STOCK },
      deletedAt: null,
    }).select("_id name secondName stock");

    const notSoldProducts = await Product.find({
      updatedAt: { $lt: notSoldSince },
      deletedAt: null,
    }).select("_id name secondName stock updatedAt");

    res.json({
      expired: {
        count: expiredProducts.length,
        products: expiredProducts,
      },
      lowStock: {
        count: lowStockProducts.length,
        products: lowStockProducts,
      },
      notSoldRecently: {
        since: `${NOT_SOLD_DAYS} days ago`,
        count: notSoldProducts.length,
        products: notSoldProducts,
      },
    });
  } catch (error) {
    console.error("Error fetching product stats:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

