const Invoice = require("../models/Invoice");
const Product = require("../models/Product");
const Expense = require("../models/Expense");
const mongoose = require("mongoose");
const {
  getStoreDefaultMinStock,
  lowStockFindMatch,
  lowStockExprMatch,
} = require("../services/minStockHelper");

const LOW_STOCK_LIMIT = 100;

/** UTC YYYY-MM-DD series matching Mongo $dateToString (UTC) on invoice dates */
function fillSalesTrendUtc(start, end, trend) {
  const map = new Map((trend || []).map((t) => [t.date, t.sales]));
  const out = [];
  let t = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const endT = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  while (t <= endT) {
    const key = new Date(t).toISOString().slice(0, 10);
    out.push({ date: key, sales: map.get(key) ?? 0 });
    t += 86400000;
  }
  return out;
}

exports.getReport = async (req, res) => {
  try {
    let {
      customerId,
      billerId,
      startDate,
      endDate,
      paymentStatus,
      transactionType,
      lowStock: lowStockParam,
    } = req.query;

    const storeDefaultMinStock = await getStoreDefaultMinStock();

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
              $addFields: {
                _lineQty: { $ifNull: ["$buyingProducts.quantity", 0] },
                _linePrice: { $ifNull: ["$buyingProducts.price", 0] },
                _lineSubtotal: { $ifNull: ["$buyingProducts.subtotal", null] },
                // Cost at time of sale only — never use Product.purchasePrice (current master).
                _purchasePrice: { $ifNull: ["$buyingProducts.purchasePrice", 0] },
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
          // Sales trend by day using same line-item calculation as summary
          trendAgg: [
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
              },
            },
            {
              $group: {
                _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
                sales: { $sum: { $ifNull: ["$_lineTotal", 0] } },
              },
            },
            { $sort: { _id: 1 } },
          ],
          categoryAgg: [
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
                _firstCatId: { $arrayElemAt: ["$_prod.categories", 0] },
              },
            },
            {
              $lookup: {
                from: "categories",
                localField: "_firstCatId",
                foreignField: "_id",
                as: "_cat",
              },
            },
            { $unwind: { path: "$_cat", preserveNullAndEmptyArrays: true } },
            {
              $addFields: {
                _categoryName: { $ifNull: ["$_cat.name", "Uncategorized"] },
              },
            },
            {
              $group: {
                _id: "$_categoryName",
                sales: { $sum: { $ifNull: ["$_lineTotal", 0] } },
              },
            },
            { $sort: { sales: -1 } },
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
          categorySales: {
            $map: {
              input: "$categoryAgg",
              as: "c",
              in: { category: "$$c._id", sales: "$$c.sales" },
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
        },
      },
    ];

    const [expenseResult] = await Expense.aggregate(expensePipeline).allowDiskUse(true);

    const lowStockMatch = lowStockFindMatch(storeDefaultMinStock);
    if (billerId) lowStockMatch.createdBy = billerId;

    const lowStockRows = await Product.find(lowStockMatch)
      .select("name barcode stock minStock")
      .sort({ stock: 1 })
      .limit(LOW_STOCK_LIMIT)
      .lean();

    const lowStock = lowStockRows.map((p) => ({
      product: `${p.barcode} / ${p.name}`,
      stock: p.stock,
      minStock: p.minStock ?? null,
      effectiveMinStock:
        p.minStock != null ? p.minStock : storeDefaultMinStock,
    }));

    const salesTrend = fillSalesTrendUtc(start, end, invoiceResult?.salesTrend || []);

    return res.json({
      summary: {
        ...(invoiceResult?.summary || { totalSales: 0, totalProfit: 0, totalOrders: 0 }),
        totalExpense: expenseResult?.totalExpense || 0,
      },
      salesTrend,
      categorySales: invoiceResult?.categorySales || [],
      lowStock,
      lowStockMeta: {
        storeDefaultMinStock,
        rule: "Alert when stock <= (product.minStock ?? store.defaultMinStock)",
      },
    });
  } catch (error) {
    console.error("Error generating report:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};




const NOT_SOLD_DAYS_DEFAULT = 35;

const daysAgo = (days) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
};

exports.getProductStatsReport = async (req, res) => {
  try {
    let { startDate, endDate, transactionType, limit, notSoldDays } = req.query;

    const storeDefaultMinStock = await getStoreDefaultMinStock();

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

    const topLimit = Math.min(Math.max(parseInt(limit || "30", 30), 1), 100);
    const notSellingParsed = parseInt(notSoldDays || String(NOT_SOLD_DAYS_DEFAULT), 10);
    const notSellingDays = Number.isFinite(notSellingParsed) ? notSellingParsed : NOT_SOLD_DAYS_DEFAULT;
    const staleBefore = daysAgo(notSellingDays);

    // Top sellers + period summary must come from invoices in [start, end]. Using ProductStats.lastSoldAt
    // in that range is wrong: lastSoldAt is "last sale ever", so e.g. same-day range misses any product
    // that sold again after the range.
    const invoiceMatch = {
      deletedAt: null,
      createdAt: { $gte: start, $lte: end },
    };
    if (useChannelBreakdown) {
      invoiceMatch.channel = isOnline ? "ONLINE" : "POS";
    }

    const invoiceTopSummaryPipeline = [
      { $match: invoiceMatch },
      {
        $facet: {
          topProducts: [
            { $unwind: "$buyingProducts" },
            {
              $group: {
                _id: { p: "$buyingProducts.product", inv: "$_id" },
                qtyOnInvoice: { $sum: "$buyingProducts.quantity" },
                invCreatedAt: { $first: "$createdAt" },
              },
            },
            { $sort: { invCreatedAt: -1 } },
            {
              $group: {
                _id: "$_id.p",
                unitsSold: { $sum: "$qtyOnInvoice" },
                timesSold: { $sum: 1 },
                lastSoldAt: { $first: "$invCreatedAt" },
                lastInvoice: { $first: "$_id.inv" },
              },
            },
            { $sort: { unitsSold: -1 } },
            { $limit: topLimit },
            {
              $lookup: {
                from: "products",
                localField: "_id",
                foreignField: "_id",
                as: "_prod",
              },
            },
            { $unwind: { path: "$_prod", preserveNullAndEmptyArrays: true } },
            {
              $project: {
                _id: 0,
                productId: "$_id",
                name: "$_prod.name",
                secondName: "$_prod.secondName",
                stock: "$_prod.stock",
                expiryDate: "$_prod.expiryDate",
                unitsSold: 1,
                timesSold: 1,
                lastSoldAt: 1,
                lastInvoice: 1,
              },
            },
          ],
          summaryAgg: [
            { $unwind: "$buyingProducts" },
            {
              $group: {
                _id: null,
                totalUnitsSold: { $sum: "$buyingProducts.quantity" },
                uniqueProductsSold: { $addToSet: "$buyingProducts.product" },
                invoiceIds: { $addToSet: "$_id" },
              },
            },
            {
              $project: {
                _id: 0,
                totalUnitsSold: 1,
                uniqueProductsSold: { $size: "$uniqueProductsSold" },
                totalTimesSold: { $size: "$invoiceIds" },
              },
            },
          ],
        },
      },
    ];

    // Start from products + optional productstats so "not selling" and low stock are not filtered
    // out by the report date window (topProducts + summary use invoices; see above).
    const pipeline = [
      { $match: { deletedAt: null } },
      {
        $lookup: {
          from: "productstats",
          localField: "_id",
          foreignField: "product",
          as: "_st",
        },
      },
      { $unwind: { path: "$_st", preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          product: "$_id",
          _prod: {
            _id: "$_id",
            name: "$name",
            secondName: "$secondName",
            stock: "$stock",
            minStock: "$minStock",
            expiryDate: "$expiryDate",
          },
          lastSoldAt: "$_st.lastSoldAt",
        },
      },
      {
        $facet: {
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
            { $match: lowStockExprMatch(storeDefaultMinStock) },
            {
              $project: {
                productId: "$product",
                name: "$_prod.name",
                secondName: "$_prod.secondName",
                stock: "$_prod.stock",
                minStock: "$minStock",
                effectiveMinStock: {
                  $ifNull: ["$minStock", storeDefaultMinStock],
                },
              },
            },
          ],
          notSellingProducts: [
            {
              $match: {
                $or: [
                  { lastSoldAt: null },
                  { lastSoldAt: { $lt: staleBefore } },
                ],
              },
            },
            {
              $addFields: {
                // null => never had a sale in ProductStats; else whole days since last sale (UTC-ish)
                daysSinceLastSale: {
                  $cond: [
                    { $eq: ["$lastSoldAt", null] },
                    null,
                    {
                      $max: [
                        0,
                        {
                          $floor: {
                            $divide: [{ $subtract: [today, "$lastSoldAt"] }, 86400000],
                          },
                        },
                      ],
                    },
                  ],
                },
              },
            },
            { $sort: { lastSoldAt: 1 } },
            {
              $project: {
                _id: 0,
                productId: "$product",
                name: "$_prod.name",
                secondName: "$_prod.secondName",
                stock: "$_prod.stock",
                lastSoldAt: "$lastSoldAt",
                daysSinceLastSale: 1,
              },
            },
          ],
        },
      },
      {
        $project: {
          expiredProducts: 1,
          lowStockProducts: 1,
          notSellingProducts: 1,
        },
      },
    ];

    const [[result], [invoiceFacet]] = await Promise.all([
      Product.aggregate(pipeline).allowDiskUse(true),
      Invoice.aggregate(invoiceTopSummaryPipeline).allowDiskUse(true),
    ]);

    const s0 = invoiceFacet?.summaryAgg?.[0];
    const summary = {
      totalUnitsSold: s0?.totalUnitsSold ?? 0,
      totalTimesSold: s0?.totalTimesSold ?? 0,
      uniqueProductsSold: s0?.uniqueProductsSold ?? 0,
      scope: useChannelBreakdown ? (isOnline ? "ONLINE" : "POS") : "TOTAL",
      dateRange: { start, end },
    };

    return res.json({
      summary,
      topProducts: invoiceFacet?.topProducts || [],
      expiredProducts: result?.expiredProducts || [],
      lowStockProducts: result?.lowStockProducts || [],
      lowStockMeta: {
        storeDefaultMinStock,
        rule: "Alert when stock <= (product.minStock ?? store.defaultMinStock)",
      },
      notSellingMeta: {
        thresholdDays: notSellingDays,
        staleBefore: staleBefore.toISOString(),
        rule:
          "A product is listed if it has no ProductStats row (never sold) or lastSoldAt is strictly before staleBefore (now minus thresholdDays).",
      },
      notSellingProducts: result?.notSellingProducts || [],
    });
  } catch (error) {
    console.error("Error fetching product stats:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};


