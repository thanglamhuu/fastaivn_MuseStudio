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


_GENDER_VI = {"female": "giọng NỮ", "male": "giọng NAM", "neutral": "giọng trung tính"}


def voice_prompt_hint(voice_id: str) -> str:
    """[MuseStudio patch] Câu dặn giọng cho prompt khi không đặt được giọng qua API (driver trình duyệt).

    Muse không hiểu mã thô ``avocado_v2:…`` viết trong prompt (đo được: chọn giọng nữ vẫn ra giọng nam) →
    tả bằng chữ: giới tính, giọng vùng, tên giọng. Chỉ áp cho lời dẫn / nhân vật chính để không đổi giọng
    của các nhân vật khác trong cảnh nhiều người (bố, mẹ, con…)."""
    v = get_voice(voice_id)
    if not v:
        return f"(Voice for narration and dialogue: {voice_id})"
    gender = _GENDER_VI.get(str(v.get("gender") or ""), "")
    accent = str(v.get("accent") or "").strip()
    accent_vi = "nói tiếng Việt chuẩn" if accent == "Tiếng Việt" else f"chất giọng {accent}" if accent else ""
    desc = ", ".join(x for x in (gender, accent_vi, f"sắc thái \"{v['name']}\"") if x)
    return (f"[GIỌNG NÓI: lời dẫn và lời thoại của nhân vật chính dùng {desc}"
            f"{' (tuyệt đối không dùng giọng nam)' if v.get('gender') == 'female' else ' (tuyệt đối không dùng giọng nữ)' if v.get('gender') == 'male' else ''}; "
            "nhân vật khác trong cảnh giữ giọng hợp giới tính, tuổi của họ.]")


def voice_label(voice_id: str) -> str:
    """Human-readable name for prompts; the raw id when it is not in the catalog."""
    v = get_voice(voice_id)
    return f"{v['name']} ({v['gender']})" if v else voice_id
