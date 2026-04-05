"""Request/response models for Gemini product enrichment."""
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class GeminiEnrichRequest(BaseModel):
    """Enrich product fields using Gemini (matches your script's update shape)."""

    limit: Optional[int] = Field(
        None,
        ge=1,
        le=20000,
        description="Max products to pull from the not-yet-AI queue. Use 1 to test a single record.",
    )
    productId: Optional[str] = Field(
        None,
        description="If set, only this MongoDB _id is processed (batch of 1).",
    )
    force: bool = Field(
        False,
        description="With productId: re-run even if generateContentFromAI is already true.",
    )


class GeminiEnrichResponse(BaseModel):
    """Summary of a Gemini enrichment run."""

    productsSelected: int
    productsUpdated: int
    batchesRun: int
    errors: List[str] = Field(default_factory=list)
    updatedProducts: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="Full product documents from MongoDB after each successful $set (JSON-safe).",
    )
