# AI Product Recommendation System - Analysis & Plan

## 📊 Current System Analysis

### Existing Node.js API Endpoints
Based on `ecommerceRoutes.js`, the following product-related endpoints are available:

1. **`GET /api/ecomm/products`** - Search & filter products
   - Supports: search, category, brand, price range, stock, sale filters
   - Returns paginated results

2. **`GET /api/ecomm/products/featured`** - Top sellers in stock (min 15)
   - Based on `ProductStats.totalUnitsSold`

3. **`GET /api/ecomm/products/trending`** - Recent top sellers
   - Based on recent sales velocity (last 14 days)

4. **`GET /api/ecomm/products/recommended`** - Category-based recommendations
   - Uses customer order history (90 days lookback)
   - Falls back to trending if no history

5. **`GET /api/ecomm/products/autocomplete`** - Search suggestions
   - Fuzzy match on name, brand, barcode

### Product Data Structure
```javascript
{
  _id: ObjectId,
  name: String,
  secondName: String,
  barcode: Number,
  categories: [ObjectId],
  stock: Number,
  mrp: Number,
  sellingPrice1: Number,
  brand: String,
  description: String,
  discountPercentage: Number,
  isOnSale: Boolean,
  hasImage: Boolean
}
```

### Available Data Sources
- **Products**: Full catalog with categories, prices, stock
- **Orders**: Customer purchase history with products
- **ProductStats**: Sales metrics (totalUnitsSold, onlineUnitsSold, posUnitsSold)
- **Categories**: Category hierarchy

---

## 🎯 AI Recommendation System Goals

### Primary Objectives
1. **Intelligent Recommendations**: Use AI embeddings to find similar products
2. **Smart Random Selection**: Weighted random products based on relevance
3. **Context-Aware Suggestions**: Recommendations based on search query, browsing history, or selected product
4. **Personalized Recommendations**: Leverage customer order history with ML

### AI Techniques to Implement
1. **Content-Based Filtering**
   - Product embeddings (name + description + category + brand)
   - Cosine similarity for product similarity
   - Price range matching

2. **Collaborative Filtering**
   - Customer-product matrix
   - "Customers who bought X also bought Y"

3. **Hybrid Approach**
   - Combine content-based + collaborative + popularity
   - Weight different signals

4. **Natural Language Processing**
   - Generate embeddings from product text
   - Semantic search capabilities

---

## 🏗️ Proposed Architecture

### Python FastAPI Service Structure
```
ai_service/
├── main.py                 # FastAPI app entry point
├── config.py              # Configuration & environment
├── database.py            # MongoDB connection
├── models/
│   ├── product.py         # Product data models
│   └── recommendation.py  # Recommendation request/response models
├── services/
│   ├── product_service.py      # Fetch products from API/MongoDB
│   ├── embedding_service.py    # Generate product embeddings
│   ├── recommendation_engine.py # Core AI recommendation logic
│   └── similarity_service.py    # Calculate product similarities
├── api/
│   └── routes.py          # FastAPI endpoints
└── requirements.txt
```

### API Endpoints to Create
1. **`POST /ai/recommendations`**
   - Input: `{ "productId": "xxx", "limit": 10 }`
   - Returns: Similar products using embeddings

2. **`POST /ai/recommendations/personalized`**
   - Input: `{ "customerId": "xxx", "limit": 10 }`
   - Returns: Personalized recommendations based on history

3. **`GET /ai/products/random`**
   - Query params: `category`, `priceRange`, `limit`
   - Returns: Intelligently weighted random products

4. **`POST /ai/products/suggest`**
   - Input: `{ "query": "chocolate", "limit": 10 }`
   - Returns: Semantic search results using embeddings

5. **`POST /ai/products/similar`**
   - Input: `{ "productId": "xxx", "limit": 10 }`
   - Returns: Most similar products

---

## 🔧 Implementation Plan

### Phase 1: Setup & Data Access
- [x] Create FastAPI structure
- [ ] Set up MongoDB connection
- [ ] Create product fetching service (from Node.js API or direct MongoDB)
- [ ] Set up environment configuration

### Phase 2: AI Engine
- [ ] Install ML libraries (sentence-transformers, scikit-learn, pandas)
- [ ] Create embedding service for products
- [ ] Build similarity calculation service
- [ ] Implement recommendation engine with multiple strategies

### Phase 3: API Endpoints
- [ ] Create recommendation endpoints
- [ ] Add random product selection with weights
- [ ] Implement semantic search
- [ ] Add caching for performance

### Phase 4: Optimization
- [ ] Pre-compute embeddings for all products
- [ ] Cache embeddings and similarity matrices
- [ ] Add real-time updates for new products
- [ ] Performance testing

---

## 📦 Required Python Packages

```txt
fastapi==0.116.1
uvicorn==0.35.0
pymongo==4.14.1
pydantic==2.11.7
sentence-transformers==2.3.1  # For product embeddings
scikit-learn==1.5.0            # For similarity calculations
pandas==2.3.2
numpy==2.3.2
python-dotenv==1.1.1
httpx==0.27.0                   # For calling Node.js API (optional)
```

---

## 🚀 Next Steps

1. **Create FastAPI application structure**
2. **Set up MongoDB connection** (using same DB as Node.js)
3. **Implement product data fetching**
4. **Build embedding service** using sentence-transformers
5. **Create recommendation engine**
6. **Expose API endpoints**
7. **Test with real product data**

---

## 🔗 Integration Points

### Option 1: Direct MongoDB Access (Recommended)
- Connect Python service directly to MongoDB
- Fastest data access
- Real-time updates

### Option 2: Node.js API Calls
- Call `/api/ecomm/products` endpoints
- Simpler but adds latency
- Good for microservices separation

**Recommendation**: Use Option 1 (Direct MongoDB) for better performance in AI workloads.

