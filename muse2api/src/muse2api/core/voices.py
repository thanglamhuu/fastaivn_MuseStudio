"""muse.ai voice catalog.

Voice ids are muse.ai's own identifiers (``POST /voice/active_voice/save`` takes
them). The list in ``voices.json`` was collected from the web client and may go
stale when muse.ai changes its voices; an unknown id is still passed through.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

_CATALOG = Path(__file__).with_name("voices.json")

GROUP_LABELS = {
    "vi_native": "Tiếng Việt",
    "character_special": "Nhân vật / Cổ tích",
    "female_featured": "Nữ (quốc tế)",
    "male_featured": "Nam (quốc tế)",
    "asian": "Á Đông",
}


@lru_cache(maxsize=1)
def list_voices() -> list[dict[str, Any]]:
    try:
        items = json.loads(_CATALOG.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return [{**v, "group_label": GROUP_LABELS.get(v.get("group", ""), v.get("group", ""))}
            for v in items if isinstance(v, dict) and v.get("id")]


def get_voice(voice_id: str) -> dict[str, Any] | None:
    return next((v for v in list_voices() if v["id"] == voice_id), None)


def voice_label(voice_id: str) -> str:
    """Human-readable name for prompts; the raw id when it is not in the catalog."""
    v = get_voice(voice_id)
    return f"{v['name']} ({v['gender']})" if v else voice_id
