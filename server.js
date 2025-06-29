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

dotenv.config();

const app = express();

// Security middleware
app.use(helmet()); // Set security HTTP headers
app.use(cookieParser()); // Parse cookies

// CORS configuration
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "*",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Body parser
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Routes
app.use("/api/users", userRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/products", productRoutes);
app.use("/api/sync", syncRoutes);
// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: err.message || "Internal server error",
    code: err.code || "INTERNAL_ERROR",
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: "Not found",
    code: "NOT_FOUND",
  });
});

// Database connection
mongoose
  .connect(process.env.LOCAL_MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("Connected to local MongoDB: "))
  .catch((err) => console.error("MongoDB connection error:", err));

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
