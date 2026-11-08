"""One Noise-encrypted WebSocket to an account's agent VM, multiplexing HTTP-style
requests by stream id (see ``docs/protocol.md``)."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Protocol
from urllib.parse import urlencode

from ...errors import UpstreamAuthError, UpstreamError, UpstreamQuotaError
from ...upstream import muse
from . import parse
from .hatch import GATEWAY_WS, GatewayCreds
from .noise import DecryptedFrame, Header, NoiseTransport, NoiseXXInitiator
from .noise.envelope import ResetCode

log = logging.getLogger(__name__)

HANDSHAKE_TIMEOUT = 12.0
MAX_WS_MESSAGE = 32 * 1024 * 1024
MAX_BODY = 512 * 1024 * 1024


class WebSocketLike(Protocol):
    async def send(self, message: bytes) -> None: ...
    async def recv(self) -> bytes | str: ...
    async def close(self) -> None: ...


Connector = Callable[[GatewayCreds], Awaitable[WebSocketLike]]


class ConnectionLost(UpstreamError):
    """The Noise WebSocket dropped; the request may or may not have reached the VM."""


class StreamReset(UpstreamError):
    """The VM reset a request stream."""


class RequestFailed(UpstreamError):
    """A Noise request answered with a non-2xx status or ``ok: false``."""

    def __init__(self, message: str, *, status: int, body: bytes = b"") -> None:
        super().__init__(message)
        self.status = status
        self.body = body


@dataclass
class Response:
    status: int
    body: bytes

    def json(self) -> Any:
        try:
            return json.loads(self.body or b"null")
        except ValueError:
            return None


async def websocket_connect(creds: GatewayCreds) -> WebSocketLike:
    """Open the gateway WebSocket. Errors never include the URL (it carries tokens)."""
    from websockets.asyncio.client import connect
    from websockets.exceptions import InvalidStatus

    url = f"{GATEWAY_WS}?{urlencode(creds.ws_params())}"
    try:
        return await connect(url, origin=muse.SITE, user_agent_header=muse.USER_AGENT,
                             max_size=MAX_WS_MESSAGE, open_timeout=HANDSHAKE_TIMEOUT,
                             ping_interval=20, ping_timeout=20)
    except InvalidStatus as exc:
        status = exc.response.status_code
        raise RequestFailed(f"gateway refused the WebSocket (HTTP {status})",
                            status=status) from None
    except (OSError, asyncio.TimeoutError) as exc:
        raise ConnectionLost(f"cannot reach the muse.ai gateway: {type(exc).__name__}") from None


async def noise_handshake(ws: WebSocketLike, timeout: float = HANDSHAKE_TIMEOUT) -> NoiseTransport:
    """Noise XX as initiator: -> e; <- e, ee, s, es, payload; -> s, se."""
    hs = NoiseXXInitiator()
    hs.initialize()
    await ws.send(hs.write_message1())
    msg2 = await asyncio.wait_for(ws.recv(), timeout)
    if not isinstance(msg2, (bytes, bytearray)):
        raise UpstreamError("gateway answered the handshake with a text frame")
    payload = hs.read_message2(bytes(msg2))
    # The web client accepts a payload whose first protobuf field is #2 (0x12); anything
    # else asks for an extra device-key verification this driver cannot do.
    if not payload.startswith(b"\x12"):
        raise UpstreamError("gateway asked for device-key verification; use driver=browser")
    await ws.send(hs.write_message3())
    send, recv = hs.split()
    return NoiseTransport(send, recv)


class Stream:
    """Frames of one request stream: ``response`` first, then ``body_chunk`` frames."""

    def __init__(self, conn: HatchConnection, stream_id: int, service: str) -> None:
        self.conn = conn
        self.stream_id = stream_id
        self.service = service
        self.queue: asyncio.Queue[DecryptedFrame | BaseException] = asyncio.Queue()
        self.status: int | None = None
        self.ended = False

    async def read(self, timeout: float | None = None) -> bytes:
        """Next piece of body. Sets ``status`` on the response frame, ``ended`` at the end."""
        frame = await asyncio.wait_for(self.queue.get(), timeout)
        if isinstance(frame, BaseException):
            raise frame
        if frame.kind == "reset":
            self.ended = True
            raise StreamReset(f"muse.ai reset the request ({frame.value.reason or frame.value.code})")
        value = frame.value
        if frame.kind == "response":
            self.status = value.status
            data = value.body
        else:
            data = value.data
        if value.end_body:
            self.ended = True
        return bytes(data)

    async def collect(self, limit: int = MAX_BODY) -> Response:
        chunks, total = [], 0
        while not self.ended:
            data = await self.read()
            total += len(data)
            if total > limit:
                raise UpstreamError("muse.ai response exceeded the size limit")
            chunks.append(data)
        return Response(self.status or 0, b"".join(chunks))

    async def cancel(self) -> None:
        self.conn.forget(self.stream_id)
        if not self.ended and self.conn.alive:
            with contextlib.suppress(Exception):
                await self.conn.send_reset(self.stream_id, self.service)


class HatchConnection:
    def __init__(self, ws: WebSocketLike, transport: NoiseTransport) -> None:
        self.ws = ws
        self.transport = transport
        self._streams: dict[int, Stream] = {}
        self._send_lock = asyncio.Lock()
        self._closed = False
        self._reader = asyncio.create_task(self._read_loop())

    @classmethod
    async def open(cls, creds: GatewayCreds, connector: Connector = websocket_connect
                   ) -> HatchConnection:
        ws = await connector(creds)
        try:
            transport = await noise_handshake(ws)
        except BaseException:
            with contextlib.suppress(Exception):
                await ws.close()
            raise
        return cls(ws, transport)

    @property
    def alive(self) -> bool:
        return not self._closed

    async def _read_loop(self) -> None:
        error: BaseException = ConnectionLost("muse.ai gateway connection closed")
        try:
            while True:
                raw = await self.ws.recv()
                if not isinstance(raw, (bytes, bytearray)):
                    continue
                frame = self.transport.decrypt_frame(bytes(raw))
                if frame is None:
                    continue
                stream = self._streams.get(frame.stream_id)
                if stream is not None:
                    stream.queue.put_nowait(frame)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001  - any failure ends the connection
            log.info("gateway connection ended: %s", type(exc).__name__)
            if not isinstance(exc, ConnectionError):
                error = ConnectionLost(f"muse.ai gateway connection lost ({type(exc).__name__})")
        finally:
            self._closed = True
            for stream in list(self._streams.values()):
                stream.queue.put_nowait(error)

    def forget(self, stream_id: int) -> None:
        self._streams.pop(stream_id, None)

    async def _send(self, frames) -> None:
        try:
            for f in frames:
                await self.ws.send(f)
        except Exception as exc:
            self._closed = True
            raise ConnectionLost(f"sending to muse.ai failed ({type(exc).__name__})") from None

    async def send_reset(self, stream_id: int, service: str = "daemon") -> None:
        async with self._send_lock:
            await self._send(self.transport.encrypt_reset(stream_id, service=service,
                                                          code=ResetCode.CANCELLED))

    async def open_stream(self, method: str, path: str, body: Any = None, *,
                          service: str = "daemon") -> Stream:
        if self._closed:
            raise ConnectionLost("muse.ai gateway connection is closed")
        payload = json.dumps(body).encode() if body is not None else b""
        headers = [Header("Content-Type", "application/json"), Header("x-app-id", "hatch-web"),
                   Header("x-request-id", str(uuid.uuid4()))]
        # Encrypting and sending happen under one lock: the nonce order must be the wire order.
        async with self._send_lock:
            try:
                enc = self.transport.encrypt_http_request(method, path, payload, service=service,
                                                          headers=headers)
            except ValueError as exc:  # body too large for Noise framing
                raise UpstreamError(f"request too large for muse.ai: {exc}") from None
            stream = Stream(self, enc.stream_id, service)
            self._streams[enc.stream_id] = stream
            try:
                await self._send(enc.frames)
            except BaseException:
                self.forget(enc.stream_id)
                raise
        return stream

    async def request(self, method: str, path: str, body: Any = None, *,
                      service: str = "daemon", timeout: float = 35.0) -> Response:
        stream = await self.open_stream(method, path, body, service=service)
        try:
            return await asyncio.wait_for(stream.collect(), timeout)
        except asyncio.TimeoutError:
            raise UpstreamError(f"muse.ai did not answer {method} {path.split('?')[0]}") from None
        finally:
            self.forget(stream.stream_id)

    async def call(self, method: str, path: str, body: Any = None, *,
                   service: str = "daemon", timeout: float = 35.0) -> Any:
        """``request`` + status check + JSON ``{"ok", "result"}`` unwrapping."""
        resp = await self.request(method, path, body, service=service, timeout=timeout)
        check_status(resp.status, resp.body, f"{method} {path.split('?')[0]}")
        value = resp.json()
        if isinstance(value, dict):
            if value.get("ok") is False:
                raise failure_from_body(resp.body, resp.status or 200,
                                        f"{method} {path.split('?')[0]}")
            return value.get("result", value)
        return value

    async def close(self) -> None:
        self._closed = True
        self._reader.cancel()
        with contextlib.suppress(BaseException):
            await self._reader
        with contextlib.suppress(Exception):
            await asyncio.wait_for(self.ws.close(), 2.0)


def failure_from_body(body: bytes, status: int, what: str, *,
                      kind: str | None = None) -> UpstreamError:
    text = body[:4000].decode("utf-8", "replace")
    try:
        parsed = json.loads(text)
    except ValueError:
        parsed = None
    if err := parse.classify_failure(text, kind=kind, body=parsed):
        return err
    if status == 401:
        return UpstreamAuthError(f"{what}: muse.ai session expired (HTTP 401)")
    if status == 429:
        return UpstreamQuotaError(f"{what}: muse.ai rate-limited the account (HTTP 429)")
    return RequestFailed(f"{what} failed (HTTP {status}): {' '.join(text.split())[:200]}",
                         status=status, body=body[:4000])


def check_status(status: int, body: bytes, what: str, *, kind: str | None = None) -> None:
    if not 200 <= status < 300:
        raise failure_from_body(body, status, what, kind=kind)
