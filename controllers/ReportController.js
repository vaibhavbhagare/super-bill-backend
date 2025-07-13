const Invoice = require('../models/Invoice');
const Product = require('../models/Product');

exports.getReport = async (req, res) => {
    console.log("called")
  try {
    const { customerId, billerId, startDate, endDate } = req.query;
    const match = {};

    if (customerId) match['customer'] = customerId;
    if (billerId) match['billerId'] = billerId;
    if (startDate || endDate) {
      match['createdAt'] = {};
      if (startDate) match['createdAt'].$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        match['createdAt'].$lte = end;
      }
    }

    // 1. Summary
    const summaryAgg = await Invoice.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalSales: { $sum: '$billingSummary.total' },
          totalProfit: { $sum: { $subtract: ['$billingSummary.total', '$billingSummary.subtotal'] } },
          totalOrders: { $sum: 1 }
        }
      }
    ]);
    const summary = summaryAgg[0] || { totalSales: 0, totalProfit: 0, totalOrders: 0 };

    // 2. Sales Trend (by day)
    const salesTrend = await Invoice.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          sales: { $sum: "$billingSummary.total" }
        }
      },
      { $sort: { "_id": 1 } }
    ]).then(res => res.map(r => ({ date: r._id, sales: r.sales })));

    // 3. Category Sales
    const categorySales = await Invoice.aggregate([
      { $match: match },
      { $unwind: "$buyingProducts" },
      {
        $lookup: {
          from: "products",
          localField: "buyingProducts.product",
          foreignField: "_id",
          as: "productInfo"
        }
      },
      { $unwind: "$productInfo" },
      {
        $group: {
          _id: "$productInfo.category",
          sales: { $sum: "$buyingProducts.price" }
        }
      }
    ]).then(res => res.map(r => ({ category: r._id, sales: r.sales })));

    // 4. Low Stock
    const lowStock = await Product.find({ stock: { $lte: 5 } }, { name: 1, stock: 1 });

    res.json({
      summary,
      salesTrend,
      categorySales,
      lowStock: lowStock.map(p => ({ product: p.name, stock: p.stock }))
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};