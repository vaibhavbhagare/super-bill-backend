"""Product data service - fetches products from MongoDB."""
from database import Database
from typing import List, Optional, Dict
from bson import ObjectId
import logging

logger = logging.getLogger(__name__)

class ProductService:
    """Service for fetching product data."""
    
    @staticmethod
    def get_product_by_id(product_id: str) -> Optional[Dict]:
        """Get a single product by ID."""
        try:
            db = Database.get_db()
            product = db.products.find_one({
                "_id": ObjectId(product_id),
                "$or": [
                    {"deletedAt": {"$exists": False}},
                    {"deletedAt": None}
                ]
            })
            
            if product:
                product["_id"] = str(product["_id"])
                if product.get("categories"):
                    product["categories"] = [str(cat) if isinstance(cat, ObjectId) else cat 
                                            for cat in product["categories"]]
            return product
        except Exception as e:
            logger.error(f"Error fetching product {product_id}: {e}")
            return None
    
    @staticmethod
    def get_products(
        filters: Optional[Dict] = None,
        limit: int = 100,
        skip: int = 0,
        sort: Optional[Dict] = None
    ) -> List[Dict]:
        """Get multiple products with filters."""
        try:
            db = Database.get_db()
            base_filter = {
                "$or": [
                    {"deletedAt": {"$exists": False}},
                    {"deletedAt": None}
                ],
                "isActive": True
            }
            
            if filters:
                base_filter.update(filters)
            
            query = db.products.find(base_filter)
            
            if sort:
                query = query.sort(list(sort.items()))
            
            products = query.skip(skip).limit(limit).to_list(length=limit)
            
            # Convert ObjectIds to strings
            for product in products:
                product["_id"] = str(product["_id"])
                if product.get("categories"):
                    product["categories"] = [
                        str(cat) if isinstance(cat, ObjectId) else cat 
                        for cat in product["categories"]
                    ]
            
            return products
        except Exception as e:
            logger.error(f"Error fetching products: {e}")
            return []
    
    @staticmethod
    def get_active_products_in_stock(limit: int = 1000) -> List[Dict]:
        """Get all active products in stock."""
        return ProductService.get_products(
            filters={"stock": {"$gt": 0}},
            limit=limit
        )
    
    @staticmethod
    def get_products_by_category(category_id: str, limit: int = 100) -> List[Dict]:
        """Get products by category."""
        return ProductService.get_products(
            filters={"categories": ObjectId(category_id)},
            limit=limit
        )
    
    @staticmethod
    def get_customer_orders(customer_id: str, limit: int = 50) -> List[Dict]:
        """Get customer's recent orders."""
        try:
            db = Database.get_db()
            orders = db.orders.find({
                "customer": ObjectId(customer_id),
                "$or": [
                    {"deletedAt": {"$exists": False}},
                    {"deletedAt": None}
                ]
            }).sort("createdAt", -1).limit(limit).to_list(length=limit)
            
            for order in orders:
                order["_id"] = str(order["_id"])
                if order.get("customer"):
                    order["customer"] = str(order["customer"])
            
            return orders
        except Exception as e:
            logger.error(f"Error fetching customer orders: {e}")
            return []
    
    @staticmethod
    def get_product_stats(product_id: str) -> Optional[Dict]:
        """Get product statistics."""
        try:
            db = Database.get_db()
            stats = db.productstats.find_one({"product": ObjectId(product_id)})
            if stats:
                stats["_id"] = str(stats["_id"])
                stats["product"] = str(stats["product"])
            return stats
        except Exception as e:
            logger.error(f"Error fetching product stats: {e}")
            return None

