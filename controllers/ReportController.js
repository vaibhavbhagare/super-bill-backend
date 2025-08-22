const Invoice = require("../models/Invoice");
const Product = require("../models/Product");
// GET /api/reports
// ?startDate=2025-08-01&endDate=2025-08-21
// &paymentStatus=paid|unpaid         // optional
// &transactionType=online|cash|credit // optional
// &customerId=<ObjectId>             // optional
// &billerId=<string>                 // optional

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

    // Build Mongo filter
    const filter = {
      deletedAt: null, // exclude soft-deleted
      createdAt: { $gte: start, $lte: end },
    };
    if (customerId) filter.customer = customerId;
    if (billerId) filter.billerId = billerId;
    if (ps) filter.paymentStatus = ps;
    if (tx) filter.transactionType = tx;

    // Query: populate only needed fields for profit calc
    const invoices = await Invoice.find(filter)
      .populate({
        path: "buyingProducts.product",
        select: "purchasePrice",
      })
      .lean();

    let totalSales = 0;
    let totalProfit = 0;
    const salesByDate = Object.create(null);

    for (const invoice of invoices) {
      // Per-item sums
      for (const item of invoice.buyingProducts || []) {
        const qty = Number(item.quantity) || 0;
        const sell = Number(item.price) || 0;
        console.log(invoice.buyingProducts)
        // Prefer provided subtotal if you store it, otherwise compute
        const lineTotal =
          typeof item.subtotal === "number" && !Number.isNaN(item.subtotal)
            ? item.subtotal
            : sell * qty;

        const purchasePrice =
          (item.product && Number(item.product.purchasePrice)) || 0;
        const lineProfit = (sell - purchasePrice) * qty;

        totalSales += lineTotal;
        totalProfit += lineProfit;
      }

      // Trend by YYYY-MM-DD (UTC date). If you want IST, adjust here.
      const dateKey = new Date(invoice.createdAt).toISOString().slice(0, 10);
      if (!salesByDate[dateKey]) salesByDate[dateKey] = 0;

      // Use billingSummary.total if present; fallback to per-item sum for that invoice
      const invoiceTotal =
        (invoice.billingSummary && Number(invoice.billingSummary.total)) || 0;
      salesByDate[dateKey] += invoiceTotal || 0;
    }

    const salesTrend = Object.entries(salesByDate)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([date, sales]) => ({ date, sales }));

    const summary = {
      totalSales,
      totalProfit,
      totalOrders: invoices.length,
    };

    return res.json({ summary, salesTrend });
  } catch (error) {
    console.error("Error generating report:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};


// exports.getReport = async (req, res) => {
//   try {
//     let { customerId, billerId, startDate, endDate } = req.query;

//     const today = new Date();
//     const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

//     // Normalize start & end dates to cover the **entire** day range
//     const start = startDate ? new Date(startDate) : firstDayOfMonth;
//     start.setHours(0, 0, 0, 0); // 00:00:00.000 of the start day

//     const end = endDate ? new Date(endDate) : today;
//     end.setHours(23, 59, 59, 999); // 23:59:59.999 of the end day

//     // Build filter object
//     const filter = {
//       createdAt: { $gte: start, $lte: end },
//     };

//     if (customerId) filter.customer = customerId;
//     if (billerId) filter.billerId = billerId;

//     const invoices = await Invoice.find(filter).populate(
//       "buyingProducts.product",
//     );

//     let totalSales = 0;
//     let totalProfit = 0;
//     const salesByDate = {};

//     for (const invoice of invoices) {
//       for (const item of invoice.buyingProducts) {
//         const sellingPrice = item.price;
//         const quantity = item.quantity;
//         const subtotal = sellingPrice * quantity;

//         const product = item.product;
//         const purchasePrice = product?.purchasePrice || 0;
//         const profit = purchasePrice
//           ? (sellingPrice - purchasePrice) * quantity
//           : 0;
//         totalSales += subtotal;
//         totalProfit += profit;
//       }

//       const dateKey = invoice.createdAt.toISOString().split("T")[0];
//       if (!salesByDate[dateKey]) salesByDate[dateKey] = 0;

//       const invoiceTotal = invoice.billingSummary?.total || 0;
//       salesByDate[dateKey] += invoiceTotal;
//     }

//     const salesTrend = Object.entries(salesByDate)
//       .sort(([a], [b]) => a.localeCompare(b))
//       .map(([date, sales]) => ({ date, sales }));

//     const summary = {
//       totalSales,
//       totalProfit,
//       totalOrders: invoices.length,
//     };

//     return res.json({ summary, salesTrend });
//   } catch (error) {
//     console.error("Error generating report:", error);
//     res.status(500).json({ message: "Internal server error" });
//   }
// };


// exports.getProductStatsReport = async (req, res) => {
//   try {
//     const today = new Date();
//     const notSoldSince = daysAgo(NOT_SOLD_DAYS);

//     const expiredProducts = await Product.find({
//       expiryDate: { $lt: today },
//       deletedAt: null,
//     }).select("_id name stock expiryDate");

//     const lowStockProducts = await Product.find({
//       stock: { $lt: LOW_STOCK_THRESHOLD },
//       deletedAt: null,
//     }).select("_id name stock");

//     const notSoldProducts = await Product.find({
//       updatedAt: { $lt: notSoldSince },
//       deletedAt: null,
//     }).select("_id name stock updatedAt");

//     res.json({
//       expired: {
//         count: expiredProducts.length,
//         products: expiredProducts,
//       },
//       lowStock: {
//         count: lowStockProducts.length,
//         products: lowStockProducts,
//       },
//       notSoldRecently: {
//         since: NOT_SOLD_DAYS + " days ago",
//         count: notSoldProducts.length,
//         products: notSoldProducts,
//       },
//     });
//   } catch (error) {
//     console.error("Error fetching product stats:", error);
//     res.status(500).json({ error: "Internal Server Error" });
//   }
// };


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

