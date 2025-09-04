const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const bodyParser = require("body-parser");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const userRoutes = require("./routes/userRoutes");
const customerRoutes = require("./routes/customerRoutes");
const productRoutes = require("./routes/productRoutes");
const syncRoutes = require("./routes/syncRoutes");
const invoiceRoutes = require("./routes/invoiceRoutes");
const storeRoutes = require("./routes/storeRouter");
const reportRoutes = require("./routes/reportRoutes");
const attendanceRoutes = require("./routes/attendanceRoutes");
const salaryRoutes = require("./routes/salaryRoutes");
const imageUpload = require("./routes/imageUpload");
const ecommerceRoutes = require("./routes/ecommerceRoutes");

// const { requestLogger, errorLogger, performanceLogger } = require("./middleware/logger");

dotenv.config();

const app = express();

// Security middleware
app.use(helmet()); // Set security HTTP headers
app.use(cookieParser()); // Parse cookies

// CORS: reflect only allowed origins and support credentials
const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:8081")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Accept",
    "Origin",
  ],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));

// Apply rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5000, // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Body parser
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Add logging middleware
// app.use(requestLogger);
// app.use(performanceLogger);

// Routes
// Basic health route (useful for Vercel cold starts and uptime checks)
app.get("/api/health", (req, res) => {
  res.status(200).json({ status: "ok", env: process.env.NODE_ENV || "unknown" });
});

app.use("/api/users", userRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/products", productRoutes);
app.use("/api/sync", syncRoutes);
app.use("/api/invoices", invoiceRoutes);
app.use("/api/stores", storeRoutes);

app.use("/api/reports", reportRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/salary", salaryRoutes);
app.use("/api/images", imageUpload);
app.use("/api/ecommerce", ecommerceRoutes);

// Error handling middleware
// app.use(errorLogger);

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: err.message || "Internal server error",
    code: err.code || "INTERNAL_ERROR",
  });
});

// Serve static images (only in development)
if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'local') {
  app.use("/images", express.static("images"));
}

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: "Not found",
    code: "NOT_FOUND",
  });
});

// Database connection
const isDev =
  process.env.NODE_ENV === "development" ||
  process.env.NODE_ENV === "local" ||
  process.env.NODE_ENV === "dev";
const mongoUri = isDev
  ? process.env.LOCAL_MONGO_URI
  : process.env.REMOTE_MONGO_URI;
// Avoid crashing the process if URI is missing on serverless boot
if (!mongoUri || typeof mongoUri !== "string" || mongoUri.trim().length === 0) {
  console.warn(
    "MongoDB URI is not set. Skipping DB connection. Set REMOTE_MONGO_URI (prod) or LOCAL_MONGO_URI (dev).",
  );
} else {
  // In serverless environments, reuse the connection across invocations if possible
  if (!global._mongooseConnection) {
    global._mongooseConnection = mongoose
      .connect(mongoUri, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      })
      .then(() => console.log(`Connected to MongoDB`))
      .catch((err) => {
        console.error("MongoDB connection error:", err);
      });
  }
}


// Start server locally; export app for serverless platforms (e.g., Vercel)
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}, env: ${process.env.NODE_ENV}`);
  });
}

module.exports = app;
