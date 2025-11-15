"""MongoDB database connection."""
from pymongo import MongoClient
from pymongo.errors import ConnectionFailure
from config import config
import logging

logger = logging.getLogger(__name__)

class Database:
    """Database connection manager."""
    
    _client = None
    _db = None
    
    @classmethod
    def connect(cls):
        """Connect to MongoDB."""
        try:
            if cls._client is None:
                # Extract DB name from URI if not in config
                uri = config.MONGODB_URI
                db_name = config.DB_NAME
                
                # Try to extract DB name from URI
                if "/" in uri:
                    parts = uri.split("/")
                    if len(parts) > 3:
                        potential_db = parts[-1].split("?")[0]
                        if potential_db and potential_db not in ["", "localhost:27017", "127.0.0.1:27017"]:
                            # Remove database name from URI if present
                            if potential_db not in ["admin", "local"]:
                                db_name = potential_db
                                uri = "/".join(parts[:-1])
                
                cls._client = MongoClient(
                    uri,
                    serverSelectionTimeoutMS=5000,
                    connectTimeoutMS=10000
                )
                # Test connection
                cls._client.admin.command('ping')
                cls._db = cls._client[db_name]
                logger.info(f"✅ Connected to MongoDB: {db_name}")
            return cls._db
        except ConnectionFailure as e:
            logger.error(f"❌ MongoDB connection error: {e}")
            raise
    
    @classmethod
    def get_db(cls):
        """Get database instance."""
        if cls._db is None:
            return cls.connect()
        return cls._db
    
    @classmethod
    def disconnect(cls):
        """Disconnect from MongoDB."""
        if cls._client:
            cls._client.close()
            cls._client = None
            cls._db = None
            logger.info("Disconnected from MongoDB")

# Note: Don't initialize connection here - let it be lazy-loaded

