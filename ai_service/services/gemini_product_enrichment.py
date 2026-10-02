"""Gemini + MongoDB product field enrichment (name, secondName, searchKey, description, secondaryDescription)."""
import json
import logging
import re
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

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
CATEGORIES_COLLECTION = "categories"
# MongoDB product.categories is an array; Gemini may return several ids (cap for safety).
MAX_CATEGORY_IDS_PER_PRODUCT = 3
NOT_DELETED = {"$or": [{"deletedAt": None}, {"deletedAt": {"$exists": False}}]}


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


def _load_category_catalog(db: Any) -> Tuple[List[Dict[str, Any]], Set[str]]:
    """Active categories from MongoDB (not soft-deleted). Returns catalog rows + allowed id strings."""
    coll = db[CATEGORIES_COLLECTION]
    q = NOT_DELETED
    catalog: List[Dict[str, Any]] = []
    allowed: Set[str] = set()
    for doc in coll.find(q, projection={"name": 1, "secondaryName": 1}):
        sid = str(doc["_id"])
        allowed.add(sid)
        catalog.append(
            {
                "id": sid,
                "name": (doc.get("name") or "").strip(),
                "secondaryName": (doc.get("secondaryName") or "").strip() or None,
            }
        )
    return catalog, allowed


_WEIGHT_OR_UNIT_TOKEN = re.compile(
    r"^(?:"
    r"\d+(?:[./]\d+)?(?:gm|g|kg|ml|l|ltr|litre|liter|pcs|pc)?"
    r"|gm|g|kg|ml|l|ltr|litre|liter|pcs|pc|pack|pkt"
    r")$",
    re.IGNORECASE,
)


def _search_key_tokens(raw: Any) -> List[str]:
    """Split a searchKey string into trimmed tokens (comma / semicolon / pipe)."""
    if raw is None:
        return []
    s = str(raw).strip()
    if not s:
        return []
    return [p.strip() for p in re.split(r"[,;|]+", s) if p.strip()]


def _merge_search_key(*parts: Any) -> str:
    """Keep first occurrence of each token (case-insensitive) across parts, in given order."""
    seen: Set[str] = set()
    out: List[str] = []
    for part in parts:
        tokens = part if isinstance(part, list) else _search_key_tokens(part)
        for token in tokens:
            key = token.casefold()
            if key and key not in seen:
                seen.add(key)
                out.append(token)
    return ", ".join(out)


def _significant_name_tokens(name: Any) -> List[str]:
    """Brand / product words from a name, ignoring pack size and units."""
    if not name:
        return []
    parts = re.findall(r"[A-Za-z\u0900-\u097F]+|\d+[A-Za-z]*", str(name))
    return [p for p in parts if not _WEIGHT_OR_UNIT_TOKEN.match(p)]


def _choose_display_name(ai_name: Any, old_name: Any) -> str:
    """
    Allow formatting / extra words, but never drop original identity tokens.
    e.g. 'Dale 250gm' must keep 'Dale' — 'Chana Dal 250gm' is rejected.
    """
    old = str(old_name or "").strip()
    new = str(ai_name or "").strip()
    if not new:
        return old
    if not old:
        return new
    for token in _significant_name_tokens(old):
        if not re.search(
            rf"(?<![A-Za-z\u0900-\u097F]){re.escape(token)}(?![A-Za-z\u0900-\u097F])",
            new,
            flags=re.IGNORECASE,
        ):
            return old
    return new


def _parse_category_ids(value: Any, allowed: Set[str]) -> List[ObjectId]:
    """Keep only ids present in allowed; dedupe; preserve order; cap length."""
    if not value or not isinstance(value, list):
        return []
    out: List[ObjectId] = []
    seen: Set[str] = set()
    for x in value:
        if len(out) >= MAX_CATEGORY_IDS_PER_PRODUCT:
            break
        s = str(x).strip()
        if s in allowed and s not in seen:
            seen.add(s)
            out.append(ObjectId(s))
    return out


def _build_prompt_inputs_from_products(
    batch: List[Dict[str, Any]],
    catalog: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    """
    One object per product: always `name` / `existingName`.
    Optional secondName, searchKey, brand, description, unit, categories.
    """
    catalog_by_id = {c["id"]: c for c in (catalog or []) if c.get("id")}
    items: List[Dict[str, Any]] = []
    for p in batch:
        name_en = (p.get("name") or "").strip()
        sec = str(p.get("secondName") or "").strip()
        name = name_en or sec
        item: Dict[str, Any] = {"name": name, "existingName": name}
        if sec:
            item["existingSecondName"] = sec
        sk_raw = p.get("searchKey")
        sk = str(sk_raw).strip() if sk_raw is not None else ""
        if sk:
            item["existingSearchKey"] = sk
        brand = str(p.get("brand") or "").strip()
        if brand:
            item["brand"] = brand
        desc = str(p.get("description") or "").strip()
        if desc:
            item["description"] = desc
        unit = str(p.get("unit") or "").strip()
        if unit:
            item["unit"] = unit
        cat_ids: List[str] = []
        existing_cats: List[Dict[str, Any]] = []
        for c in p.get("categories") or []:
            if isinstance(c, ObjectId):
                cid = str(c)
            elif c is not None:
                cid = str(c).strip()
            else:
                continue
            if not cid:
                continue
            cat_ids.append(cid)
            row = catalog_by_id.get(cid)
            if row:
                existing_cats.append(
                    {
                        "id": cid,
                        "name": row.get("name") or "",
                        "secondaryName": row.get("secondaryName"),
                    }
                )
        if cat_ids:
            item["existingCategoryIds"] = cat_ids
        if existing_cats:
            item["existingCategories"] = existing_cats
        items.append(item)
    return items


def _prompt_for_product_batch(
    input_items: List[Dict[str, Any]],
    catalog: List[Dict[str, Any]],
) -> str:
    """Retail + Maharashtra search-optimization prompt; JSON array out, same order."""
    payload = json.dumps(input_items, ensure_ascii=False)
    if catalog:
        cat_json = json.dumps(catalog, ensure_ascii=False)
        category_catalog_block = f"""AUTHORIZED CATEGORIES (copy each "id" exactly into categoryIds — never invent ids):
{cat_json}"""
    else:
        category_catalog_block = (
            "AUTHORIZED CATEGORIES: none loaded — always use [] for categoryIds."
        )

    return f"""Act as a Retail Data Specialist and Product Search Optimization Specialist for an Indian supermarket and e-commerce product catalog.

Our SAME product database is shared by:

1. E-commerce website
2. Android shopping application
3. POS / billing application
4. Admin product management application

Therefore, all generated product information must work for both:
- Customer product discovery
- Fast product search in POS/billing/admin

Our customers are primarily from Maharashtra, India.

Customers may search using:
- Marathi (Devanagari)
- English
- Roman Marathi
- Marathi + English mixed typing
- Hinglish-style typing commonly used by Marathi customers
- Local pronunciation-based spellings
- Common Indian/Maharashtra retail terminology

IMPORTANT:
Use MARATHI for local-language interpretation.

DO NOT convert Marathi into Hindi.

==================================================
INPUT
==================================================

Input products from our database, in order.

Produce exactly one result per input object and preserve the same order.

Each object may include:

- "name" / "existingName" (required):
  Current shop/product name.
  Customers may already know and search this exact spelling.
  Preserve its identity.

- "existingSecondName" (optional):
  Current Marathi product name in DB.

- "existingSearchKey" (optional):
  Existing search keywords already used by the shop.

- "existingCategories" / "existingCategoryIds" (optional):
  Current categories with names/IDs.

- "brand" (optional)

- "description" (optional)

- "unit" (optional)

- Other product information may also be provided.

{payload}

==================================================
CORE PRODUCT IDENTIFICATION
==================================================

For EACH product, identify the REAL product FIRST.

Use all available information:

- existingName
- existingSecondName
- existingSearchKey
- brand
- category
- description
- unit
- other supplied product information

Understand Marathi/local/Roman Marathi terminology before interpreting
the product.

Do NOT guess from English dictionary meanings.

Examples:

"mug dal" → मुग डाळ / मूग डाळ / Moong Dal

"katri" → कात्री / Scissors

"tandul" → तांदूळ / Rice

"tangool" → तांदूळ / Rice

"jwari" → ज्वारी / Jowar

"gahu" → गहू / Wheat

"batata" → बटाटा / Potato

"kanda" → कांदा / Onion

"lasun" → लसूण / Garlic

If a local word could have multiple meanings and the available product
information does not clearly identify it, DO NOT invent a different product.

==================================================
NAME
==================================================

1. "name"

Keep the original shop/product words and identity.

Customers may search the original spelling, so do NOT unnecessarily replace
or rewrite the product name.

You may:

- Fix unnecessary spacing
- Capitalize English product names naturally
- Improve readability
- Preserve brand capitalization
- Preserve pack size
- Add a short English meaning in parentheses when useful

Example:

"mug dal 500gm"
→ "Mug Dal 500gm"

"Katri"
→ "Katri (Scissors)"

Do NOT use programming camelCase.

Correct:
"Mug Dal 500gm"

Incorrect:
"mugDal500gm"

IMPORTANT:

Do NOT change a local word into an unrelated English product.

Examples:

"Dale" ≠ "Dal"

"Katri" ≠ a food/snack

"Mug Dal" ≠ drinking mug

Local Marathi/Roman Marathi product names must be interpreted in the
Indian/Maharashtra grocery context first.

==================================================
SECOND NAME
==================================================

2. "secondName"

Create a natural Marathi-script name for the SAME product.

Use Marathi terminology used by customers in Maharashtra.

Do NOT translate through Hindi.

Examples:

"Mug Dal 500gm"
→ "मुग डाळ ५०० ग्रॅम"

"Tandul 5kg"
→ "तांदूळ ५ किलो"

"Kanda 1kg"
→ "कांदा १ किलो"

If existingSecondName is already correct and natural, preserve it.

Do not create an unrelated Marathi translation.

==================================================
SEARCH KEY — MOST IMPORTANT
==================================================

3. "searchKey"

Generate ONLY NEW additional search keywords.

DO NOT repeat the existing product name.

DO NOT repeat existingSearchKey values.

The application will combine:

existing product name
+
existingSearchKey
+
your newly generated searchKey

Therefore, your output searchKey must contain ONLY NEW useful search terms.

Existing searchKey values are trusted existing data.

NEVER remove, replace, rewrite, or correct existing searchKey values.

==================================================
SEARCH KEY OBJECTIVE
==================================================

Generate a universal product-search vocabulary for the SAME product.

The searchKey will be used by:

- E-commerce website search
- Android app search
- POS billing search
- Admin product search
- Autocomplete
- Fuzzy search
- Customer product discovery

Generate terms based on how a REAL Maharashtra customer may search.

Consider the following when relevant:

A. English product names
B. English synonyms
C. Marathi product names
D. Roman Marathi
E. Common local pronunciation
F. Marathi + English mixed searches
G. Brand name
H. Brand + product
I. Product + brand
J. Product + pack size
K. Marathi + pack size
L. English + pack size
M. Common Indian supermarket terminology
N. Realistic spelling variations
O. Singular/plural variations
P. Short customer search terms

Do NOT generate every category blindly.

Only generate terms that are genuinely relevant to the exact product.

==================================================
MARATHI LANGUAGE RULE — VERY IMPORTANT
==================================================

Our primary local language is MARATHI.

DO NOT use Hindi terminology when generating:

- secondName
- Marathi descriptions
- Marathi search keywords
- Roman Marathi search keywords

Use natural Marathi terminology used by customers in Maharashtra.

English equivalents ARE allowed because customers also search in English.

Example:

तांदूळ:
- tandul
- tandool
- tangul
- tangool
- rice

Do NOT prefer Hindi:
- chawal

Example:

साखर:
- sakhar
- saakhar
- sugar

Do NOT use Hindi:
- shakkar

Example:

हळद:
- halad
- halad powder
- turmeric

Do NOT use Hindi:
- haldi

Example:

कांदा:
- kanda
- onion

Do NOT use Hindi:
- pyaz

Example:

बटाटा:
- batata
- potato

Do NOT use Hindi:
- aloo

Example:

मुग डाळ:
- mug dal
- moog dal
- moong dal
- mung dal
- मुग डाळ
- मूग डाळ
- मुगाची डाळ

Do NOT intentionally generate Hindi equivalents.

==================================================
REGULAR MARATHI CUSTOMER TYPING
==================================================

Marathi customers often type Marathi using English/Roman letters.

They do NOT necessarily use standardized transliteration.

They may type according to local pronunciation.

Therefore, generate realistic Roman Marathi variations when useful.

Example:

Marathi:
"तांदूळ"

Possible customer searches:

tandul
tandool
tangul
tangool
tandul rice
rice
तांदूळ
तांदुळ
तांदुल

Example:

Marathi:
"मुग डाळ"

Possible searches:

mug dal
moog dal
moong dal
mung dal
mug daal
moog daal
moong daal
mugdaal
मुग डाळ
मूग डाळ
मुगाची डाळ

Example:

Marathi:
"ज्वारी"

Possible searches:

jwari
jowari
jowar
jwari bhakri
jowar flour
ज्वारी

Example:

Marathi:
"गहू"

Possible searches:

gahu
gahoo
wheat
gahu wheat
गहू

Example:

Marathi:
"साखर"

Possible searches:

sakhar
saakhar
sakkhar
sugar
sakhar sugar
साखर

Example:

Marathi:
"कोथिंबीर"

Possible searches:

kothimbir
kothmir
coriander
coriander leaves
कोथिंबीर

==================================================
ROMAN MARATHI VARIATION RULE
==================================================

Do not assume there is only one correct Roman spelling.

For important Marathi product words, consider realistic customer typing
variations caused by:

- Local pronunciation
- Missing vowels
- Double vowels
- Different vowel spellings
- Common consonant variations
- Phonetic typing
- English keyboard typing
- Local Maharashtra pronunciation

Examples:

तांदूळ:
tandul
tandool
tangul
tangool

मुग:
mug
moog
moong
mung

डाळ:
dal
daal

साखर:
sakhar
saakhar
sakkhar

लसूण:
lasun
lasoon

मिरची:
mirchi
mirch
mirchi powder

However:

DO NOT generate unlimited spelling combinations.

Only include realistic customer searches.

==================================================
ENGLISH EQUIVALENTS
==================================================

Include the commonly used English product equivalent when customers may
search using English.

Examples:

तांदूळ → rice

गहू → wheat

ज्वारी → jowar / sorghum

बटाटा → potato

कांदा → onion

लसूण → garlic

हळद → turmeric

मुग डाळ → moong dal

Use the English equivalent as an additional search term.

Do not replace the Marathi product identity with English.

==================================================
BRAND SEARCH
==================================================

If a brand exists, include useful combinations such as:

brand
brand + product
product + brand
brand + size

Example:

Wheel
Wheel powder
Wheel detergent
Wheel washing powder

Do NOT add competitor brands.

Do NOT invent brands.

==================================================
PACK SIZE / QUANTITY
==================================================

If the product has a known size or quantity, include realistic search formats.

Example for 500gm:

500gm
500 gm
500g
500 g
५०० ग्रॅम
५००g

Useful combinations may include:

moong dal 500g
moong dal 500gm
mug dal 500g
मुग डाळ ५०० ग्रॅम

Only use the actual product size.

NEVER invent another size.

==================================================
SPELLING VARIATIONS
==================================================

Generate only realistic spelling variations that customers may actually use.

Examples:

tandul
tandool
tangul
tangool

mug dal
moog dal
moong dal
mung dal

powder
pavdar

Do NOT generate hundreds of artificial spelling mistakes.

==================================================
SEARCH KEY QUANTITY
==================================================

Prefer HIGH RELEVANCE over HIGH QUANTITY.

Normally generate approximately 10-40 useful NEW search terms depending
on the complexity of the product.

Simple products may need fewer.

Products with multiple common names may need more.

Do NOT generate hundreds of keywords.

==================================================
DO NOT GENERATE MARKETING / SEO TERMS
==================================================

Do NOT generate generic marketing phrases such as:

best product
cheap product
best price
buy online
online shopping
online grocery
offer
discount
sale
near me
home delivery

These are NOT product identity/search keywords.

The searchKey should describe WHAT THE PRODUCT IS and HOW customers
naturally search for it.

==================================================
DO NOT INVENT PRODUCT INFORMATION
==================================================

Never invent:

- Brand
- Size
- Weight
- Ingredients
- Flavor
- Variant
- Product feature
- Product benefit
- Certification
- Medical claim
- Nutritional claim
- Competitor brand
- Unsupported usage

Use only information supported by the supplied product data.

==================================================
DESCRIPTION
==================================================

4. "description"

Create a concise 2-sentence English description of the IDENTIFIED product.

The description must describe the actual product.

Do not guess unsupported features, ingredients, benefits, or claims.

==================================================
SECONDARY DESCRIPTION
==================================================

5. "secondaryDescription"

Create the same description naturally in MARATHI.

Use simple, natural Marathi used in Maharashtra.

DO NOT translate into Hindi.

Do not perform an unnatural word-for-word translation.

==================================================
CATEGORIES
==================================================

6. "categoryIds"

Identify the product FIRST.

Then select categories that match the REAL product.

Prefer:
- 1 category

Maximum:
- {MAX_CATEGORY_IDS_PER_PRODUCT} categories

Do NOT dump unrelated categories.

Example:

"katri" → stationery / hardware

NEVER:

katri → mukwas / bakery / snacks

If existing categories are correct:
keep them.

If existing categories are clearly wrong:
replace them.

If product identity is uncertain:
keep existingCategoryIds or return [].

{category_catalog_block}

==================================================
FINAL VALIDATION
==================================================

Before returning each product, verify:

1. Is the product correctly identified?
2. Is the original product identity preserved?
3. Is the name still searchable using the original spelling?
4. Is secondName the SAME product in natural Marathi?
5. Is Hindi terminology avoided?
6. Are Marathi search keywords included where useful?
7. Are Roman Marathi customer spellings included where useful?
8. Are English equivalents included where useful?
9. Are local pronunciation variations included where useful?
10. Are brand combinations included where useful?
11. Is the actual pack size included?
12. Are realistic spelling variations included?
13. Are existing searchKey values NOT repeated?
14. Are existing searchKey values NOT removed or changed?
15. Are duplicate NEW keywords removed?
16. Are unrelated brands excluded?
17. Are marketing/SEO phrases excluded?
18. Are prices excluded?
19. Are unsupported claims excluded?
20. Are unrelated categories excluded?
21. Would these keywords realistically help a Maharashtra customer find
    this exact product?

==================================================
OUTPUT
==================================================

Output ONLY a valid JSON array.

Same length as input.

Same order as input.

No markdown.

No explanation.

No code fences.

Each object MUST have exactly:

{{
  "name": "",
  "secondName": "",
  "searchKey": "",
  "description": "",
  "secondaryDescription": "",
  "categoryIds": []
}}"""


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
        from bson.datetime_ms import DatetimeMS

        if isinstance(value, DatetimeMS):
            try:
                return value.as_datetime().isoformat()
            except (OverflowError, ValueError, OSError, ArithmeticError):
                return int(value)
    except ImportError:
        pass
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

    Soft-deleted products (deletedAt set) are skipped.

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

        doc = coll.find_one({"_id": oid, **NOT_DELETED})
        if not doc:
            raise ValueError("Product not found or is deleted")

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
        query = {"generateContentFromAI": {"$ne": True}, **NOT_DELETED}
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

    category_catalog, allowed_category_ids = _load_category_catalog(db)
    if not allowed_category_ids:
        logger.warning(
            "No active categories in '%s' — categoryIds from AI will be ignored; products.categories unchanged.",
            CATEGORIES_COLLECTION,
        )

    _configure_gemini()
    model_id = config.GEMINI_MODEL.strip()
    if model_id.startswith("models/"):
        model_id = model_id[len("models/") :]
    model = genai.GenerativeModel(model_id)

    for i in range(0, len(products), BATCH_SIZE):
        batch = products[i : i + BATCH_SIZE]
        input_items = _build_prompt_inputs_from_products(batch, category_catalog)
        prompt = _prompt_for_product_batch(input_items, category_catalog)

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
                old_name = batch[index].get("name")
                chosen_name = _choose_display_name(data.get("name"), old_name)
                update_fields = {
                    "name": chosen_name,
                    "secondName": data.get("secondName"),
                    "searchKey": _merge_search_key(
                        str(old_name or "").strip(),
                        batch[index].get("searchKey"),
                        data.get("searchKey"),
                    ),
                    "description": data.get("description"),
                    "secondaryDescription": data.get("secondaryDescription"),
                    "generateContentFromAI": True,
                    "updatedAt": datetime.now(timezone.utc),
                }
                if allowed_category_ids:
                    parsed_categories = _parse_category_ids(
                        data.get("categoryIds"),
                        allowed_category_ids,
                    )
                    if parsed_categories:
                        update_fields["categories"] = parsed_categories
                doc_after = coll.find_one_and_update(
                    {"_id": pid, **NOT_DELETED},
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
