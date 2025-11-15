# Environment Setup Guide

## Quick Setup

1. **Copy the example file:**
   ```bash
   cp .env.example .env
   ```

2. **Edit `.env` with your actual values:**
   ```bash
   # Open in your editor
   nano .env
   # or
   code .env
   ```

## Required Configuration

### MongoDB Connection

The most important configuration is your MongoDB connection. You have two options:

#### Option 1: Database name in URI
```env
MONGODB_URI=mongodb://localhost:27017/your_database_name
```

#### Option 2: Separate database name
```env
MONGODB_URI=mongodb://localhost:27017
DB_NAME=your_database_name
```

### Example Configurations

#### Local Development
```env
MONGODB_URI=mongodb://localhost:27017
DB_NAME=localDB
AI_SERVICE_PORT=8000
```

#### Production (MongoDB Atlas)
```env
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/database_name
AI_SERVICE_PORT=8000
ENVIRONMENT=production
DEBUG=false
```

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MONGODB_URI` | Yes | `mongodb://localhost:27017` | MongoDB connection URI |
| `DB_NAME` | Optional* | `localDB` | Database name (*required if not in URI) |
| `LOCAL_MONGO_URI` | No | Same as MONGODB_URI | Fallback MongoDB URI |
| `LOCAL_DB_NAME` | No | Same as DB_NAME | Fallback database name |
| `NODE_API_URL` | No | `http://localhost:3000` | Node.js API URL (optional) |
| `EMBEDDING_MODEL` | No | `sentence-transformers/all-MiniLM-L6-v2` | AI embedding model |
| `SIMILARITY_THRESHOLD` | No | `0.3` | Minimum similarity score (0.0-1.0) |
| `AI_SERVICE_HOST` | No | `0.0.0.0` | Service host |
| `AI_SERVICE_PORT` | No | `8000` | Service port |
| `CACHE_TTL` | No | `3600` | Cache TTL in seconds |
| `ENVIRONMENT` | No | `development` | Environment mode |
| `DEBUG` | No | `true` | Enable debug logging |

## Notes

- The `.env` file is gitignored, so it won't be committed to version control
- Use `.env.example` as a template
- The service will load `.env` from `ai_service/.env` first, then from parent directory
- All values are optional and have defaults, but MongoDB connection is required

