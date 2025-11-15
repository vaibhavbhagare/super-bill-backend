"""Product embedding service using sentence transformers."""
from sentence_transformers import SentenceTransformer
from typing import List, Dict, Optional
import numpy as np
import pickle
from pathlib import Path
import logging
from config import config

logger = logging.getLogger(__name__)

class EmbeddingService:
    """Service for generating and managing product embeddings."""
    
    _model = None
    _embedding_cache = {}
    
    @classmethod
    def get_model(cls):
        """Get or initialize the embedding model."""
        if cls._model is None:
            try:
                logger.info(f"Loading embedding model: {config.EMBEDDING_MODEL}")
                cls._model = SentenceTransformer(config.EMBEDDING_MODEL)
                logger.info("✅ Embedding model loaded successfully")
            except Exception as e:
                logger.error(f"Error loading embedding model: {e}")
                raise
        return cls._model
    
    @classmethod
    def generate_product_text(cls, product: Dict) -> str:
        """Generate text representation of product for embedding."""
        parts = []
        
        if product.get("name"):
            parts.append(product["name"])
        if product.get("secondName"):
            parts.append(product["secondName"])
        if product.get("brand"):
            parts.append(f"brand: {product['brand']}")
        if product.get("description"):
            parts.append(product["description"])
        
        # Add category info if available
        if product.get("categories"):
            parts.append("category")
        
        return " ".join(parts)
    
    @classmethod
    def get_product_embedding(cls, product: Dict) -> np.ndarray:
        """Get embedding for a single product."""
        product_id = str(product.get("_id", ""))
        
        # Check cache
        if product_id in cls._embedding_cache:
            return cls._embedding_cache[product_id]
        
        # Generate text and embedding
        text = cls.generate_product_text(product)
        model = cls.get_model()
        embedding = model.encode(text, convert_to_numpy=True)
        
        # Cache it
        cls._embedding_cache[product_id] = embedding
        
        return embedding
    
    @classmethod
    def get_product_embeddings(cls, products: List[Dict]) -> np.ndarray:
        """Get embeddings for multiple products."""
        texts = [cls.generate_product_text(p) for p in products]
        model = cls.get_model()
        embeddings = model.encode(texts, convert_to_numpy=True, show_progress_bar=len(texts) > 50)
        return embeddings
    
    @classmethod
    def calculate_similarity(cls, embedding1: np.ndarray, embedding2: np.ndarray) -> float:
        """Calculate cosine similarity between two embeddings."""
        # Cosine similarity
        dot_product = np.dot(embedding1, embedding2)
        norm1 = np.linalg.norm(embedding1)
        norm2 = np.linalg.norm(embedding2)
        
        if norm1 == 0 or norm2 == 0:
            return 0.0
        
        return float(dot_product / (norm1 * norm2))
    
    @classmethod
    def find_similar_products(
        cls,
        query_embedding: np.ndarray,
        product_embeddings: Dict[str, np.ndarray],
        limit: int = 10,
        threshold: Optional[float] = None
    ) -> List[tuple]:
        """Find products similar to query embedding."""
        similarities = []
        
        threshold = threshold or config.SIMILARITY_THRESHOLD
        
        for product_id, product_embedding in product_embeddings.items():
            similarity = cls.calculate_similarity(query_embedding, product_embedding)
            if similarity >= threshold:
                similarities.append((product_id, similarity))
        
        # Sort by similarity (descending)
        similarities.sort(key=lambda x: x[1], reverse=True)
        
        return similarities[:limit]
    
    @classmethod
    def load_embeddings_cache(cls, cache_file: Optional[Path] = None):
        """Load embeddings from cache file."""
        cache_file = cache_file or config.EMBEDDING_CACHE_FILE
        if cache_file.exists():
            try:
                with open(cache_file, 'rb') as f:
                    cls._embedding_cache = pickle.load(f)
                logger.info(f"Loaded {len(cls._embedding_cache)} embeddings from cache")
            except Exception as e:
                logger.error(f"Error loading embeddings cache: {e}")
    
    @classmethod
    def save_embeddings_cache(cls, cache_file: Optional[Path] = None):
        """Save embeddings to cache file."""
        cache_file = cache_file or config.EMBEDDING_CACHE_FILE
        try:
            cache_file.parent.mkdir(parents=True, exist_ok=True)
            with open(cache_file, 'wb') as f:
                pickle.dump(cls._embedding_cache, f)
            logger.info(f"Saved {len(cls._embedding_cache)} embeddings to cache")
        except Exception as e:
            logger.error(f"Error saving embeddings cache: {e}")

