const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
dotenv.config();
const bodyParser = require("body-parser");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

// Initialize Express
const app = express();

// 🛡️ Security middleware
app.use(helmet());
app.use(cookieParser());

// 🌐 CORS configuration
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "*",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// ⏱️ Apply rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5000, // max requests per IP
});
app.use(limiter);

// 🧾 Body parser
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 🗂️ Database connection setup
const isDev =
  process.env.NODE_ENV === "development" ||
  process.env.NODE_ENV === "local" ||
  process.env.NODE_ENV === "dev";

const mongoUri = isDev
  ? process.env.LOCAL_MONGO_URI || process.env.MONGODB_URI
  : process.env.MONGODB_URI || process.env.REMOTE_MONGO_URI;

// Disable command buffering to catch early DB errors
mongoose.set("bufferCommands", false);

// 🚀 Start the server after DB connection
const startServer = async () => {
  try {
    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000,
    });

    console.log(`✅ Connected to MongoDB: ${mongoUri}`);

    // ✅ Import routes *after* DB connection is ready
    const userRoutes = require("./routes/userRoutes");
    const customerRoutes = require("./routes/customerRoutes");
    const productRoutes = require("./routes/productRoutes");
    const syncRoutes = require("./routes/syncRoutes");
    const invoiceRoutes = require("./routes/invoiceRoutes");
    const storeRoutes = require("./routes/storeRouter");
    const reportRoutes = require("./routes/reportRoutes");
    const attendanceRoutes = require("./routes/attendanceRoutes");
    const salaryRoutes = require("./routes/salaryRoutes");
    const ecommerceRoutes = require("./routes/ecommerceRoutes");
    const categoryRoutes = require("./routes/categoryRoutes");
    const expenseRoutes = require("./routes/expenseRoutes");

    // 🛒 Register routes
    app.use("/api/users", userRoutes);
    app.use("/api/customers", customerRoutes);
    app.use("/api/products", productRoutes);
    app.use("/api/expenses", expenseRoutes);
    app.use("/api/sync", syncRoutes);
    app.use("/api/invoices", invoiceRoutes);
    app.use("/api/stores", storeRoutes);
    app.use("/api/reports", reportRoutes);
    app.use("/api/attendance", attendanceRoutes);
    app.use("/api/salary", salaryRoutes);
    app.use("/api/ecomm", ecommerceRoutes);
    app.use("/api/categories", categoryRoutes);

    // 🖼️ Image upload route (dev/local only)
    const isLocalOrDev = ["development", "local", "dev"].includes(process.env.NODE_ENV);
    if (isLocalOrDev) {
      const imageUpload = require("./routes/imageUpload");
      app.use("/api/images", imageUpload);
    }

    // 🖼️ Serve static images in dev
    if (isLocalOrDev) {
      app.use("/images", express.static("images"));
    }

    // ❌ 404 handler
    app.use((req, res) => {
      res.status(404).json({
        error: "Not found",
        code: "NOT_FOUND",
      });
    });

    // ⚠️ Error handling middleware
    app.use((err, req, res, next) => {
      console.error(err.stack);
      res.status(err.status || 500).json({
        error: err.message || "Internal server error",
        code: err.code || "INTERNAL_ERROR",
      });
    });

    // 🧠 Start listening
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log(`🚀 Server is running on port ${PORT}, env: ${process.env.NODE_ENV}`);
    });
  } catch (err) {
    console.error("❌ MongoDB connection error:", err.message);
    process.exit(1); // Stop app if DB fails
  }
};

// Run startup
startServer();
