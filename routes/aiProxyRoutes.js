const express = require("express");
const router = express.Router();
const { proxyAiRequest } = require("../controllers/aiProxyController");
const { auth } = require("../middleware/auth");

/** Public health (same response as Python GET /ai/health) */
router.get("/health", (req, res) => proxyAiRequest(req, res, "GET", "/ai/health"));

router.use(auth);

router.post("/recommendations", (req, res) =>
  proxyAiRequest(req, res, "POST", "/ai/recommendations"),
);

router.post("/recommendations/personalized", (req, res) =>
  proxyAiRequest(req, res, "POST", "/ai/recommendations/personalized"),
);

router.get("/products/random", (req, res) =>
  proxyAiRequest(req, res, "GET", "/ai/products/random"),
);

router.post("/products/suggest", (req, res) =>
  proxyAiRequest(req, res, "POST", "/ai/products/suggest"),
);

router.post("/products/similar", (req, res) =>
  proxyAiRequest(req, res, "POST", "/ai/products/similar"),
);

router.post("/products/enrich/gemini", (req, res) =>
  proxyAiRequest(req, res, "POST", "/ai/products/enrich/gemini"),
);

router.post("/products/:productId/enrich/gemini", (req, res) =>
  proxyAiRequest(
    req,
    res,
    "POST",
    `/ai/products/${encodeURIComponent(req.params.productId)}/enrich/gemini`,
  ),
);

module.exports = router;
