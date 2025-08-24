const fs = require('fs');
const path = require('path');

// Check if we're running on Vercel (serverless environment)
const isVercel = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';

// Create logs directory if it doesn't exist (only in development)
let logsDir;
if (!isVercel) {
  logsDir = path.join(__dirname, '../logs');
  if (!fs.existsSync(logsDir)) {
    try {
      fs.mkdirSync(logsDir);
    } catch (error) {
      console.warn('Could not create logs directory:', error.message);
    }
  }
}

// Function to get current date string for log files
const getDateString = () => {
  const now = new Date();
  return now.toISOString().split('T')[0]; // Returns YYYY-MM-DD format
};

// Function to get current time string
const getTimeString = () => {
  const now = new Date();
  return now.toISOString(); // Returns full ISO timestamp
};

// Function to get log file paths with date
const getLogFilePaths = () => {
  if (isVercel) return {};
  
  const dateString = getDateString();
  return {
    access: path.join(logsDir, `access-${dateString}.log`),
    error: path.join(logsDir, `error-${dateString}.log`),
    api: path.join(logsDir, `api-${dateString}.log`),
    performance: path.join(logsDir, `performance-${dateString}.log`),
    database: path.join(logsDir, `database-${dateString}.log`)
  };
};

// Helper function to write logs with rotation
const writeLog = (filePath, message) => {
  if (isVercel) {
    // On Vercel, just log to console
    console.log(`[${getTimeString()}] ${message}`);
    return;
  }
  
  try {
    const timestamp = getTimeString();
    const logEntry = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(filePath, logEntry);
  } catch (error) {
    console.error('Error writing to log file:', error.message);
  }
};

// Function to clean old log files (keep last 30 days)
const cleanOldLogs = () => {
  if (isVercel) return; // Skip on Vercel
  
  try {
    const files = fs.readdirSync(logsDir);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    files.forEach(file => {
      const filePath = path.join(logsDir, file);
      const stats = fs.statSync(filePath);
      
      if (stats.isFile() && stats.mtime < thirtyDaysAgo) {
        fs.unlinkSync(filePath);
        console.log(`🗑️  Cleaned old log file: ${file}`);
      }
    });
  } catch (error) {
    console.error('Error cleaning old logs:', error.message);
  }
};

// Clean old logs every day (only in development)
if (!isVercel) {
  setInterval(cleanOldLogs, 24 * 60 * 60 * 1000); // Run every 24 hours
}

// Request logging middleware
const requestLogger = (req, res, next) => {
  const start = Date.now();
  const timestamp = getTimeString();
  const logPaths = getLogFilePaths();
  
  // Log request
  const requestLog = `REQUEST: ${req.method} ${req.originalUrl} | IP: ${req.ip} | User-Agent: ${req.get('User-Agent')}`;
  writeLog(logPaths.access, requestLog);
  
  // Log request details for API calls
  if (req.originalUrl.startsWith('/api/')) {
    const apiLog = `API ${req.method} ${req.originalUrl} | Query: ${JSON.stringify(req.query)} | Body: ${JSON.stringify(req.body)} | Headers: ${JSON.stringify(req.headers)}`;
    writeLog(logPaths.api, apiLog);
  }
  
  // Override res.end to log response
  const originalEnd = res.end;
  res.end = function(chunk, encoding) {
    const duration = Date.now() - start;
    const responseLog = `RESPONSE: ${req.method} ${req.originalUrl} | Status: ${res.statusCode} | Duration: ${duration}ms`;
    writeLog(logPaths.access, responseLog);
    
    // Log API response details
    if (req.originalUrl.startsWith('/api/')) {
      const responseApiLog = `API RESPONSE: ${req.method} ${req.originalUrl} | Status: ${res.statusCode} | Duration: ${duration}ms | Size: ${chunk ? chunk.length : 0} bytes`;
      writeLog(logPaths.api, responseApiLog);
    }
    
    // Log performance data
    if (duration > 1000) {
      const performanceLog = `SLOW REQUEST: ${req.method} ${req.originalUrl} | Duration: ${duration}ms | Status: ${res.statusCode}`;
      writeLog(logPaths.performance, performanceLog);
    }
    
    originalEnd.call(this, chunk, encoding);
  };
  
  next();
};

// Error logging middleware
const errorLogger = (err, req, res, next) => {
  const timestamp = getTimeString();
  const logPaths = getLogFilePaths();
  
  const errorLog = `ERROR: ${req.method} ${req.originalUrl} | Status: ${err.status || 500} | Message: ${err.message} | Stack: ${err.stack}`;
  writeLog(logPaths.error, errorLog);
  
  // Also log to console for immediate visibility
  console.error(`🚨 [${timestamp}] ERROR:`, {
    method: req.method,
    url: req.originalUrl,
    status: err.status || 500,
    message: err.message,
    stack: err.stack
  });
  
  next(err);
};

// Performance monitoring middleware
const performanceLogger = (req, res, next) => {
  const start = Date.now();
  const logPaths = getLogFilePaths();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const performanceLog = `PERFORMANCE: ${req.method} ${req.originalUrl} | Status: ${res.statusCode} | Duration: ${duration}ms`;
    
    // Log all performance data
    writeLog(logPaths.performance, performanceLog);
    
    // Log slow requests to console
    if (duration > 1000) {
      writeLog(logPaths.performance, `⚠️  SLOW REQUEST: ${performanceLog}`);
      console.warn(`🐌 Slow request detected: ${req.method} ${req.originalUrl} took ${duration}ms`);
    }
    
    // Log very slow requests
    if (duration > 5000) {
      writeLog(logPaths.error, `🚨 VERY SLOW REQUEST: ${performanceLog}`);
      console.error(`🐌🐌 Very slow request: ${req.method} ${req.originalUrl} took ${duration}ms`);
    }
  });
  
  next();
};

// Database query logger
const databaseLogger = () => {
  try {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1) {
      const logPaths = getLogFilePaths();
      
      mongoose.set('debug', (collectionName, methodName, ...methodArgs) => {
        const dbLog = `DB QUERY: ${collectionName}.${methodName} | Args: ${JSON.stringify(methodArgs)}`;
        writeLog(logPaths.database, dbLog);
      });
    }
  } catch (error) {
    console.error('Error setting up database logger:', error.message);
  }
};

// Function to get log file info
const getLogFileInfo = () => {
  if (isVercel) return { environment: 'vercel', logging: 'console-only' };
  
  try {
    const logPaths = getLogFilePaths();
    const info = {};
    
    Object.keys(logPaths).forEach(type => {
      const filePath = logPaths[type];
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        info[type] = {
          path: filePath,
          size: stats.size,
          modified: stats.mtime,
          lines: fs.readFileSync(filePath, 'utf8').split('\n').length - 1
        };
      } else {
        info[type] = { path: filePath, exists: false };
      }
    });
    
    return info;
  } catch (error) {
    console.error('Error getting log file info:', error.message);
    return {};
  }
};

// Initialize database logger
databaseLogger();

module.exports = {
  requestLogger,
  errorLogger,
  performanceLogger,
  writeLog,
  getLogFilePaths,
  getLogFileInfo,
  getDateString,
  getTimeString
};
