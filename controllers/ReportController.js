const Invoice = require("../models/Invoice");

exports.getReport = async (req, res) => {
  try {
    let { customerId, billerId, startDate, endDate } = req.query;

    const today = new Date();
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    // Normalize start & end dates to cover the **entire** day range
    const start = startDate ? new Date(startDate) : firstDayOfMonth;
    start.setHours(0, 0, 0, 0); // 00:00:00.000 of the start day

    const end = endDate ? new Date(endDate) : today;
    end.setHours(23, 59, 59, 999); // 23:59:59.999 of the end day

    // Build filter object
    const filter = {
      createdAt: { $gte: start, $lte: end },
    };

    if (customerId) filter.customer = customerId;
    if (billerId) filter.billerId = billerId;

    const invoices = await Invoice.find(filter).populate(
      "buyingProducts.product"
    );

    let totalSales = 0;
    let totalProfit = 0;
    const salesByDate = {};

    for (const invoice of invoices) {
      for (const item of invoice.buyingProducts) {
        const sellingPrice = item.price;
        console.log("price", sellingPrice);
        const quantity = item.quantity;
        const subtotal = sellingPrice * quantity;

        const product = item.product;
        const purchasePrice = product?.purchasePrice || 0;
        console.log("purchasePrice", purchasePrice);
        const profit = (sellingPrice - purchasePrice) * quantity;
        console.log("profit", profit);
        totalSales += subtotal;
        totalProfit += profit;
      }

      const dateKey = invoice.createdAt.toISOString().split("T")[0];
      if (!salesByDate[dateKey]) salesByDate[dateKey] = 0;

      const invoiceTotal = invoice.billingSummary?.total || 0;
      salesByDate[dateKey] += invoiceTotal;
    }

    const salesTrend = Object.entries(salesByDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, sales]) => ({ date, sales }));

    const summary = {
      totalSales,
      totalProfit,
      totalOrders: invoices.length,
    };

    return res.json({ summary, salesTrend });
  } catch (error) {
    console.error("Error generating report:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};
