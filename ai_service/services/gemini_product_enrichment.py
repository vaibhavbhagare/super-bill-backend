"""Gemini + MongoDB product field enrichment (name, secondName, searchKey, description, secondaryDescription)."""
import json
import logging
import re
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import google.generativeai as genai
from bson import ObjectId
from bson.errors import InvalidId
from pymongo import ReturnDocument

from config import config
from database import Database

logger = logging.getLogger(__name__)

BATCH_SIZE = 10
DEFAULT_QUEUE_CAP = 2000
RATE_LIMIT_SLEEP_S = 5
ERROR_BACKOFF_S = 10


def _strip_json_fence(text: str) -> str:
    t = text.strip()
    t = re.sub(r"^```(?:json)?\s*", "", t, flags=re.IGNORECASE)
    t = re.sub(r"\s*```\s*$", "", t)
    return t.strip()


def _configure_gemini() -> None:
    key = (getattr(config, "GEMINI_API_KEY", None) or "").strip()
    if not key:
        raise ValueError("GEMINI_API_KEY is not set. Add it to your .env file.")
    genai.configure(api_key=key)


def _build_prompt_inputs_from_products(batch: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    One object per product: always `name` (English preferred, else Marathi as fallback label).
    Optional `existingSecondName` / `existingSearchKey` when present in DB (not duplicated as hints).
    """
    items: List[Dict[str, Any]] = []
    for p in batch:
        name_en = (p.get("name") or "").strip()
        sec = str(p.get("secondName") or "").strip()
        name = name_en or sec
        item: Dict[str, Any] = {"name": name}
        if sec and name_en:
            item["existingSecondName"] = sec
        sk_raw = p.get("searchKey")
        sk = str(sk_raw).strip() if sk_raw is not None else ""
        if sk:
            item["existingSearchKey"] = sk
        items.append(item)
    return items


def _prompt_for_product_batch(input_items: List[Dict[str, Any]]) -> str:
    """Retail metadata prompt; model must return a JSON array (one object per input row, same order)."""
    payload = json.dumps(input_items, ensure_ascii=False)
    return f"""Act as a Retail Data Specialist for an Indian Supermarket.
Your goal is to optimize product metadata for both a physical POS system and an E-commerce web app.

Input products from our database (in order — produce one result per entry, same order).
Each object includes:
- "name" (required): primary product name from the system. Use this as the default source when other fields are missing.
- "existingSecondName" (optional): current Marathi name in DB if any — refine it for natural local wording; align with the corrected English "name".
- "existingSearchKey" (optional): current search keywords in DB if any — keep useful tokens, add English + Hinglish, reach 5-7 keywords total.

When "existingSecondName" or "existingSearchKey" are absent, infer "secondName" and "searchKey" only from "name".

{payload}

Tasks (for EACH input object above):
1. 'name': Correct the English name. Capitalize properly. Include Brand, Product, and Weight/Size (e.g., "Tata Tea Gold 500g").
2. 'secondName': Provide the name in Marathi script. Ensure it sounds natural for a local customer (e.g., "टाटा टी गोल्ड ५०० ग्रॅम").
3. 'searchKey': Generate 5-7 comma-separated keywords in English and Hinglish (e.g., "tea, chai, tata tea, bhukri, morning tea").
4. 'description': Write a 2-sentence English description. Focus on quality, usage, and shelf-life or taste. Use a professional e-commerce tone.
5. 'secondaryDescription': Write the same description in Marathi. Ensure it is persuasive for local shoppers.

Output requirement:
Return ONLY a valid JSON array. Length must equal the number of input objects. Each element must be exactly this shape (same keys as a single product):
{{"name": "", "secondName": "", "searchKey": "", "description": "", "secondaryDescription": ""}}

Do not include markdown, explanations, or any text outside the JSON array."""


def _parse_gemini_json(raw_text: str) -> List[Dict[str, Any]]:
    cleaned = _strip_json_fence(raw_text)
    data = json.loads(cleaned)
    if not isinstance(data, list):
        raise ValueError("Gemini response is not a JSON array")
    return data


def _json_safe(value: Any) -> Any:
    """Make MongoDB documents JSON-serializable (ObjectId, dates, nested lists)."""
    if value is None:
        return None
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    try:
        from bson import Decimal128

        if isinstance(value, Decimal128):
            return float(value.to_decimal())
    except ImportError:
        pass
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_json_safe(v) for v in value]
    return value


def run_gemini_enrichment(
    *,
    limit: Optional[int] = None,
    product_id: Optional[str] = None,
    force: bool = False,
    collection_name: str = "products",
) -> Dict[str, Any]:
    """
    Fetch products, call Gemini in batches of up to 10, update MongoDB.

    - No productId: documents with generateContentFromAI != true, capped by limit
      (default cap 2000 per call, same spirit as your script).
    - productId: single document by _id; respects generateContentFromAI unless force=True.
    """
    errors: List[str] = []
    products_updated = 0
    batches_run = 0
    updated_products: List[Dict[str, Any]] = []

    db = Database.get_db()
    coll = db[collection_name]

    if product_id:
        try:
            oid = ObjectId(product_id)
        except InvalidId as e:
            raise ValueError(f"Invalid productId: {e}") from e

        doc = coll.find_one({"_id": oid})
        if not doc:
            raise ValueError("Product not found")

        if doc.get("generateContentFromAI") is True and not force:
            return {
                "productsSelected": 1,
                "productsUpdated": 0,
                "batchesRun": 0,
                "errors": ["Product already has generateContentFromAI=true; pass force=true to re-run."],
                "updatedProducts": [],
            }

        products: List[Dict[str, Any]] = [doc]
    else:
        cap = limit if limit is not None else DEFAULT_QUEUE_CAP
        query = {"generateContentFromAI": {"$ne": True}}
        cursor = coll.find(query).limit(cap)
        products = list(cursor)

    if not products:
        return {
            "productsSelected": 0,
            "productsUpdated": 0,
            "batchesRun": 0,
            "errors": [],
            "updatedProducts": [],
        }

    _configure_gemini()
    model_id = config.GEMINI_MODEL.strip()
    if model_id.startswith("models/"):
        model_id = model_id[len("models/") :]
    model = genai.GenerativeModel(model_id)

    for i in range(0, len(products), BATCH_SIZE):
        batch = products[i : i + BATCH_SIZE]
        input_items = _build_prompt_inputs_from_products(batch)
        prompt = _prompt_for_product_batch(input_items)

        try:
            response = model.generate_content(prompt)
            raw = getattr(response, "text", None)
            if not raw:
                msg = "Empty Gemini response (blocked or no text)"
                errors.append(f"Batch starting {i}: {msg}")
                logger.warning(msg)
                time.sleep(ERROR_BACKOFF_S)
                continue

            ai_results = _parse_gemini_json(raw)
            if len(ai_results) != len(batch):
                msg = (
                    f"Expected {len(batch)} JSON objects, got {len(ai_results)}; skipping batch"
                )
                errors.append(msg)
                logger.warning(msg)
                time.sleep(ERROR_BACKOFF_S)
                continue

            for index, data in enumerate(ai_results):
                pid = batch[index]["_id"]
                update_fields = {
                    "name": data.get("name"),
                    "secondName": data.get("secondName"),
                    "searchKey": data.get("searchKey"),
                    "description": data.get("description"),
                    "secondaryDescription": data.get("secondaryDescription"),
                    "generateContentFromAI": True,
                    "updatedAt": datetime.now(timezone.utc),
                }
                doc_after = coll.find_one_and_update(
                    {"_id": pid},
                    {"$set": update_fields},
                    return_document=ReturnDocument.AFTER,
                )
                if doc_after:
                    updated_products.append(_json_safe(doc_after))
                    products_updated += 1

            batches_run += 1
            logger.info("Updated Gemini batch %s", batches_run)
            time.sleep(RATE_LIMIT_SLEEP_S)

        except Exception as e:
            err = f"Batch starting at index {i}: {e}"
            errors.append(err)
            logger.exception(err)
            time.sleep(ERROR_BACKOFF_S)

    return {
        "productsSelected": len(products),
        "productsUpdated": products_updated,
        "batchesRun": batches_run,
        "errors": errors,
        "updatedProducts": updated_products,
    }
