"""AI-powered recommendation engine."""
from typing import List, Dict, Optional
import numpy as np
import random
from collections import Counter
import logging

from services.product_service import ProductService
from services.embedding_service import EmbeddingService

logger = logging.getLogger(__name__)

class RecommendationEngine:
    """Main recommendation engine using AI and ML techniques."""
    
    def __init__(self):
        self.product_service = ProductService()
        self.embedding_service = EmbeddingService()
    
    def recommend_similar_products(
        self,
        product_id: str,
        limit: int = 10,
        exclude_ids: Optional[List[str]] = None
    ) -> List[Dict]:
        """Recommend products similar to a given product using embeddings."""
        try:
            # Get the source product
            source_product = self.product_service.get_product_by_id(product_id)
            if not source_product:
                return []
            
            # Get embedding for source product
            source_embedding = self.embedding_service.get_product_embedding(source_product)
            
            # Get candidate products (active, in stock)
            candidates = self.product_service.get_active_products_in_stock(limit=500)
            
            # Filter out excluded products
            if exclude_ids:
                exclude_ids_set = set(exclude_ids)
                candidates = [p for p in candidates if str(p["_id"]) not in exclude_ids_set]
            
            # Remove source product from candidates
            candidates = [p for p in candidates if str(p["_id"]) != product_id]
            
            if not candidates:
                return []
            
            # Generate embeddings for all candidates
            product_embeddings = {}
            for candidate in candidates:
                candidate_id = str(candidate["_id"])
                embedding = self.embedding_service.get_product_embedding(candidate)
                product_embeddings[candidate_id] = embedding
            
            # Find similar products
            similar_products = self.embedding_service.find_similar_products(
                source_embedding,
                product_embeddings,
                limit=limit
            )
            
            # Build result list
            results = []
            candidate_dict = {str(p["_id"]): p for p in candidates}
            
            for product_id, similarity_score in similar_products:
                if product_id in candidate_dict:
                    product = candidate_dict[product_id]
                    # Enrich product with recommendation metadata
                    enriched_product = self._enrich_product(product)
                    enriched_product["similarity_score"] = round(similarity_score, 4)
                    enriched_product["recommendation_reason"] = "Similar product based on AI analysis"
                    results.append(enriched_product)
            
            return results
            
        except Exception as e:
            logger.error(f"Error in recommend_similar_products: {e}")
            return []
    
    def recommend_personalized(
        self,
        customer_id: str,
        limit: int = 10,
        lookback_days: int = 90
    ) -> List[Dict]:
        """Personalized recommendations based on customer order history."""
        try:
            # Get customer's recent orders
            orders = self.product_service.get_customer_orders(customer_id, limit=50)
            
            if not orders:
                # No history - return trending/popular products
                return self._get_fallback_recommendations(limit)
            
            # Extract purchased product IDs and categories
            purchased_product_ids = set()
            category_scores = Counter()
            
            for order in orders:
                for item in order.get("items", []):
                    product_id = item.get("product")
                    if product_id:
                        if isinstance(product_id, dict):
                            product_id = product_id.get("_id") or product_id.get("$oid")
                        purchased_product_ids.add(str(product_id))
                        
                        # Get product details to extract categories
                        product = self.product_service.get_product_by_id(str(product_id))
                        if product and product.get("categories"):
                            quantity = item.get("quantity", 1)
                            for cat_id in product["categories"]:
                                category_scores[str(cat_id)] += quantity
            
            # Get top categories
            top_categories = [cat_id for cat_id, _ in category_scores.most_common(5)]
            
            # Get products from top categories (excluding already purchased)
            recommended = []
            seen_product_ids = set(purchased_product_ids)
            
            for cat_id in top_categories:
                if len(recommended) >= limit:
                    break
                
                cat_products = self.product_service.get_products_by_category(
                    cat_id,
                    limit=limit * 2
                )
                
                for product in cat_products:
                    product_id = str(product["_id"])
                    if product_id not in seen_product_ids:
                        enriched = self._enrich_product(product)
                        enriched["recommendation_reason"] = f"Based on your purchase history in this category"
                        recommended.append(enriched)
                        seen_product_ids.add(product_id)
                        
                        if len(recommended) >= limit:
                            break
            
            # If we need more, add AI-based recommendations from purchased products
            if len(recommended) < limit and purchased_product_ids:
                # Use first purchased product for similarity
                first_product_id = list(purchased_product_ids)[0]
                similar = self.recommend_similar_products(
                    first_product_id,
                    limit=limit - len(recommended),
                    exclude_ids=list(seen_product_ids)
                )
                recommended.extend(similar)
            
            # Final fallback if still not enough
            if len(recommended) < limit:
                fallback = self._get_fallback_recommendations(
                    limit - len(recommended),
                    exclude_ids=list(seen_product_ids)
                )
                recommended.extend(fallback)
            
            return recommended[:limit]
            
        except Exception as e:
            logger.error(f"Error in recommend_personalized: {e}")
            return self._get_fallback_recommendations(limit)
    
    def get_random_products(
        self,
        limit: int = 10,
        category: Optional[str] = None,
        min_price: Optional[float] = None,
        max_price: Optional[float] = None,
        in_stock: bool = True
    ) -> List[Dict]:
        """Get intelligently weighted random products."""
        try:
            # Build filters
            filters = {}
            if category:
                from bson import ObjectId
                filters["categories"] = ObjectId(category)
            if min_price or max_price:
                price_filter = {}
                if min_price:
                    price_filter["$gte"] = min_price
                if max_price:
                    price_filter["$lte"] = max_price
                filters["sellingPrice1"] = price_filter
            if in_stock:
                filters["stock"] = {"$gt": 0}
            
            # Get candidates
            candidates = self.product_service.get_products(filters=filters, limit=1000)
            
            if not candidates:
                return []
            
            # Weight by popularity (using stats if available)
            weighted_products = []
            for product in candidates:
                weight = 1.0  # base weight
                
                # Increase weight for products with images
                if product.get("hasImage"):
                    weight *= 1.5
                
                # Increase weight for products on sale
                if product.get("isOnSale") or product.get("discountPercentage", 0) > 0:
                    weight *= 1.3
                
                # Increase weight for higher stock (availability)
                stock = product.get("stock", 0)
                if stock > 10:
                    weight *= 1.2
                
                # Get product stats if available
                stats = self.product_service.get_product_stats(str(product["_id"]))
                if stats:
                    total_sold = stats.get("totalUnitsSold", 0)
                    if total_sold > 0:
                        weight *= (1 + min(total_sold / 100, 2.0))  # Cap at 3x
                
                weighted_products.append((product, weight))
            
            # Sample based on weights
            if len(weighted_products) <= limit:
                products = [p for p, _ in weighted_products]
            else:
                products = []
                weights = [w for _, w in weighted_products]
                total_weight = sum(weights)
                probabilities = [w / total_weight for w in weights]
                
                # Sample without replacement
                indices = list(range(len(weighted_products)))
                selected_indices = np.random.choice(
                    indices,
                    size=min(limit, len(indices)),
                    replace=False,
                    p=probabilities
                )
                
                products = [weighted_products[i][0] for i in selected_indices]
            
            # Enrich and return
            return [self._enrich_product(p) for p in products]
            
        except Exception as e:
            logger.error(f"Error in get_random_products: {e}")
            return []
    
    def suggest_products(
        self,
        query: str,
        limit: int = 10,
        category: Optional[str] = None
    ) -> List[Dict]:
        """Semantic search for products using query embeddings."""
        try:
            # Generate embedding for query
            model = self.embedding_service.get_model()
            query_embedding = model.encode(query, convert_to_numpy=True)
            
            # Get candidate products
            filters = {}
            if category:
                from bson import ObjectId
                filters["categories"] = ObjectId(category)
            
            candidates = self.product_service.get_products(filters=filters, limit=500)
            
            if not candidates:
                return []
            
            # Generate embeddings and find similar
            product_embeddings = {}
            for candidate in candidates:
                candidate_id = str(candidate["_id"])
                embedding = self.embedding_service.get_product_embedding(candidate)
                product_embeddings[candidate_id] = embedding
            
            similar_products = self.embedding_service.find_similar_products(
                query_embedding,
                product_embeddings,
                limit=limit,
                threshold=0.2  # Lower threshold for search
            )
            
            # Build results
            results = []
            candidate_dict = {str(p["_id"]): p for p in candidates}
            
            for product_id, similarity_score in similar_products:
                if product_id in candidate_dict:
                    product = candidate_dict[product_id]
                    enriched = self._enrich_product(product)
                    enriched["similarity_score"] = round(similarity_score, 4)
                    enriched["recommendation_reason"] = f"Matches search: '{query}'"
                    results.append(enriched)
            
            return results
            
        except Exception as e:
            logger.error(f"Error in suggest_products: {e}")
            return []
    
    def _enrich_product(self, product: Dict) -> Dict:
        """Enrich product with computed fields."""
        mrp = product.get("mrp", 0)
        selling_price = product.get("sellingPrice1", 0)
        
        # Calculate discount
        discount_percentage = product.get("discountPercentage", 0)
        if discount_percentage == 0 and mrp > 0:
            discount_percentage = round(((mrp - selling_price) / mrp) * 100)
        
        discount_amount = mrp - selling_price
        
        # Check if on sale
        is_on_sale = (
            product.get("isOnSale", False) or
            discount_percentage > 0 or
            mrp > selling_price
        )
        
        # Build description
        description = (
            product.get("description") or
            product.get("name") or
            product.get("secondName") or
            "Product description not available"
        )
        
        enriched = {
            **product,
            "discountPercentage": discount_percentage,
            "discountAmount": discount_amount,
            "isOnSale": is_on_sale,
            "description": description,
            "isActive": product.get("isActive", True)
        }
        
        return enriched
    
    def _get_fallback_recommendations(
        self,
        limit: int,
        exclude_ids: Optional[List[str]] = None
    ) -> List[Dict]:
        """Fallback to trending/popular products."""
        filters = {}
        if exclude_ids:
            from bson import ObjectId
            filters["_id"] = {"$nin": [ObjectId(id) for id in exclude_ids]}
        
        products = self.product_service.get_products(
            filters=filters,
            limit=limit,
            sort={"updatedAt": -1}  # Most recent
        )
        
        return [self._enrich_product(p) for p in products]

