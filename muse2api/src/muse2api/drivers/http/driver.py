"""HTTP/WebSocket protocol driver: talks to muse.ai without a browser.

Flow (details in ``docs/protocol.md``):

1. Plain HTTP with the account's cookies gets the agent VM's gateway token
   (``hatch.fetch_credentials``), waking a suspended VM first.
2. One Noise-encrypted WebSocket per account (``client.HatchConnection``) carries
   HTTP-style requests to the VM: ``POST /chat/stream`` starts a turn in a fresh
   session, ``/chat/history`` shows its events and produced files, ``/fs/raw`` serves
   the files.
3. Quota comes from the web app's ``fetchSubscriptionAction`` Next.js server action.

Every chat or media request opens a new muse.ai session, so requests never share
a conversation. Approval requests from the agent are always denied, never allowed.
"""

from __future__ import annotations

import asyncio
import base64
import codecs
import contextlib
import logging
import os
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import quote, urlencode

import httpx

from ...accounts.model import Account
from ...config import Settings
from ...errors import (
    InvalidRequest,
    UpstreamAuthError,
    UpstreamError,
    UpstreamRefused,
    UpstreamTimeout,
)
from ...upstream import muse
from ..base import (
    ChatRequest,
    DriverCapabilities,
    ImageRequest,
    InputImage,
    MediaResult,
    MuseDriver,
    SessionInfo,
    VideoRequest,
)
from . import hatch, parse
from .client import (
    ConnectionLost,
    Connector,
    HatchConnection,
    RequestFailed,
    Stream,
    StreamReset,
    check_status,
    websocket_connect,
)
from .hatch import CookieJar, GatewayCreds

log = logging.getLogger(__name__)

QUOTA_CACHE_SECONDS = 1800.0
CREDS_MAX_AGE = 240.0
"""Reuse a gateway token for a reconnect only while it is this fresh (seconds)."""
POLL_SECONDS = 1.5
CHAT_STREAM_CAPABILITIES = ["chat_cancel", "delta_stream"]
MEDIA_SETTLE_SECONDS = 8.0
"""Media seen while tools still run is taken anyway after this long."""
OVERRUN_FACTOR = 2.5
"""The media timeout is soft (up to this factor) while muse.ai is visibly working."""
MAX_RECONNECTS = 3
FS_READ_CHUNK = 256 * 1024
SHORT_REPLY = 500
"""Only a reply this short is checked for quota wording; long answers may discuss limits."""
GATEWAY_RETRY_PAUSE = 2.5


def quota_cache_seconds() -> float:
    """``MUSE2API_QUOTA_CACHE_S`` (read here: config.py has no knob for it)."""
    try:
        return max(0.0, float(os.environ.get("MUSE2API_QUOTA_CACHE_S", QUOTA_CACHE_SECONDS)))
    except ValueError:
        return QUOTA_CACHE_SECONDS


CredentialFetcher = Callable[[CookieJar], Awaitable[GatewayCreds]]


@dataclass
class _AccountState:
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    conn: HatchConnection | None = None
    creds: GatewayCreds | None = None
    base_cookies: dict[str, str] = field(default_factory=dict)
    rotated: dict[str, str] = field(default_factory=dict)
    """Cookies muse.ai rotated during this driver's own calls, layered over the account's."""


def media_prompt(prompt: str, kind: str, size: str | None, duration: int | None = None, *,
                 first_frame: bool = False, references: int = 0) -> str:
    """Same wording as the browser driver, plus a neutral note on attached images."""
    hints = []
    if size:
        hints.append(f"aspect ratio {size}")
    if duration:
        hints.append(f"{duration} seconds long")
    verb = "Generate an image" if kind == "image" else "Generate a video"
    suffix = f" ({', '.join(hints)})" if hints else ""
    parts = [f"{verb}{suffix}: {prompt}"]
    if first_frame:
        parts.append("Use the first attached image as the opening frame.")
        if references:
            parts.append("The other attached images are references (characters, outfits "
                         "or products) to keep consistent.")
    elif references:
        parts.append("Use the attached images as references.")
    return "\n\n".join(parts)


def image_items(images: list[InputImage]) -> list[dict[str, str]]:
    return [{"type": "image", "mime_type": img.mime,
             "data_base64": base64.b64encode(img.data).decode()} for img in images]


class HttpDriver(MuseDriver):
    name = "http"
    capabilities = DriverCapabilities(
        chat=True, chat_images=True, image=True, image_edit=True, video=True, renew_session=True,
        quota=True,
    )

    def __init__(self, settings: Settings, *, connector: Connector | None = None,
                 credentials: CredentialFetcher | None = None,
                 http_transport: httpx.AsyncBaseTransport | None = None,
                 poll_seconds: float = POLL_SECONDS) -> None:
        self.settings = settings
        self._connector = connector or websocket_connect
        self._http_transport = http_transport
        self._credentials = credentials or self._fetch_credentials
        self._poll = poll_seconds
        self._accounts: dict[str, _AccountState] = {}
        self._warming: dict[str, asyncio.Task] = {}
        self._quota_cache: dict[str, dict[str, Any]] = {}
        self._quota_locks: dict[str, asyncio.Lock] = {}
        self._action_id: str | None = None
        self._action_lock = asyncio.Lock()

    async def _fetch_credentials(self, jar: CookieJar) -> GatewayCreds:
        return await hatch.fetch_credentials(jar, transport=self._http_transport)

    # ------------------------------------------------------------ lifecycle
    async def shutdown(self) -> None:
        for task in self._warming.values():
            task.cancel()
        for st in self._accounts.values():
            if st.conn:
                await st.conn.close()
                st.conn = None

    async def health(self) -> dict[str, Any]:
        live = sum(1 for st in self._accounts.values() if st.conn and st.conn.alive)
        return {"driver": self.name, "ok": True, "connections": live}

    def prewarm(self, account: Account) -> None:
        """Open the account's gateway connection in the background."""
        task = self._warming.get(account.id)
        if task and not task.done():
            return

        async def warm() -> None:
            try:
                await self._connection(account)
            except Exception as exc:  # noqa: BLE001
                log.info("prewarming %s failed: %s", account.id, exc)

        self._warming[account.id] = asyncio.create_task(warm())

    # ------------------------------------------------------------ cookies / connection
    def _state(self, account: Account) -> _AccountState:
        st = self._accounts.get(account.id)
        if st is None:
            st = self._accounts[account.id] = _AccountState()
        if st.base_cookies != account.cookies:
            # New cookies were imported or renewed: our own rotations are obsolete.
            st.base_cookies = dict(account.cookies)
            st.rotated = {}
        return st

    def _jar(self, account: Account) -> CookieJar:
        st = self._state(account)
        return CookieJar({**account.cookies, **st.rotated})

    def _keep(self, account: Account, jar: CookieJar) -> None:
        self._state(account).rotated.update(jar.rotated)

    async def _connection(self, account: Account) -> HatchConnection:
        st = self._state(account)
        if st.conn and st.conn.alive:
            return st.conn
        async with st.lock:
            if st.conn and st.conn.alive:
                return st.conn
            if missing := muse.missing_session_cookies(account.cookies):
                raise UpstreamAuthError(
                    f"account is missing session cookies: {', '.join(missing)}")
            last: BaseException | None = None
            for attempt in range(2):
                if attempt or st.creds is None or time.time() - st.creds.fetched_at > CREDS_MAX_AGE:
                    jar = self._jar(account)
                    try:
                        st.creds = await self._credentials(jar)  # auth errors propagate
                    finally:
                        self._keep(account, jar)
                conn: HatchConnection | None = None
                try:
                    conn = await HatchConnection.open(st.creds, self._connector)
                    await conn.call("GET", "/api/session/list", timeout=15)
                except asyncio.CancelledError:
                    if conn:
                        await conn.close()
                    raise
                except Exception as exc:  # noqa: BLE001  - retried once with a fresh token
                    if conn:
                        await conn.close()
                    st.creds, last = None, exc
                    log.info("gateway connect for %s failed (%s): %s", account.id,
                             type(exc).__name__, exc)
                    if isinstance(exc, RequestFailed) and exc.status in (502, 503):
                        await asyncio.sleep(GATEWAY_RETRY_PAUSE)  # the VM is still starting
                    continue
                st.conn = conn
                log.info("gateway connected for account %s", account.id)
                return conn
            raise UpstreamError(f"cannot open the muse.ai gateway: {last}") from last

    def _drop(self, account: Account, conn: HatchConnection) -> None:
        st = self._accounts.get(account.id)
        if st and st.conn is conn:
            st.conn = None
        asyncio.ensure_future(conn.close())

    # ------------------------------------------------------------ turn helpers
    async def _start_turn(self, conn: HatchConnection, session_id: str,
                          items: list[dict[str, Any]]) -> Stream:
        return await conn.open_stream("POST", "/chat/stream", {
            "session_id": session_id, "items": items,
            "capabilities": CHAT_STREAM_CAPABILITIES})

    async def _turn_state(self, conn: HatchConnection, session_id: str
                          ) -> tuple[parse.HistoryView, str | None]:
        try:
            sess = await conn.call("GET", "/api/session/list/" + quote(session_id, safe=""),
                                   timeout=15)
        except RequestFailed as exc:
            if exc.status != 404:
                raise
            sess = None
        if isinstance(sess, dict) and isinstance(sess.get("session"), dict):
            sess = sess["session"]
        status = (str(sess["status"]).lower()
                  if isinstance(sess, dict) and sess.get("status") else None)
        history = await conn.call(
            "GET", "/chat/history?" + urlencode({"session_id": session_id, "limit": 200}),
            timeout=20)
        return parse.parse_history(history), status

    async def _deny(self, conn: HatchConnection, ids: list[str], denied: set[str]) -> bool:
        """Deny the agent's pending approval requests (never allow). True if any was new."""
        new = [a for a in ids if a not in denied]
        for approval in new:
            denied.add(approval)
            try:
                await conn.call("POST", f"/approvals/{quote(approval, safe='')}/decide",
                                {"decision": "deny"}, service="sentinel", timeout=10)
                log.info("denied muse.ai approval request %s", approval)
            except Exception as exc:  # noqa: BLE001
                log.info("denying approval %s failed: %s", approval, exc)
        return bool(new)

    async def _cancel_turn(self, conn: HatchConnection, session_id: str) -> None:
        with contextlib.suppress(Exception):
            await conn.call("POST", "/chat/cancel", {"session_id": session_id}, timeout=8)

    # ------------------------------------------------------------ chat
    async def chat_stream(self, account: Account, req: ChatRequest) -> AsyncIterator[str]:
        conn = await self._connection(account)
        session_id = str(uuid.uuid4())
        items = [*image_items(req.images), {"type": "text", "text": req.prompt}]
        try:
            stream = await self._start_turn(conn, session_id, items)
        except ConnectionLost:
            self._drop(account, conn)
            raise
        decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
        started = time.monotonic()
        buf, stream_text, emitted = "", "", ""
        stream_done = finished = False
        last_poll = 0.0
        denied: set[str] = set()
        try:
            while True:
                if req.cancel and req.cancel.is_set():
                    await self._cancel_turn(conn, session_id)
                    return
                elapsed = time.monotonic() - started
                if elapsed > req.timeout or (not emitted and elapsed > req.first_token_timeout):
                    await self._cancel_turn(conn, session_id)
                    raise UpstreamTimeout("assistant reply timed out" if emitted
                                          else "no first token from assistant")

                if not stream_done:
                    data = b""
                    try:
                        data = await stream.read(timeout=0.5)
                    except asyncio.TimeoutError:
                        pass
                    except StreamReset:
                        stream_done = True
                    if stream.status is not None and not 200 <= stream.status < 300:
                        rest = data if stream.ended else data + (await stream.collect()).body
                        check_status(stream.status, rest, "chat")
                    stream_done = stream_done or stream.ended
                    text = decoder.decode(data, final=stream_done) + ("\n" if stream_done else "")
                    events, buf = parse.iter_json_lines(buf + text)
                    for ev in events:
                        if err := parse.error_text(ev):
                            raise (parse.classify_failure(err)
                                   or UpstreamError(f"muse.ai reported an error: {err[:200]}"))
                        await self._deny(conn, parse.pending_approvals(ev), denied)
                        if (d := parse.text_delta(ev)) is not None:
                            stream_text += d
                        elif (f := parse.final_text(ev)) and f.startswith(stream_text):
                            stream_text = f
                else:
                    await asyncio.sleep(min(0.5, self._poll))

                if len(stream_text) > len(emitted) and stream_text.startswith(emitted):
                    yield stream_text[len(emitted):]
                    emitted = stream_text

                # History is the source of truth: it fills in when the stream's event
                # format is not recognised, and decides when the turn is over.
                now = time.monotonic()
                if (stream_done or not stream_text) and now - last_poll >= self._poll:
                    last_poll = now
                    view, status = await self._turn_state(conn, session_id)
                    await self._deny(conn, view.approvals, denied)
                    full = view.text
                    if len(full) > len(emitted) and full.startswith(emitted):
                        yield full[len(emitted):]
                        emitted = full
                    if status in ("failed", "error"):
                        raise (parse.classify_failure(full)
                               or UpstreamError(f"muse.ai turn failed: {full[:200]}"))
                    if stream_done and not view.active_tools and (
                            status in parse.TERMINAL_STATUSES or (status is None and full)):
                        finished = True
                        break
        except ConnectionLost:
            self._drop(account, conn)
            raise
        finally:
            await stream.cancel()
        if finished and not emitted:
            raise UpstreamError("muse.ai finished the turn without a reply")
        if len(emitted) <= SHORT_REPLY and (err := parse.classify_failure(emitted, kind="text")):
            raise err

    # ------------------------------------------------------------ media
    async def generate_image(self, account: Account, req: ImageRequest) -> list[MediaResult]:
        prompt = media_prompt(req.prompt, "image", req.size, references=len(req.reference_images))
        results = []
        for _ in range(max(1, req.n)):
            r = await self._generate(account, prompt, req.reference_images, "image",
                                     req.timeout, req.on_progress, req.cancel)
            r.revised_prompt = req.prompt
            results.append(r)
        return results

    async def generate_video(self, account: Account, req: VideoRequest) -> MediaResult:
        images = ([req.first_frame] if req.first_frame else []) + list(req.reference_images)
        prompt = media_prompt(req.prompt, "video", req.size, req.duration,
                              first_frame=req.first_frame is not None,
                              references=len(req.reference_images))
        return await self._generate(account, prompt, images, "video", req.timeout,
                                    req.on_progress, req.cancel, voice=req.voice)

    async def _set_voice(self, conn: HatchConnection, voice: str) -> None:
        try:
            await conn.call("POST", "/voice/active_voice/save", {"voice_id": voice}, timeout=10)
        except RequestFailed as exc:
            if exc.status in (400, 404, 422):
                raise InvalidRequest(f"muse.ai rejected voice '{voice}'") from None
            raise

    async def _drain(self, stream: Stream, kind: str, conn: HatchConnection,
                     denied: set[str]) -> None:
        """Consume a media turn's stream: deny approvals, surface errors."""
        decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
        buf, raw = "", b""
        while not stream.ended:
            data = await stream.read()
            if stream.status is not None and not 200 <= stream.status < 300:
                raw += data
                continue
            text = decoder.decode(data, final=stream.ended) + ("\n" if stream.ended else "")
            events, buf = parse.iter_json_lines(buf + text)
            for ev in events:
                await self._deny(conn, parse.pending_approvals(ev), denied)
                if err := parse.error_text(ev):
                    if failure := parse.classify_failure(err, kind=kind):
                        raise failure
                    log.info("muse.ai stream error event during %s: %.200s", kind, err)
        if stream.status is not None:
            check_status(stream.status, raw, f"{kind} request", kind=kind)

    async def _generate(self, account: Account, prompt: str, images: list[InputImage],
                        kind: str, timeout: float, on_progress, cancel: asyncio.Event | None,
                        voice: str | None = None) -> MediaResult:
        conn = await self._connection(account)
        if voice:
            await self._set_voice(conn, voice)
        session_id = str(uuid.uuid4())
        denied: set[str] = set()
        items = [*image_items(images), {"type": "text", "text": prompt}]
        stream = await self._start_turn(conn, session_id, items)
        drain = asyncio.create_task(self._drain(stream, kind, conn, denied))
        started = time.monotonic()
        asked = False
        events_at_ask = 0
        media_since: float | None = None
        reconnects = 0
        busy = True
        try:
            while True:
                if cancel and cancel.is_set():
                    await self._cancel_turn(conn, session_id)
                    raise asyncio.CancelledError
                elapsed = time.monotonic() - started
                if elapsed >= timeout and not (busy and elapsed < timeout * OVERRUN_FACTOR):
                    await self._cancel_turn(conn, session_id)
                    raise UpstreamTimeout(f"{kind} generation timed out")
                if drain.done() and not drain.cancelled() and (exc := drain.exception()):
                    if not isinstance(exc, (ConnectionLost, StreamReset)):
                        raise exc
                await asyncio.sleep(self._poll)
                try:
                    view, status = await self._turn_state(conn, session_id)
                except ConnectionLost:
                    # The turn lives on in the VM; reconnect and keep watching it.
                    reconnects += 1
                    self._drop(account, conn)
                    if reconnects > MAX_RECONNECTS:
                        raise
                    conn = await self._connection(account)
                    continue
                if await self._deny(conn, view.approvals, denied):
                    continue
                if on_progress:
                    on_progress(min(95, int(elapsed / timeout * 100)))

                terminal = status in parse.TERMINAL_STATUSES or (
                    status is None and drain.done() and not view.active_tools)
                if asked and view.events <= events_at_ask + 1:
                    terminal = False  # the follow-up has not been picked up yet
                busy = bool(view.active_tools) or not terminal

                found = view.media_of(kind)
                if found:
                    media_since = media_since or time.monotonic()
                    if (terminal or not view.active_tools
                            or time.monotonic() - media_since >= MEDIA_SETTLE_SECONDS):
                        return await self._download(conn, found[-1])
                    continue
                if status in ("failed", "error"):
                    raise (parse.classify_failure(view.text, kind=kind)
                           or UpstreamError(f"muse.ai {kind} turn failed: {view.text[:200]}"))
                if not terminal:
                    continue
                if failure := parse.classify_failure(view.text, kind=kind):
                    raise failure
                if not asked:
                    # The agent sometimes leaves the file only in its workspace. Ask once.
                    log.info("%s not attached; asking for it in chat: %.120s", kind, view.text)
                    asked, events_at_ask = True, view.events
                    drain.cancel()
                    await stream.cancel()
                    stream = await self._start_turn(conn, session_id, [{
                        "type": "text",
                        "text": f"Please attach the final {kind} file here in the chat, "
                                "as a single attachment."}])
                    drain = asyncio.create_task(self._drain(stream, kind, conn, denied))
                    continue
                raise UpstreamRefused(f"upstream replied with text only: {view.text[:200]}")
        except ConnectionLost:
            self._drop(account, conn)
            raise
        finally:
            drain.cancel()
            with contextlib.suppress(BaseException):
                await drain
            await stream.cancel()

    async def _download(self, conn: HatchConnection, media: parse.Media) -> MediaResult:
        if media.path.startswith(("http://", "https://")):
            async with httpx.AsyncClient(timeout=300, follow_redirects=True,
                                         transport=self._http_transport) as client:
                resp = await client.get(media.path)
            if resp.status_code >= 400:
                raise UpstreamError(
                    f"downloading the {media.kind} failed (HTTP {resp.status_code})")
            data = resp.content
        else:
            data = await self._read_vm_file(conn, media.path)
        mime = parse.sniff_mime(data)
        if not mime or mime.split("/")[0] != media.kind:
            raise UpstreamError(f"muse.ai returned a file that is not a valid {media.kind}")
        return MediaResult(data=data, mime=mime, kind=media.kind)  # type: ignore[arg-type]

    async def _read_vm_file(self, conn: HatchConnection, path: str) -> bytes:
        """``GET /fs/raw/<path>`` (what the web client uses), else chunked ``/fs/read``."""
        try:
            resp = await conn.request("GET", "/fs/raw/" + quote(path.lstrip("/"), safe="/"),
                                      timeout=300)
            if 200 <= resp.status < 300 and len(resp.body) >= 64:
                return resp.body
            log.info("fs/raw answered HTTP %s (%d bytes); trying fs/read", resp.status,
                     len(resp.body))
        except (RequestFailed, StreamReset) as exc:
            log.info("fs/raw failed: %s; trying fs/read", exc)
        chunks, offset = [], 0
        while True:
            res = await conn.call("POST", "/fs/read",
                                  {"path": path, "offset": offset, "len": FS_READ_CHUNK},
                                  timeout=60)
            b64 = res.get("data_base64") if isinstance(res, dict) else None
            if not b64:
                break
            buf = base64.b64decode(b64)
            chunks.append(buf)
            offset += len(buf)
            if res.get("eof") or not buf:
                break
        if not chunks:
            raise UpstreamError("muse.ai did not serve the generated file")
        return b"".join(chunks)

    # ------------------------------------------------------------ session
    async def renew_session(self, account: Account) -> SessionInfo:
        st = self._state(account)
        return await muse.renew_session({**account.cookies, **st.rotated})

    # ------------------------------------------------------------ quota
    def forget_quota(self, account_id: str) -> None:
        """Drop the cached snapshot so the next ``quota`` call asks muse.ai again."""
        self._quota_cache.pop(account_id, None)

    def _cached_quota(self, account_id: str) -> dict[str, Any] | None:
        hit = self._quota_cache.get(account_id)
        if hit and time.time() - hit["fetched_at"] < quota_cache_seconds():
            return dict(hit)
        return None

    async def _discover_action(self, jar: CookieJar, stale: str | None = None) -> str | None:
        async with self._action_lock:
            if self._action_id and self._action_id != stale:
                return self._action_id
            self._action_id = await hatch.discover_action_id(jar, transport=self._http_transport)
            if self._action_id:
                log.info("found the subscription server action")
            return self._action_id

    async def quota(self, account: Account) -> dict[str, Any]:
        """Weekly usage from muse.ai's subscription server action.

        Returns ``plan``, ``weekly_used_pct``, ``resets_at`` (ISO-8601 UTC),
        ``extra_left``, ``found``, ``source`` ("http"), ``fetched_at`` and, when muse.ai
        reports it, ``topup_balance``. Cached per account for ``MUSE2API_QUOTA_CACHE_S``
        (30 min); ``forget_quota`` bypasses the cache. A failed lookup is not cached."""
        if hit := self._cached_quota(account.id):
            return hit
        async with self._quota_locks.setdefault(account.id, asyncio.Lock()):
            if hit := self._cached_quota(account.id):
                return hit
            jar = self._jar(account)
            sub = None
            try:
                action = await self._discover_action(jar)
                for _ in range(2):
                    if not action:
                        break
                    try:
                        sub = await hatch.fetch_subscription(jar, action,
                                                             transport=self._http_transport)
                        break
                    except hatch.ActionNotFound as exc:
                        log.info("subscription action failed (%s); rediscovering", exc)
                        fresh = await self._discover_action(jar, stale=action)
                        action = fresh if fresh != action else None
            finally:
                self._keep(account, jar)
            if sub is None:
                return {**parse.parse_subscription(None), "source": "http",
                        "fetched_at": time.time(), "error": "subscription action not found"}
            snapshot = {**parse.parse_subscription(sub), "source": "http",
                        "fetched_at": time.time()}
            self._quota_cache[account.id] = snapshot
            return dict(snapshot)
