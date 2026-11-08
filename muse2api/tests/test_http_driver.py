"""http driver, fully offline: Noise handshake and framing against the vendored
responder, a scripted in-memory agent VM, history parsing, error mapping and quota."""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import Callable
from typing import Any

import httpx
import pytest

from muse2api.accounts import Account
from muse2api.config import Settings
from muse2api.drivers.base import ChatRequest, ImageRequest, InputImage, VideoRequest
from muse2api.drivers.http import hatch, parse
from muse2api.drivers.http.client import (
    HatchConnection,
    RequestFailed,
    failure_from_body,
    noise_handshake,
)
from muse2api.drivers.http.driver import HttpDriver, media_prompt
from muse2api.drivers.http.hatch import CookieJar, GatewayCreds
from muse2api.drivers.http.noise import (
    ApplicationResponse,
    BodyChunk,
    NoiseFrameDecoder,
    NoiseXXResponder,
    ServiceFrame,
    ServiceType,
    decode_service_frame,
    decode_service_request,
    encode_noise_frames,
)
from muse2api.drivers.http.noise.transport import encode_response_envelope
from muse2api.errors import (
    UpstreamAuthError,
    UpstreamError,
    UpstreamKindBlocked,
    UpstreamQuotaError,
    UpstreamRefused,
)

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 200
MP4 = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 300
COOKIES = {"hatch_sess": "s", "hatch_native_auth_device": "d"}


# ---------------------------------------------------------------- fake agent VM
class FakeWS:
    def __init__(self) -> None:
        self.to_server: asyncio.Queue = asyncio.Queue()
        self.to_client: asyncio.Queue = asyncio.Queue()
        self.closed = False

    async def send(self, message: bytes) -> None:
        if self.closed:
            raise ConnectionError("closed")
        await self.to_server.put(bytes(message))

    async def recv(self) -> bytes:
        item = await self.to_client.get()
        if item is None:
            raise ConnectionError("closed")
        return item

    async def close(self) -> None:
        self.closed = True
        self.to_client.put_nowait(None)
        self.to_server.put_nowait(None)


Reply = tuple[int, Any] | list[bytes]
Handler = Callable[[str, str, Any], Reply]


class FakeVM:
    """Noise responder plus scripted routes. A handler returns ``(status, body)`` or a
    list of body chunks (a 200 stream)."""

    def __init__(self, routes: dict[tuple[str, str], Any], payload: bytes = b"\x12\x00") -> None:
        self.routes = routes
        self.payload = payload
        self.calls: list[tuple[str, str, Any, ServiceType]] = []
        self.sockets: list[FakeWS] = []
        self.tasks: list[asyncio.Task] = []

    async def connect(self, creds: GatewayCreds) -> FakeWS:
        ws = FakeWS()
        self.sockets.append(ws)
        self.tasks.append(asyncio.create_task(self._serve(ws)))
        return ws

    def paths(self, verb: str | None = None) -> list[str]:
        return [p for v, p, _, _ in self.calls if verb is None or v == verb]

    def route(self, verb: str, path: str) -> Any:
        for (v, prefix), h in sorted(self.routes.items(), key=lambda kv: -len(kv[0][1])):
            if v == verb and path.startswith(prefix):
                return h
        return None

    async def _serve(self, ws: FakeWS) -> None:
        r = NoiseXXResponder(self.payload)
        r.initialize()
        await ws.to_client.put(r.read_message1_and_write_message2(await ws.to_server.get()))
        msg3 = await ws.to_server.get()
        if msg3 is None:
            return
        r.read_message3(msg3)
        send, recv = r.split()
        decoder = NoiseFrameDecoder()

        def push(frame: ServiceFrame) -> None:
            for f in encode_noise_frames(encode_response_envelope(frame)):
                ws.to_client.put_nowait(send.encrypt_with_ad(b"", f))

        while (ct := await ws.to_server.get()) is not None:
            whole = decoder.decode(recv.decrypt_with_ad(b"", ct))
            if whole is None:
                continue
            req = decode_service_request(whole)
            frame = decode_service_frame(req.payload)
            if frame.kind != "request":
                continue
            app = frame.value
            body = json.loads(app.body) if app.body else None
            self.calls.append((app.verb, app.path, body, req.service))
            handler = self.route(app.verb, app.path)
            reply = handler(app.verb, app.path, body) if callable(handler) else (
                handler if handler is not None else (404, {"ok": False}))
            sid = frame.stream_id
            if isinstance(reply, list):
                push(ServiceFrame.response(sid, ApplicationResponse(status=200)))
                for i, chunk in enumerate(reply):
                    push(ServiceFrame.body_chunk(sid, BodyChunk(
                        data=chunk, end_body=i == len(reply) - 1)))
                if not reply:
                    push(ServiceFrame.body_chunk(sid, BodyChunk(end_body=True)))
            else:
                status, data = reply
                if not isinstance(data, bytes):
                    data = json.dumps(data).encode()
                push(ServiceFrame.response(sid, ApplicationResponse(
                    status=status, body=data, end_body=True)))

    async def stop(self) -> None:
        for ws in self.sockets:
            await ws.close()
        for t in self.tasks:
            t.cancel()


def creds() -> GatewayCreds:
    return GatewayCreds(vm_name="vm-1", token="tok", notary="n", fetched_at=time.time())


def ok(result: Any) -> tuple[int, Any]:
    return 200, {"ok": True, "result": result}


def events(*evs: dict) -> list[bytes]:
    return [("".join(f"data: {json.dumps(e)}\n" for e in evs)).encode()]


@pytest.fixture
def account() -> Account:
    return Account(id="acc_test", cookies=dict(COOKIES))


def make_driver(vm: FakeVM, settings_kw: dict | None = None, **kw) -> HttpDriver:
    fetched: list[int] = []

    async def fake_creds(jar: CookieJar) -> GatewayCreds:
        fetched.append(1)
        return creds()

    d = HttpDriver(Settings(_env_file=None, driver="http", **(settings_kw or {})),
                   connector=vm.connect, credentials=kw.pop("credentials", fake_creds),
                   poll_seconds=0.01, **kw)
    d.fetched = fetched  # type: ignore[attr-defined]
    return d


BASE_ROUTES: dict[tuple[str, str], Any] = {
    ("GET", "/api/session/list"): ok({"sessions": []}),
    ("POST", "/chat/cancel"): ok({}),
    ("POST", "/approvals/"): ok({}),
}


# ---------------------------------------------------------------- noise transport
async def test_handshake_and_request_roundtrip():
    vm = FakeVM({**BASE_ROUTES, ("GET", "/echo"): lambda v, p, b: ok({"path": p})})
    conn = await HatchConnection.open(creds(), vm.connect)
    try:
        assert await conn.call("GET", "/echo?x=1") == {"path": "/echo?x=1"}
        # Two requests in flight share the connection and are told apart by stream id.
        a, b = await asyncio.gather(conn.call("GET", "/echo/a"), conn.call("GET", "/echo/b"))
        assert (a["path"], b["path"]) == ("/echo/a", "/echo/b")
    finally:
        await conn.close()
        await vm.stop()


async def test_large_bodies_are_chunked_both_ways():
    big = bytes(range(256)) * 1000  # 256 kB: several Noise frames
    vm = FakeVM({("POST", "/upload"): lambda v, p, b: ok({"n": len(b["data"])}),
                 ("GET", "/fs/raw/"): (200, big)})
    conn = await HatchConnection.open(creds(), vm.connect)
    try:
        assert (await conn.call("POST", "/upload", {"data": "x" * 200_000}))["n"] == 200_000
        resp = await conn.request("GET", "/fs/raw/home/user/a.bin")
        assert resp.status == 200 and resp.body == big
    finally:
        await conn.close()
        await vm.stop()


async def test_handshake_rejects_unexpected_payload():
    vm = FakeVM({}, payload=b"\x0a\x01x")
    ws = await vm.connect(creds())
    with pytest.raises(UpstreamError, match="device-key"):
        await noise_handshake(ws)
    await vm.stop()


async def test_error_status_maps_to_muse2api_errors():
    vm = FakeVM({("GET", "/a"): (401, {"error": "expired"}),
                 ("GET", "/b"): (403, {"error": {"code": "video_not_available"}}),
                 ("GET", "/c"): (500, b"boom")})
    conn = await HatchConnection.open(creds(), vm.connect)
    try:
        with pytest.raises(UpstreamAuthError):
            await conn.call("GET", "/a")
        with pytest.raises(UpstreamKindBlocked) as blocked:
            await conn.call("GET", "/b")
        assert blocked.value.reason == "region" and blocked.value.kind == "video"
        with pytest.raises(RequestFailed) as failed:
            await conn.call("GET", "/c")
        assert failed.value.status == 500 and failed.value.retryable
    finally:
        await conn.close()
        await vm.stop()


# ---------------------------------------------------------------- parsing
def test_iter_json_lines_keeps_partial_tail():
    evs, rest = parse.iter_json_lines('data: {"a": 1}\n{"b": 2}\nnot json\n{"c": ')
    assert evs == [{"a": 1}, {"b": 2}] and rest == '{"c": '


def test_text_delta_recognises_text_only():
    assert parse.text_delta({"event_name": "delta.text", "payload": {"text": "Hi"}}) == "Hi"
    assert parse.text_delta({"type": "delta", "delta": {"text": " there"}}) == " there"
    assert parse.text_delta({"event_name": "delta.tool_call", "payload": {"text": "x"}}) is None
    assert parse.text_delta({"event_name": "delta.reasoning", "payload": {"text": "x"}}) is None
    assert parse.text_delta({"event_name": "message.assistant", "display_text": "x"}) is None


HISTORY = {"chat_events": [
    {"role": "user", "event_name": "message.user",
     "items": [{"type": "text", "text": "draw"}, {"type": "image",
                                                   "path": "/home/user/your_files/ref.png"}]},
    {"event_name": "delta.tool_call", "payload": {"id": "t1", "status": "completed"}},
    {"event_name": "delta.tool_call", "payload": {"id": "t2", "status": "running"}},
    {"event_name": "delta.presentation", "payload": {"kind": "image", "data": {"images": [
        {"path": "/fs/raw/home/user/workspace/out%20one.png", "mime": "image/png"},
        {"path": "/home/user/workspace/missing.png", "missing": True},
        {"path": "/home/user/your_files/ref.png"},
    ]}}},
    {"event_name": "delta.presentation", "payload": {
        "kind": "video", "fallback_text": "see sandbox:///home/user/workspace/clip.mp4 here"}},
    {"type": "approvals.snapshot", "pending": [{"id": "ap1"}]},
    {"role": "assistant", "event_name": "message.assistant", "display_text": "Done."},
    {"role": "assistant", "items": [{"type": "text",
                                     "text": "Also at /home/user/workspace/b.webp."}]},
]}


def test_parse_history_media_text_tools_and_approvals():
    view = parse.parse_history(HISTORY)
    assert [(m.kind, m.path) for m in view.media] == [
        ("image", "/home/user/workspace/out one.png"),
        ("video", "/home/user/workspace/clip.mp4"),
        ("image", "/home/user/workspace/b.webp"),
    ]
    assert view.text == "Done.\n\nAlso at /home/user/workspace/b.webp."
    assert view.active_tools == 1 and view.approvals == ["ap1"] and view.user_messages == 1
    assert view.media_of("video")[0].path.endswith("clip.mp4")


@pytest.mark.parametrize("raw, want", [
    ("/fs/raw/home/user/a%2Bb.png?x=1", "/home/user/a+b.png"),
    ("sandbox:///home/user/v.mp4", "/home/user/v.mp4"),
    ("/home/user/v.mp4", "/home/user/v.mp4"),
    ("https://cdn.example/v.mp4", "https://cdn.example/v.mp4"),
    ("", ""),
])
def test_normalize_media_path(raw, want):
    assert parse.normalize_media_path(raw) == want


def test_sniff_mime():
    assert parse.sniff_mime(PNG) == "image/png"
    assert parse.sniff_mime(MP4) == "video/mp4"
    assert parse.sniff_mime(b"<html>") is None


# ---------------------------------------------------------------- error mapping
NOW = 1_800_000_000.0


def test_classify_region_daily_and_weekly():
    region = parse.classify_failure('403 {"code":"video_not_available"}', kind="video", now=NOW)
    assert isinstance(region, UpstreamKindBlocked)
    assert (region.reason, region.until) == ("region", NOW + 7 * 86400)

    daily = parse.classify_failure("You've hit your account's 24-hour video limit.",
                                   kind="video", now=NOW)
    assert isinstance(daily, UpstreamKindBlocked)
    assert (daily.kind, daily.reason, daily.until) == ("video", "limit", NOW + 86400)

    hinted = parse.classify_failure("video_daily_budget_exhausted", kind="video", now=NOW,
                                    body={"error": {"resets_at": (NOW + 3600) * 1000}})
    assert hinted.until == NOW + 3600

    assert isinstance(parse.classify_failure("You are out of credits", kind="image"),
                      UpstreamQuotaError)
    # A video-only limit says nothing about images.
    assert parse.classify_failure("24-hour video limit", kind="image") is None
    assert parse.classify_failure("Here is your image", kind="image") is None


def test_failure_from_body_statuses():
    assert isinstance(failure_from_body(b"{}", 401, "x"), UpstreamAuthError)
    assert isinstance(failure_from_body(b"{}", 429, "x"), UpstreamQuotaError)
    blocked = failure_from_body(b'{"error":"video_not_available"}', 403, "x", kind="video")
    assert isinstance(blocked, UpstreamKindBlocked) and blocked.reason == "region"


def test_media_prompt():
    assert media_prompt("a cat", "image", "16:9") == "Generate an image (aspect ratio 16:9): a cat"
    p = media_prompt("walk", "video", "9:16", 8, first_frame=True, references=2)
    assert p.startswith("Generate a video (aspect ratio 9:16, 8 seconds long): walk")
    assert "opening frame" in p and "references" in p


# ---------------------------------------------------------------- driver end to end
def image_routes(history: dict, status: str = "completed", extra: dict | None = None
                 ) -> dict:
    return {**BASE_ROUTES,
            ("POST", "/chat/stream"): events({"type": "approvals.snapshot",
                                              "pending": [{"id": "ap9"}]}),
            ("GET", "/api/session/list/"): ok({"status": status}),
            ("GET", "/chat/history"): ok(history),
            ("GET", "/fs/raw/"): (200, PNG),
            **(extra or {})}


async def test_generate_image_downloads_presented_file(account):
    hist = {"chat_events": [
        {"role": "user", "items": [{"type": "text", "text": "x"}]},
        {"event_name": "delta.presentation", "payload": {"kind": "image", "data": {
            "images": [{"path": "/home/user/workspace/out.png"}]}}},
    ]}
    vm = FakeVM(image_routes(hist))
    d = make_driver(vm)
    try:
        ref = InputImage(PNG, "image/png")
        [res] = await d.generate_image(account, ImageRequest(
            prompt="a cat", model="m", size="1:1", reference_images=[ref], timeout=5))
        assert res.mime == "image/png" and res.data == PNG and res.revised_prompt == "a cat"
        stream_call = next(c for c in vm.calls if c[1] == "/chat/stream")
        items = stream_call[2]["items"]
        assert [i["type"] for i in items] == ["image", "text"]
        assert items[1]["text"].startswith("Generate an image (aspect ratio 1:1): a cat")
        assert "/fs/raw/home/user/workspace/out.png" in vm.paths("GET")
        # The approval was denied on the sentinel service, never allowed.
        decide = [c for c in vm.calls if c[1].startswith("/approvals/")]
        assert decide and all(c[2] == {"decision": "deny"} for c in decide)
        assert all(c[3] == ServiceType.SERVICE_SENTINEL for c in decide)
        # One connection serves every call of the account.
        assert len(vm.sockets) == 1 and d.fetched == [1]
    finally:
        await d.shutdown()
        await vm.stop()


async def test_generate_video_sets_voice_and_sends_references(account):
    hist = {"chat_events": [{"role": "user"}, {"event_name": "delta.presentation", "payload": {
        "kind": "video", "data": {"videos": [{"path": "/home/user/workspace/v.mp4"}]}}}]}
    vm = FakeVM(image_routes(hist, extra={("POST", "/voice/active_voice/save"): ok({}),
                                         ("GET", "/fs/raw/"): (200, MP4)}))
    d = make_driver(vm)
    try:
        res = await d.generate_video(account, VideoRequest(
            prompt="walk", model="m", first_frame=InputImage(PNG),
            reference_images=[InputImage(PNG), InputImage(PNG, "image/jpeg")],
            voice="voice-7", timeout=5))
        assert res.kind == "video" and res.mime == "video/mp4"
        voice = next(c for c in vm.calls if c[1] == "/voice/active_voice/save")
        assert voice[2] == {"voice_id": "voice-7"}
        assert vm.paths().index("/voice/active_voice/save") < vm.paths().index("/chat/stream")
        items = next(c for c in vm.calls if c[1] == "/chat/stream")[2]["items"]
        assert [i["type"] for i in items] == ["image", "image", "image", "text"]
        assert items[2]["mime_type"] == "image/jpeg"
    finally:
        await d.shutdown()
        await vm.stop()


async def test_video_daily_limit_blocks_the_kind(account):
    hist = {"chat_events": [{"role": "user"}, {"role": "assistant", "display_text":
                            "Sorry, you've reached your 24-hour video limit."}]}
    vm = FakeVM(image_routes(hist))
    d = make_driver(vm)
    try:
        with pytest.raises(UpstreamKindBlocked) as exc:
            await d.generate_video(account, VideoRequest(prompt="x", model="m", timeout=5))
        assert exc.value.kind == "video" and exc.value.reason == "limit"
        assert exc.value.until > time.time() + 86000
    finally:
        await d.shutdown()
        await vm.stop()


async def test_video_region_block_from_stream_status(account):
    vm = FakeVM({**image_routes({"chat_events": []}, status="running"),
                 ("POST", "/chat/stream"): (403, {"error": {"code": "video_not_available"}})})
    d = make_driver(vm)
    try:
        with pytest.raises(UpstreamKindBlocked) as exc:
            await d.generate_video(account, VideoRequest(prompt="x", model="m", timeout=5))
        assert exc.value.reason == "region"
    finally:
        await d.shutdown()
        await vm.stop()


async def test_text_only_reply_asks_once_then_refuses(account):
    turns = {"n": 0}

    def history(v, p, b):
        # Each turn adds a user message and a text reply.
        evs = []
        for i in range(turns["n"]):
            evs += [{"role": "user"}, {"role": "assistant", "display_text": f"I can't ({i})"}]
        return ok({"chat_events": evs})

    def stream(v, p, b):
        turns["n"] += 1
        return []

    vm = FakeVM(image_routes({}, extra={("GET", "/chat/history"): history,
                                       ("POST", "/chat/stream"): stream}))
    d = make_driver(vm)
    try:
        with pytest.raises(UpstreamRefused):
            await d.generate_image(account, ImageRequest(prompt="x", model="m", timeout=5))
        sent = [c[2]["items"][-1]["text"] for c in vm.calls if c[1] == "/chat/stream"]
        assert len(sent) == 2
        assert sent[1] == "Please attach the final image file here in the chat, as a single attachment."
    finally:
        await d.shutdown()
        await vm.stop()


async def test_chat_stream_yields_stream_deltas(account):
    polls = {"n": 0}

    def history(v, p, b):
        # The first poll (before any delta) sees nothing yet; later ones the full reply.
        polls["n"] += 1
        return ok({"chat_events": [{"role": "user"}] + (
            [{"role": "assistant", "display_text": "Hello!"}] if polls["n"] > 1 else [])})

    vm = FakeVM({**BASE_ROUTES,
                 ("POST", "/chat/stream"): [
                     *events({"event_name": "delta.text", "payload": {"text": "Hel"}}),
                     *events({"event_name": "delta.text", "payload": {"text": "lo"}})],
                 ("GET", "/api/session/list/"): ok({"status": "completed"}),
                 ("GET", "/chat/history"): history})
    d = make_driver(vm)
    try:
        out = [t async for t in d.chat_stream(account, ChatRequest(prompt="hi", model="m",
                                                                   timeout=5))]
        assert out == ["Hel", "lo", "!"]
    finally:
        await d.shutdown()
        await vm.stop()


async def test_chat_stream_falls_back_to_history(account):
    vm = FakeVM({**BASE_ROUTES,
                 ("POST", "/chat/stream"): events({"event_name": "something.new", "x": 1}),
                 ("GET", "/api/session/list/"): ok({"status": "completed"}),
                 ("GET", "/chat/history"): ok({"chat_events": [
                     {"role": "user"}, {"role": "assistant", "display_text": "From history"}]})})
    d = make_driver(vm)
    try:
        out = [t async for t in d.chat_stream(account, ChatRequest(prompt="hi", model="m",
                                                                   timeout=5))]
        assert "".join(out) == "From history"
    finally:
        await d.shutdown()
        await vm.stop()


async def test_chat_quota_reply_raises(account):
    vm = FakeVM({**BASE_ROUTES, ("POST", "/chat/stream"): [],
                 ("GET", "/api/session/list/"): ok({"status": "completed"}),
                 ("GET", "/chat/history"): ok({"chat_events": [
                     {"role": "assistant", "display_text": "You are out of credits."}]})})
    d = make_driver(vm)
    try:
        with pytest.raises(UpstreamQuotaError):
            async for _ in d.chat_stream(account, ChatRequest(prompt="hi", model="m", timeout=5)):
                pass
    finally:
        await d.shutdown()
        await vm.stop()


async def test_reconnect_fetches_a_fresh_token(account):
    vm = FakeVM(dict(BASE_ROUTES))
    attempts = {"n": 0}

    async def flaky(c: GatewayCreds):
        attempts["n"] += 1
        if attempts["n"] == 1:
            raise RequestFailed("gateway refused the WebSocket (HTTP 401)", status=401)
        return await vm.connect(c)

    d = make_driver(vm)
    d._connector = flaky
    try:
        conn = await d._connection(account)
        assert conn.alive and d.fetched == [1, 1]
        await vm.sockets[0].close()  # the gateway drops the socket
        await asyncio.sleep(0.01)
        assert not conn.alive
        assert (await d._connection(account)) is not conn
    finally:
        await d.shutdown()
        await vm.stop()


async def test_missing_cookies_is_auth_error():
    d = make_driver(FakeVM({}))
    with pytest.raises(UpstreamAuthError):
        await d._connection(Account(cookies={"hatch_sess": "x"}))


# ---------------------------------------------------------------- HTTP bootstrap
async def test_fetch_credentials_wakes_and_gets_tokens():
    seen: list[tuple[str, str]] = []
    state = {"polls": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.method, request.url.path))
        assert "hatch_sess=s" in request.headers["cookie"]
        if request.url.path == "/api/session":
            state["polls"] += 1
            st = "SUSPENDED" if state["polls"] == 1 else "RUNNING"
            return httpx.Response(200, json={"vm_id": "vm-9", "vm_state": st},
                                  headers={"set-cookie": "hatch_vml=new; Path=/"})
        if request.url.path == "/api/hatch/token":
            assert json.loads(request.content) == {"vmAddress": "wss://vm-9.metaaivm.com/",
                                                   "vmName": "vm-9"}
            return httpx.Response(200, json={"token": "T"})
        if request.url.path == "/api/hatch/noise-notary-token":
            return httpx.Response(200, json={"notaryToken": "N"})
        return httpx.Response(200, json={})

    jar = CookieJar(dict(COOKIES))
    got = await hatch.fetch_credentials(jar, transport=httpx.MockTransport(handler),
                                        sleep=lambda s: asyncio.sleep(0))
    assert (got.vm_name, got.token, got.notary, got.vm_state) == ("vm-9", "T", "N", "RUNNING")
    assert ("POST", "/api/hatch/vm/wake") in seen
    assert jar.rotated == {"hatch_vml": "new"}
    assert "T" not in repr(got)
    assert got.ws_params()["app_id"] == "hatch-web"


async def test_fetch_credentials_401_is_auth_error():
    transport = httpx.MockTransport(lambda r: httpx.Response(401))
    with pytest.raises(UpstreamAuthError):
        await hatch.fetch_credentials(CookieJar(dict(COOKIES)), transport=transport)


# ---------------------------------------------------------------- quota
ACTION = "a" * 42
SUB = {"tier": {"name": "Free plan", "isPaid": False},
       "usage": {"percentUsed": 37.5, "resetsAt": 1_800_000_000_000, "quotaStatus": "OK"},
       "topupBalance": 1200, "topupRowValueLabel": "1.2K tokens left"}


def test_quota_parsers():
    js = ('x=(0,s.createServerReference)("' + ACTION + '",s.callServer,void 0,s.findSourceMapURL,'
          '"fetchSubscriptionAction");')
    assert parse.find_action_id(js) == ACTION
    body = '0:{"a":"$@1"}\n1:{"success":true,"subscription":' + json.dumps(SUB) + "}\n"
    sub = parse.parse_action_response(body)
    assert sub == SUB
    assert parse.parse_subscription(sub) == {
        "plan": "Free plan", "weekly_used_pct": 37.5, "resets_at": "2027-01-15T08:00:00Z",
        "extra_left": "1.2K tokens left", "found": True, "topup_balance": 1200}
    assert parse.parse_subscription(None)["found"] is False


async def test_driver_quota_discovers_action_and_caches(account, monkeypatch):
    monkeypatch.setenv("MUSE2API_QUOTA_CACHE_S", "600")
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.method + " " + request.url.path)
        if request.method == "GET" and request.url.path == "/thread/new":
            return httpx.Response(200, text='<script src="/_next/static/chunks/main-1.js"></script>')
        if request.url.path == "/_next/static/chunks/main-1.js":
            return httpx.Response(200, text='import("/_next/static/chunks/lazy-2.js")')
        if request.url.path == "/_next/static/chunks/lazy-2.js":
            return httpx.Response(200, text=f'createServerReference)("{ACTION}",a,b,'
                                            '"fetchSubscriptionAction")')
        if request.method == "POST" and request.url.path == "/thread/new":
            assert request.headers["next-action"] == ACTION
            assert request.content == b'[{"includeAgreement":true}]'
            return httpx.Response(200, text="1:" + json.dumps({"success": True,
                                                               "subscription": SUB}))
        return httpx.Response(404)

    d = HttpDriver(Settings(_env_file=None, driver="http"),
                   http_transport=httpx.MockTransport(handler))
    q = await d.quota(account)
    assert q["source"] == "http" and q["found"] and q["weekly_used_pct"] == 37.5
    assert {"plan", "weekly_used_pct", "resets_at", "extra_left", "found", "fetched_at",
            "topup_balance"} <= set(q)
    n = len(calls)
    assert (await d.quota(account))["fetched_at"] == q["fetched_at"]  # cached
    assert len(calls) == n
    d.forget_quota(account.id)
    await d.quota(account)
    assert calls[n:] == ["POST /thread/new"]  # the action id is reused across reads


async def test_driver_quota_stale_action_is_rediscovered(account):
    stale = "b" * 42

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET" and request.url.path == "/thread/new":
            return httpx.Response(200, text='"/_next/static/chunks/c.js"')
        if request.url.path.endswith("c.js"):
            return httpx.Response(200, text=f'"{ACTION}",x,"fetchSubscriptionAction"')
        if request.headers.get("next-action") == ACTION:
            return httpx.Response(200, text="0:" + json.dumps({"subscription": SUB}))
        return httpx.Response(404)

    d = HttpDriver(Settings(_env_file=None, driver="http"),
                   http_transport=httpx.MockTransport(handler))
    d._action_id = stale
    assert (await d.quota(account))["found"]
    assert d._action_id == ACTION
