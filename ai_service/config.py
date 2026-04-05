"""Configuration management for AI recommendation service."""
import os
from dotenv import load_dotenv
from pathlib import Path

# Load environment variables
# Try loading from ai_service/.env first, then parent directory
local_env = Path(__file__).parent / '.env'
parent_env = Path(__file__).parent.parent / '.env'

if local_env.exists():
    load_dotenv(local_env)
elif parent_env.exists():
    load_dotenv(parent_env)

class Config:
    """Application configuration."""
    
    # MongoDB Configuration
    MONGODB_URI = os.getenv("MONGODB_URI") or os.getenv("LOCAL_MONGO_URI") or "mongodb://localhost:27017"
    # Extract DB name from URI if not provided
    DB_NAME = os.getenv("DB_NAME") or os.getenv("LOCAL_DB_NAME") or "localDB"
    
    # If URI contains database name, extract it
    if "/" in MONGODB_URI and MONGODB_URI.split("/")[-1] and "?" not in MONGODB_URI.split("/")[-1]:
        # URI might have DB name at the end
        potential_db = MONGODB_URI.split("/")[-1].split("?")[0]
        if potential_db and potential_db != "localhost:27017":
            DB_NAME = potential_db
    
    # Node.js API Configuration (optional - for API-based access)
    NODE_API_URL = os.getenv("NODE_API_URL") or "http://localhost:3000"
    
    # Gemini (product enrichment — set GEMINI_API_KEY in .env)
    GEMINI_API_KEY = (os.getenv("GEMINI_API_KEY") or "").strip()
    # Use a current model id (gemini-1.5-flash returns 404 on v1beta for many keys/accounts).
    GEMINI_MODEL = os.getenv("GEMINI_MODEL") or "gemini-2.5-flash"

    # AI/ML Configuration
    EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL") or "sentence-transformers/all-MiniLM-L6-v2"
    SIMILARITY_THRESHOLD = float(os.getenv("SIMILARITY_THRESHOLD", "0.3"))
    
    # Cache Configuration
    CACHE_TTL = int(os.getenv("CACHE_TTL", "3600"))  # 1 hour
    EMBEDDING_CACHE_FILE = Path(__file__).parent / "data" / "product_embeddings.pkl"
    
    # Server Configuration
    HOST = os.getenv("AI_SERVICE_HOST", "0.0.0.0")
    PORT = int(os.getenv("AI_SERVICE_PORT", "8000"))
    
    # Data Directory
    DATA_DIR = Path(__file__).parent / "data"
    DATA_DIR.mkdir(exist_ok=True)

config = Config()

