"""Product data models."""
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

class ProductBase(BaseModel):
    """Base product model."""
    _id: str
    name: str
    secondName: Optional[str] = None
    barcode: Optional[int] = None
    categories: List[str] = []
    stock: int = 0
    mrp: float = 0.0
    sellingPrice1: float = 0.0
    brand: Optional[str] = None
    description: Optional[str] = None
    secondaryDescription: Optional[str] = None
    discountPercentage: float = 0.0
    isOnSale: bool = False
    hasImage: bool = False
    
class ProductResponse(ProductBase):
    """Product response model."""
    discountAmount: float = 0.0
    isActive: bool = True

class ProductRecommendation(BaseModel):
    """Product recommendation result."""
    product: ProductResponse
    similarity_score: Optional[float] = None
    recommendation_reason: Optional[str] = None

class RecommendationRequest(BaseModel):
    """Request model for recommendations."""
    productId: Optional[str] = None
    customerId: Optional[str] = None
    limit: int = 10
    category: Optional[str] = None
    excludeIds: Optional[List[str]] = None

class RandomProductRequest(BaseModel):
    """Request model for random products."""
    limit: int = 10
    category: Optional[str] = None
    minPrice: Optional[float] = None
    maxPrice: Optional[float] = None
    inStock: bool = True

class SuggestRequest(BaseModel):
    """Request model for product suggestions."""
    query: str
    limit: int = 10
    category: Optional[str] = None

