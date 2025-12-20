"""FastAPI routes for AI recommendation service."""
from fastapi import APIRouter, HTTPException, Query
from typing import Optional, List
import logging

from models.product import (
    ProductResponse,
    ProductRecommendation,
    RecommendationRequest,
    RandomProductRequest,
    SuggestRequest
)
from services.recommendation_engine import RecommendationEngine

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai", tags=["AI Recommendations"])
engine = RecommendationEngine()

@router.post("/recommendations", response_model=List[ProductRecommendation])
async def get_recommendations(request: RecommendationRequest):
    """
    Get AI-powered product recommendations.
    
    - If productId is provided: Returns similar products using embeddings
    - If customerId is provided: Returns personalized recommendations
    - If both provided: Uses productId for similarity
    """
    try:
        if request.productId:
            # Similar products based on product ID
            products = engine.recommend_similar_products(
                product_id=request.productId,
                limit=request.limit,
                exclude_ids=request.excludeIds
            )
        elif request.customerId:
            # Personalized recommendations
            products = engine.recommend_personalized(
                customer_id=request.customerId,
                limit=request.limit
            )
        else:
            # Fallback to random intelligent selection
            products = engine.get_random_products(limit=request.limit)
        
        # Convert to response format
        recommendations = []
        for product in products:
            recommendations.append(ProductRecommendation(
                product=ProductResponse(**product),
                similarity_score=product.get("similarity_score"),
                recommendation_reason=product.get("recommendation_reason")
            ))
        
        return recommendations
        
    except Exception as e:
        logger.error(f"Error in get_recommendations: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/recommendations/personalized", response_model=List[ProductRecommendation])
async def get_personalized_recommendations(
    customerId: str,
    limit: int = Query(10, ge=1, le=50),
    days: int = Query(90, ge=1, le=365)
):
    """Get personalized product recommendations based on customer history."""
    try:
        products = engine.recommend_personalized(
            customer_id=customerId,
            limit=limit,
            lookback_days=days
        )
        
        recommendations = []
        for product in products:
            recommendations.append(ProductRecommendation(
                product=ProductResponse(**product),
                similarity_score=product.get("similarity_score"),
                recommendation_reason=product.get("recommendation_reason")
            ))
        
        return recommendations
        
    except Exception as e:
        logger.error(f"Error in get_personalized_recommendations: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/products/random", response_model=List[ProductResponse])
async def get_random_products(
    limit: int = Query(10, ge=1, le=50),
    category: Optional[str] = None,
    minPrice: Optional[float] = None,
    maxPrice: Optional[float] = None,
    inStock: bool = True
):
    """Get intelligently weighted random products."""
    try:
        products = engine.get_random_products(
            limit=limit,
            category=category,
            min_price=minPrice,
            max_price=maxPrice,
            in_stock=inStock
        )
        
        return [ProductResponse(**p) for p in products]
        
    except Exception as e:
        logger.error(f"Error in get_random_products: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/products/suggest", response_model=List[ProductRecommendation])
async def suggest_products(request: SuggestRequest):
    """Semantic search for products using AI embeddings."""
    try:
        products = engine.suggest_products(
            query=request.query,
            limit=request.limit,
            category=request.category
        )
        
        recommendations = []
        for product in products:
            recommendations.append(ProductRecommendation(
                product=ProductResponse(**product),
                similarity_score=product.get("similarity_score"),
                recommendation_reason=product.get("recommendation_reason")
            ))
        
        return recommendations
        
    except Exception as e:
        logger.error(f"Error in suggest_products: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/products/similar", response_model=List[ProductRecommendation])
async def get_similar_products(
    productId: str,
    limit: int = Query(10, ge=1, le=50),
    excludeIds: Optional[List[str]] = None
):
    """Get products similar to a given product using AI embeddings."""
    try:
        products = engine.recommend_similar_products(
            product_id=productId,
            limit=limit,
            exclude_ids=excludeIds
        )
        
        recommendations = []
        for product in products:
            recommendations.append(ProductRecommendation(
                product=ProductResponse(**product),
                similarity_score=product.get("similarity_score"),
                recommendation_reason=product.get("recommendation_reason")
            ))
        
        return recommendations
        
    except Exception as e:
        logger.error(f"Error in get_similar_products: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "AI Recommendation Service",
        "model": "sentence-transformers/all-MiniLM-L6-v2"
    }

