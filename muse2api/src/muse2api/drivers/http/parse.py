"""Pure helpers for the http driver: chat events, history, failure text and quota.

Nothing here does I/O, so all of it is covered by offline tests. The shapes were
inferred from the muse.ai web client's traffic and may drift; every parser is
lenient and ignores what it does not recognise.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from urllib.parse import unquote

from ...errors import UpstreamError, UpstreamKindBlocked, UpstreamQuotaError

DAY = 86400.0
REGION_BLOCK_SECONDS = 7 * DAY

# ---------------------------------------------------------------- stream events


def iter_json_lines(buffer: str) -> tuple[list[dict[str, Any]], str]:
    """Split a streamed body into JSON objects (NDJSON or SSE ``data:`` lines).

    Returns the parsed objects and the unfinished tail to prepend to the next chunk."""
    events: list[dict[str, Any]] = []
    *lines, rest = buffer.split("\n")
    for line in lines:
        s = line.strip()
        if s.startswith("data:"):
            s = s[5:].strip()
        if not s.startswith("{"):
            continue
        try:
            obj = json.loads(s)
        except ValueError:
            continue
        if isinstance(obj, dict):
            events.append(obj)
    return events, rest


def _payload(ev: dict[str, Any]) -> dict[str, Any]:
    for key in ("delta", "payload", "data"):
        if isinstance(ev.get(key), dict):
            return ev[key]
    return {}


_NON_TEXT_DELTAS = ("presentation", "tool", "task", "reasoning", "thinking", "approval", "status")


def text_delta(ev: dict[str, Any]) -> str | None:
    """The assistant text added by one streamed event, or None for other events."""
    name = str(ev.get("event_name") or ev.get("event") or ev.get("type") or "")
    low = name.lower()
    if any(word in low for word in _NON_TEXT_DELTAS):
        return None
    if not (low.startswith("delta") or low in ("text", "text_delta", "content_delta")):
        return None
    p = _payload(ev)
    if str(p.get("type") or "").lower() in ("tool_call", "task", "presentation", "reasoning"):
        return None
    for src in (p, ev):
        for key in ("text", "delta", "content"):
            if isinstance(src.get(key), str):
                return src[key]
    return None


def final_text(ev: dict[str, Any]) -> str | None:
    """Full assistant text carried by a finished-message event, if any."""
    if not _is_assistant(ev):
        return None
    text = _message_text(ev)
    return text or None


def error_text(ev: dict[str, Any]) -> str | None:
    """Text of an error event (``type``/``event_name`` "error" or an ``error`` object)."""
    name = str(ev.get("event_name") or ev.get("type") or "").lower()
    err = ev.get("error")
    if isinstance(err, (dict, str)) or name in ("error", "chat.error", "message.error"):
        return json.dumps(err if err is not None else ev, ensure_ascii=False)[:2000]
    return None


def is_done_event(ev: dict[str, Any]) -> bool:
    name = str(ev.get("event_name") or ev.get("type") or "").lower()
    status = str(ev.get("status") or _payload(ev).get("status") or "").lower()
    return name in ("done", "chat.done", "turn.completed", "message.done", "end") or (
        name.startswith(("session", "turn")) and status in TERMINAL_STATUSES)


def pending_approvals(ev: dict[str, Any]) -> list[str]:
    """Ids of approval requests an event says are waiting for a decision."""
    found: list[str] = []
    kind = str(ev.get("type") or ev.get("event_name") or "")
    if kind == "approvals.snapshot" and isinstance(ev.get("pending"), list):
        found += [str(p["id"]) for p in ev["pending"] if isinstance(p, dict) and p.get("id")]
    cands = [ev.get("approval"), _payload(ev).get("approval")]
    if kind in ("approval", "approval.requested", "delta.approval"):
        cands.append(_payload(ev) or ev)
    for app in cands:
        if isinstance(app, dict) and app.get("id") and app.get("status") in (None, "pending"):
            found.append(str(app["id"]))
    return list(dict.fromkeys(found))


# ---------------------------------------------------------------- history

TERMINAL_STATUSES = frozenset({"completed", "complete", "done", "failed", "error",
                               "cancelled", "canceled", "stopped", "idle"})
DONE_STATUSES = frozenset({"completed", "complete", "done", "idle"})
ACTIVE_TOOL_STATUSES = frozenset({"running", "queued", "in_progress", "working",
                                  "starting", "pending"})

_VIDEO_EXT = (".mp4", ".webm", ".mov", ".m4v", ".mkv")
_IMAGE_EXT = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif")
_PATH_IN_TEXT = re.compile(
    r"(?:sandbox://|/fs/raw/|/home/)[^\s)\"'<>\]]+?\.(?:mp4|webm|mov|m4v|png|jpe?g|webp|gif)",
    re.I)


@dataclass
class Media:
    kind: str
    path: str
    """Absolute path inside the agent's VM (``/home/...``) or an http(s) URL."""
    mime: str = ""


@dataclass
class HistoryView:
    texts: list[str] = field(default_factory=list)
    media: list[Media] = field(default_factory=list)
    active_tools: int = 0
    approvals: list[str] = field(default_factory=list)
    events: int = 0
    user_messages: int = 0

    @property
    def text(self) -> str:
        return "\n\n".join(t for t in self.texts if t)

    def media_of(self, kind: str) -> list[Media]:
        return [m for m in self.media if m.kind == kind]


def normalize_media_path(raw: str) -> str:
    """``/fs/raw/<quoted>`` / ``sandbox:///home/...`` / ``/home/...`` -> ``/home/...``;
    http(s) URLs are returned unchanged; anything else -> ""."""
    url = str(raw or "").strip()
    if not url:
        return ""
    if url.startswith(("http://", "https://")):
        return url
    if url.startswith("/fs/raw/"):
        url = unquote(url[len("/fs/raw/"):])
    elif url.startswith("sandbox://"):
        url = url[len("sandbox://"):]
    url = url.split("?", 1)[0].split("#", 1)[0]
    if not url:
        return ""
    return "/" + url.lstrip("/")


def media_kind(hint: str, mime: str, path: str) -> str:
    top = (mime or "").lower().split("/", 1)[0]
    if top in ("image", "video"):
        return top
    if (hint or "").lower() in ("image", "video"):
        return hint.lower()
    low = path.lower().split("?", 1)[0]
    if low.endswith(_VIDEO_EXT):
        return "video"
    if low.endswith(_IMAGE_EXT):
        return "image"
    return ""


def _is_user(ev: dict[str, Any]) -> bool:
    return ev.get("role") == "user" or str(ev.get("event_name") or "") == "message.user"


def _is_assistant(ev: dict[str, Any]) -> bool:
    if _is_user(ev):
        return False
    name = str(ev.get("event_name") or "")
    return (ev.get("role") == "assistant" or name.startswith("message.")
            or bool(ev.get("display_text")))


def _message_text(ev: dict[str, Any]) -> str:
    if isinstance(ev.get("display_text"), str) and ev["display_text"].strip():
        return ev["display_text"].strip()
    parts = [str(i.get("text")).strip() for i in (ev.get("items") or [])
             if isinstance(i, dict) and i.get("type") == "text" and i.get("text")]
    if parts:
        return "\n".join(parts)
    if isinstance(ev.get("text"), str):
        return ev["text"].strip()
    return ""


def _history_events(history: Any) -> list[dict[str, Any]]:
    if isinstance(history, list):
        events = history
    elif isinstance(history, dict):
        events = next((history[k] for k in ("chat_events", "messages", "events", "items")
                       if isinstance(history.get(k), list)), [])
    else:
        events = []
    return [e for e in events if isinstance(e, dict)]


def parse_history(history: Any) -> HistoryView:
    """Assistant texts, produced media, running tools and pending approvals of a session.

    The session is created by this driver, so everything that is not a user message
    belongs to the request (follow-ups included). Paths that also appear in user
    messages (uploaded references) are never reported as results."""
    view = HistoryView()
    events = _history_events(history)
    view.events = len(events)
    user_paths: set[str] = set()
    seen: set[str] = set()
    tools: dict[str, str] = {}

    def add(hint: str, raw: Any, mime: str = "") -> None:
        if not isinstance(raw, str):
            return
        path = normalize_media_path(raw)
        if not path or path in seen:
            return
        kind = media_kind(hint, mime, path)
        if kind not in ("image", "video"):
            return
        seen.add(path)
        view.media.append(Media(kind, path, mime or ""))

    for ev in events:
        if _is_user(ev):
            view.user_messages += 1
            for m in _PATH_IN_TEXT.finditer(json.dumps(ev, ensure_ascii=False)):
                user_paths.add(normalize_media_path(m.group(0)))
            continue
        name = str(ev.get("event_name") or "")
        p = _payload(ev)

        # tool / task progress
        if ev.get("type") == "task" or p.get("type") in ("tool_call", "task") or name in (
                "delta.tool_call", "delta.task"):
            tid = (ev.get("task_id") or ev.get("id") or p.get("id") or p.get("tool_call_id")
                   or p.get("task_id"))
            st = str(ev.get("status") or p.get("status") or "").lower()
            if tid and st:
                tools[str(tid)] = st

        view.approvals += [a for a in pending_approvals(ev) if a not in view.approvals]

        # presented media
        pres = p if name == "delta.presentation" else p.get("presentation")
        if isinstance(pres, dict):
            pkind = str(pres.get("kind") or "").lower()
            data = pres.get("data") if isinstance(pres.get("data"), dict) else {}
            for hint, key in (("image", "images"), ("video", "videos")):
                for item in data.get(key) or []:
                    if isinstance(item, dict) and not item.get("missing"):
                        add(hint, next((item[k] for k in ("path", "url", "file_path",
                                                          f"{hint}_url") if item.get(k)), None),
                            str(item.get("mime") or ""))
            if pkind in ("image", "video"):
                add(pkind, next((data[k] for k in ("path", "url", "file_path", "video_url",
                                                   "image_url") if data.get(k)), None),
                    str(data.get("mime") or ""))
            for m in _PATH_IN_TEXT.finditer(str(pres.get("fallback_text") or "")):
                add(pkind, m.group(0))

        # assistant text (paths mentioned in it count as media too)
        if _is_assistant(ev):
            text = _message_text(ev)
            if text:
                view.texts.append(text)
                for m in _PATH_IN_TEXT.finditer(text):
                    add("", m.group(0))

    view.media = [m for m in view.media if m.path not in user_paths]
    view.active_tools = sum(st in ACTIVE_TOOL_STATUSES for st in tools.values())
    return view


# ---------------------------------------------------------------- failures

_REGION = re.compile(
    r"video_not_available|(?:not|isn't|is not) (?:yet )?(?:available|supported|offered) "
    r"in your (?:region|country|location)", re.I)
_DAILY_VIDEO = re.compile(
    r"video_daily_budget_exhausted|daily video (?:limit|quota|budget)|"
    r"(?:24[- ]?hour|daily) (?:video )?(?:generation )?limit|"
    r"video limit for the (?:last|past) 24 hours", re.I)
_QUOTA = re.compile(
    r"out of credits|usage limit|weekly limit|limit reached|token limit|insufficient_quota|"
    r"quota (?:exceeded|exhausted)|rate_limit_exceeded", re.I)


def _reset_hint(obj: Any, now: float, depth: int = 0) -> float | None:
    """A reset time (unix seconds) found in an error body, if it carries one."""
    if depth > 4:
        return None
    if isinstance(obj, dict):
        for key in ("resets_at", "reset_at", "resetsAt", "resetAt", "retry_at"):
            if (ts := to_unix(obj.get(key))) is not None:
                return ts
        for key in ("retry_after", "retryAfter"):
            v = obj.get(key)
            if isinstance(v, (int, float)) and v > 0:
                return now + float(v)
        for v in obj.values():
            if (ts := _reset_hint(v, now, depth + 1)) is not None:
                return ts
    return None


def to_unix(value: Any) -> float | None:
    """Seconds or milliseconds since the epoch, or an ISO-8601 string -> unix seconds."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and value > 0:
        return float(value) / 1000.0 if value > 1e12 else float(value)
    if isinstance(value, str) and value.strip():
        try:
            return to_unix(float(value))
        except ValueError:
            pass
        try:
            dt = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        except ValueError:
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.timestamp()
    return None


def classify_failure(text: str, *, kind: str | None = None, body: Any = None,
                     now: float | None = None) -> UpstreamError | None:
    """Map an upstream error / refusal text to a muse2api error, or None if unrecognised.

    ``kind`` is the media being produced; video-only limits are ignored for images."""
    if not text:
        return None
    now = time.time() if now is None else now
    snippet = " ".join(text.split())[:300]
    if kind in (None, "video"):
        if _REGION.search(text):
            return UpstreamKindBlocked(f"muse.ai does not offer video for this account: {snippet}",
                                       kind="video", reason="region",
                                       until=now + REGION_BLOCK_SECONDS)
        if _DAILY_VIDEO.search(text):
            until = _reset_hint(body, now) if body is not None else None
            return UpstreamKindBlocked(f"muse.ai daily video limit reached: {snippet}",
                                       kind="video", reason="limit", until=until or now + DAY)
    if _QUOTA.search(text):
        return UpstreamQuotaError(f"muse.ai reports the account is out of quota: {snippet}")
    return None


# ---------------------------------------------------------------- quota

_ACTION_REF = re.compile(
    r"""["']([0-9a-f]{40,64})["'][^;]{0,300}?["']fetchSubscriptionAction["']""")
CHUNK_REF = re.compile(r"""/_next/static/chunks/[A-Za-z0-9_./~-]+?\.js""")


def find_action_id(js: str) -> str | None:
    """The Next.js server-action id bound to ``fetchSubscriptionAction`` in a JS chunk."""
    m = _ACTION_REF.search(js or "")
    return m.group(1) if m else None


def parse_action_response(text: str) -> dict[str, Any] | None:
    """Pull the ``subscription`` object out of a React Server Components (``N:json``) body."""
    for line in (text or "").splitlines():
        _, sep, rest = line.partition(":")
        candidates = [rest] if sep else []
        candidates.append(line)
        for cand in candidates:
            cand = cand.strip()
            if not cand.startswith("{"):
                continue
            try:
                obj = json.loads(cand)
            except ValueError:
                continue
            if isinstance(obj, dict) and isinstance(obj.get("subscription"), dict) and (
                    obj.get("success", True)):
                return obj["subscription"]
    return None


def _iso(ts: float | None) -> str | None:
    if ts is None:
        return None
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def parse_subscription(sub: dict[str, Any] | None) -> dict[str, Any]:
    """Map the subscription object to the browser driver's quota keys.

    ``resets_at`` is an ISO-8601 UTC timestamp here (the browser driver reports the
    page's display text); ``topup_balance`` is added when muse.ai reports one."""
    sub = sub if isinstance(sub, dict) else {}
    tier = sub.get("tier") if isinstance(sub.get("tier"), dict) else {}
    usage = sub.get("usage") if isinstance(sub.get("usage"), dict) else {}
    pct = usage.get("percentUsed")
    pct = float(pct) if isinstance(pct, (int, float)) and not isinstance(pct, bool) else None
    balance = sub.get("topupBalance")
    extra = sub.get("topupRowValueLabel") or (None if balance is None else str(balance))
    out: dict[str, Any] = {
        "plan": tier.get("name") or None,
        "weekly_used_pct": pct,
        "resets_at": _iso(to_unix(usage.get("resetsAt"))),
        "extra_left": extra or None,
        "found": pct is not None,
    }
    if balance is not None:
        out["topup_balance"] = balance
    return out


# ---------------------------------------------------------------- files

def sniff_mime(data: bytes) -> str | None:
    """MIME type of an image/video from its magic bytes, or None if unrecognised."""
    head = data[:32]
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"GIF8"):
        return "image/gif"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    if head[4:8] == b"ftyp":
        brand = head[8:12]
        if brand in (b"avif", b"avis"):
            return "image/avif"
        return "video/quicktime" if brand == b"qt  " else "video/mp4"
    if head.startswith(b"\x1aE\xdf\xa3"):
        return "video/webm"
    return None
