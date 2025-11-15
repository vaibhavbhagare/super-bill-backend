# AI Product Recommendation Service

AI-powered product recommendation system using Python, FastAPI, and sentence-transformers for intelligent product suggestions.

## 🚀 Features

- **AI-Powered Similarity**: Uses sentence-transformers embeddings to find similar products
- **Personalized Recommendations**: Based on customer purchase history
- **Semantic Search**: Natural language product search using embeddings
- **Intelligent Random Selection**: Weighted random products based on popularity, availability, and sales
- **Fast Performance**: Cached embeddings and optimized similarity calculations

## 📋 Requirements

- Python 3.9+
- MongoDB (same database as Node.js API)
- 2GB+ RAM (for embedding model)

## 🛠️ Setup

### 1. Activate Virtual Environment

```bash
cd ai_service
source venv/bin/activate  # On macOS/Linux
# or
venv\Scripts\activate  # On Windows
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

Note: The first run will download the embedding model (~90MB), which may take a few minutes.

### 3. Configure Environment

Copy the example environment file and edit it:

```bash
cp .env.example .env
```

Then edit `.env` with your actual MongoDB connection details:

```env
# MongoDB (REQUIRED - update with your actual values)
MONGODB_URI=mongodb://localhost:27017
DB_NAME=your_database_name

# AI Service (optional - defaults shown)
AI_SERVICE_HOST=0.0.0.0
AI_SERVICE_PORT=8000
EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2
```

**Note**: The `.env` file can be in `ai_service/.env` or parent directory `.env`. The service will check both locations.

### 4. Start the Service

```bash
python main.py
```

Or using uvicorn directly:

```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

The service will be available at: `http://localhost:8000`

## 📚 API Endpoints

### 1. Get Recommendations

**POST** `/ai/recommendations`

```json
{
  "productId": "product_id_here",  // Optional
  "customerId": "customer_id_here", // Optional
  "limit": 10,
  "excludeIds": ["id1", "id2"]  // Optional
}
```

**Response:**
```json
[
  {
    "product": {
      "_id": "...",
      "name": "Product Name",
      "sellingPrice1": 100.0,
      "similarity_score": 0.85,
      "recommendation_reason": "Similar product based on AI analysis"
    }
  }
]
```

### 2. Personalized Recommendations

**POST** `/ai/recommendations/personalized?customerId=xxx&limit=10&days=90`

Returns recommendations based on customer's purchase history.

### 3. Get Random Products

**GET** `/ai/products/random?limit=10&category=xxx&minPrice=100&maxPrice=500&inStock=true`

Returns intelligently weighted random products.

### 4. Suggest Products (Semantic Search)

**POST** `/ai/products/suggest`

```json
{
  "query": "chocolate cookies",
  "limit": 10,
  "category": "optional_category_id"
}
```

Semantic search using AI embeddings.

### 5. Get Similar Products

**POST** `/ai/products/similar?productId=xxx&limit=10`

Returns products similar to a given product using embeddings.

### 6. Health Check

**GET** `/ai/health`

## 🔗 Integration with Node.js API

You can integrate this service with your Node.js API in two ways:

### Option 1: Direct Integration (Recommended)
Call the Python service from Node.js controllers:

```javascript
const axios = require('axios');

async function getAIRecommendations(productId) {
  const response = await axios.post('http://localhost:8000/ai/recommendations', {
    productId,
    limit: 10
  });
  return response.data;
}
```

### Option 2: Proxy Route
Add a proxy route in `server.js`:

```javascript
const ecommerceAIRoutes = require("./routes/ecommerceAIRoutes");
app.use("/api/ecomm/ai", ecommerceAIRoutes);
```

## 🎯 Usage Examples

### Example 1: Get Similar Products
```bash
curl -X POST "http://localhost:8000/ai/products/similar?productId=YOUR_PRODUCT_ID&limit=10"
```

### Example 2: Personalized Recommendations
```bash
curl -X POST "http://localhost:8000/ai/recommendations/personalized?customerId=YOUR_CUSTOMER_ID&limit=15"
```

### Example 3: Semantic Search
```bash
curl -X POST "http://localhost:8000/ai/products/suggest" \
  -H "Content-Type: application/json" \
  -d '{"query": "healthy snacks", "limit": 10}'
```

## 🔧 Performance Optimization

- **Embedding Cache**: Product embeddings are cached in memory and can be persisted to disk
- **Batch Processing**: Multiple products are processed in batches for efficiency
- **Similarity Threshold**: Configurable similarity threshold to filter low-quality matches

## 📊 How It Works

1. **Product Embeddings**: Each product's text (name, description, brand) is converted to a vector using sentence-transformers
2. **Similarity Calculation**: Cosine similarity is used to find similar products
3. **Recommendation Strategy**:
   - **Content-Based**: Similar products based on embeddings
   - **Collaborative**: Based on customer purchase history
   - **Hybrid**: Combines multiple signals
4. **Random Selection**: Weighted by popularity, stock, sales stats, and discounts

## 🐛 Troubleshooting

### Model Download Issues
If the embedding model fails to download:
- Check internet connection
- Manually download from HuggingFace: https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2

### MongoDB Connection Issues
- Verify `MONGODB_URI` and `DB_NAME` in `.env`
- Ensure MongoDB is running
- Check network connectivity

### Memory Issues
- The embedding model requires ~500MB RAM
- Reduce batch size in `embedding_service.py` if needed

## 📝 Next Steps

1. **Pre-compute Embeddings**: Create a script to pre-compute all product embeddings
2. **Add More Features**: 
   - Price range filtering in recommendations
   - Category-based weighting
   - Seasonal recommendations
3. **Performance Monitoring**: Add logging and metrics
4. **A/B Testing**: Compare AI recommendations vs. rule-based

