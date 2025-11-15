"""FastAPI application entry point."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import logging
import uvicorn

from config import config
from database import Database
from api.routes import router

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="AI Product Recommendation Service",
    description="AI-powered product recommendations using embeddings and ML",
    version="1.0.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure based on your needs
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(router)

@app.on_event("startup")
async def startup_event():
    """Initialize services on startup."""
    try:
        # Connect to database
        Database.connect()
        logger.info("✅ AI Recommendation Service started successfully")
    except Exception as e:
        logger.error(f"❌ Startup error: {e}")
        raise

@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown."""
    Database.disconnect()
    logger.info("Service shutdown complete")

@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "message": "AI Product Recommendation Service",
        "version": "1.0.0",
        "endpoints": {
            "recommendations": "/ai/recommendations",
            "personalized": "/ai/recommendations/personalized",
            "random": "/ai/products/random",
            "suggest": "/ai/products/suggest",
            "similar": "/ai/products/similar",
            "health": "/ai/health"
        }
    }

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=config.HOST,
        port=config.PORT,
        reload=True,
        log_level="info"
    )

