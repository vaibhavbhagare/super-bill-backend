/**
 * Reverse proxy to the Python FastAPI AI service (`AI_SERVICE_URL`, default http://127.0.0.1:8000).
 * Paths and JSON bodies match the Python API under `/ai/*` (same keys: camelCase as in Pydantic).
 *
 * Python routes mirrored:
 * - POST   /ai/recommendations              body: RecommendationRequest
 * - POST   /ai/recommendations/personalized query: customerId, limit?, days?
 * - GET    /ai/products/random              query: limit?, category?, minPrice?, maxPrice?, inStock?
 * - POST   /ai/products/suggest             body: SuggestRequest
 * - POST   /ai/products/similar           query: productId, limit?, excludeIds? (repeatable)
 * - GET    /ai/health
 * - POST   /ai/products/enrich/gemini     body: GeminiEnrichRequest
 * - POST   /ai/products/{id}/enrich/gemini query: force?
 */

function buildQueryString(query) {
  if (!query || typeof query !== "object") return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      value.forEach((v) => {
        if (v !== undefined && v !== null) params.append(key, String(v));
      });
    } else {
      params.append(key, String(value));
    }
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {string} method
 * @param {string} upstreamPath Path on Python host including /ai prefix, e.g. /ai/recommendations
 */
async function proxyAiRequest(req, res, method, upstreamPath) {
  try {
    const base = (process.env.AI_SERVICE_URL || "http://127.0.0.1:8000").replace(
      /\/$/,
      "",
    );
    const qs = buildQueryString(req.query);
    const url = `${base}${upstreamPath}${qs}`;

    const init = {
      method,
      headers: {},
    };

    if (method !== "GET" && method !== "HEAD") {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(req.body !== undefined ? req.body : {});
    }

    const r = await fetch(url, init);
    const ct = r.headers.get("content-type") || "";
    const buf = Buffer.from(await r.arrayBuffer());

    res.status(r.status);
    if (ct.includes("application/json")) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.send(buf);
    }
    if (ct) res.setHeader("Content-Type", ct);
    return res.send(buf);
  } catch (err) {
    console.error("proxyAiRequest:", upstreamPath, err);
    return res.status(503).json({
      detail: `AI service unreachable: ${err.message}`,
    });
  }
}

module.exports = {
  buildQueryString,
  proxyAiRequest,
};
