"""Plain-HTTP calls to muse.ai: gateway credentials for the Noise WebSocket and the
subscription (quota) server action.

Cookie and token values are never logged; errors carry status codes only.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

import httpx

from ...errors import UpstreamAuthError, UpstreamError
from ...upstream import muse
from . import parse

log = logging.getLogger(__name__)

SESSION_LIVE_API = f"{muse.SESSION_API}?vm_state=live"
TOKEN_API = f"{muse.SITE}/api/hatch/token"
NOTARY_API = f"{muse.SITE}/api/hatch/noise-notary-token"

GATEWAY_WS = "wss://hatch.metaaivm.com/v1/noise"
APP_ID = "hatch-web"

WAKE_WAIT_SECONDS = 20.0
WAKE_POLL_SECONDS = 1.5
MAX_CHUNKS_SCANNED = 120
CHUNK_CONCURRENCY = 8


@dataclass
class GatewayCreds:
    vm_name: str
    token: str
    notary: str | None = None
    endpoint: str | None = None
    vm_state: str | None = None
    fetched_at: float = 0.0

    def ws_params(self) -> dict[str, str]:
        params = {"vm_id": self.vm_name, "auth_token": self.token, "app_id": APP_ID,
                  "request_id": str(uuid.uuid4())}
        if self.notary:
            params["notary_token"] = self.notary
        return params

    def __repr__(self) -> str:  # never print the tokens
        return (f"GatewayCreds(vm_name={self.vm_name!r}, vm_state={self.vm_state!r}, "
                f"notary={'yes' if self.notary else 'no'})")


def _headers(json_body: bool = False) -> dict[str, str]:
    h = {"User-Agent": muse.USER_AGENT, "Origin": muse.SITE, "Referer": muse.NEW_THREAD_URL,
         "Accept": "application/json, text/plain, */*"}
    if json_body:
        h["Content-Type"] = "application/json"
    return h


class CookieJar:
    """The account's cookies plus whatever muse.ai rotated during our own calls."""

    def __init__(self, cookies: dict[str, str]) -> None:
        self.cookies = dict(cookies)
        self.rotated: dict[str, str] = {}

    def header(self) -> str:
        return muse.cookie_header(self.cookies)

    def merge(self, resp: httpx.Response) -> None:
        for c in resp.cookies.jar:
            if c.value and self.cookies.get(c.name) != c.value:
                self.cookies[c.name] = c.value
                self.rotated[c.name] = c.value


def _json(resp: httpx.Response) -> dict[str, Any]:
    try:
        body = resp.json()
    except ValueError:
        return {}
    return body if isinstance(body, dict) else {}


def _vm_info(body: dict[str, Any]) -> dict[str, Any]:
    vms = body.get("vms")
    first = vms[0] if isinstance(vms, list) and vms and isinstance(vms[0], dict) else {}

    def pick(*keys: str) -> Any:
        for src in (body, first):
            for k in keys:
                if src.get(k):
                    return src[k]
        return None

    return {
        "vm_name": pick("vm_id", "vm_name", "vmName"),
        "vm_state": str(pick("vm_state", "vmState") or "").upper() or None,
        "endpoint": pick("endpoint_url", "endpointUrl"),
        "token": pick("token", "authToken"),
        "notary": pick("notary_token", "notaryToken", "noiseNotaryToken"),
    }


def _check(resp: httpx.Response, what: str) -> None:
    if resp.status_code in (401, 403):
        raise UpstreamAuthError(f"{what} rejected by muse.ai (HTTP {resp.status_code})")
    if resp.status_code >= 400:
        raise UpstreamError(f"{what} returned HTTP {resp.status_code}")


async def fetch_credentials(
    jar: CookieJar, *, timeout: float = 15.0, wake_wait: float = WAKE_WAIT_SECONDS,
    sleep: Callable[[float], Awaitable[object]] = asyncio.sleep,
    transport: httpx.AsyncBaseTransport | None = None,
) -> GatewayCreds:
    """Session -> (wake) -> gateway token -> notary token."""
    async with httpx.AsyncClient(timeout=timeout, headers=_headers(),
                                 transport=transport) as client:
        async def get_session() -> dict[str, Any]:
            resp = await client.get(SESSION_LIVE_API, headers={"Cookie": jar.header()})
            _check(resp, "session endpoint")
            jar.merge(resp)
            return _vm_info(_json(resp))

        info = await get_session()
        vm = info["vm_name"]
        if not vm:
            raise UpstreamError("muse.ai assigned no workspace to this account")
        if info["vm_state"] == "DISABLED":
            raise UpstreamError("the account's muse.ai workspace is disabled")
        if info["vm_state"] not in (None, "RUNNING"):
            # SUSPENDED (or still starting): wake it and wait until it runs.
            try:
                w = await client.post(muse.VM_WAKE_API, headers={
                    **_headers(True), "Cookie": jar.header()}, json={
                    "vm_id": vm, "retry_count": 0, "connect_attempt_id": str(uuid.uuid4())})
                jar.merge(w)
            except httpx.HTTPError as exc:
                log.info("vm wake failed: %s", type(exc).__name__)
            deadline = time.monotonic() + wake_wait
            while time.monotonic() < deadline:
                await sleep(WAKE_POLL_SECONDS)
                try:
                    polled = await get_session()
                except httpx.HTTPError:
                    continue
                info.update({k: v for k, v in polled.items() if v})
                if polled["vm_state"] == "RUNNING":
                    break

        token, notary = info["token"], info["notary"]
        endpoint = info["endpoint"] or f"wss://{vm}.metaaivm.com/"
        if not token:
            resp = await client.post(TOKEN_API, headers={**_headers(True), "Cookie": jar.header()},
                                     json={"vmAddress": endpoint, "vmName": vm})
            _check(resp, "gateway token endpoint")
            jar.merge(resp)
            body = _json(resp)
            token = body.get("token") or body.get("authToken")
            notary = notary or body.get("notary_token") or body.get("notaryToken")
        if not token:
            raise UpstreamError("muse.ai issued no gateway token")
        if not notary:
            try:
                resp = await client.post(NOTARY_API, headers={
                    **_headers(True), "Cookie": jar.header()}, json={"vmName": vm})
                if resp.status_code < 400:
                    jar.merge(resp)
                    body = _json(resp)
                    notary = body.get("notaryToken") or body.get("notary_token") or body.get("token")
            except httpx.HTTPError as exc:
                log.info("notary token request failed: %s", type(exc).__name__)
    return GatewayCreds(vm_name=str(vm), token=str(token), notary=str(notary) if notary else None,
                        endpoint=str(endpoint), vm_state=info["vm_state"], fetched_at=time.time())


# ---------------------------------------------------------------- quota

async def discover_action_id(jar: CookieJar, *, timeout: float = 10.0,
                             transport: httpx.AsyncBaseTransport | None = None) -> str | None:
    """Find the ``fetchSubscriptionAction`` server-action id in the site's JS chunks."""
    async with httpx.AsyncClient(timeout=timeout, headers={"User-Agent": muse.USER_AGENT},
                                 transport=transport, follow_redirects=True) as client:
        html = ""
        for url in (muse.NEW_THREAD_URL, muse.SITE + "/"):
            try:
                resp = await client.get(url, headers={"Cookie": jar.header(), "Accept": "text/html"})
            except httpx.HTTPError:
                continue
            if resp.status_code < 400 and "/_next/static/chunks/" in resp.text:
                html = resp.text
                break
        if not html:
            return None
        queue = list(dict.fromkeys(parse.CHUNK_REF.findall(html)))
        seen: set[str] = set(queue)
        sem = asyncio.Semaphore(CHUNK_CONCURRENCY)

        async def fetch(path: str) -> str:
            async with sem:
                try:
                    r = await client.get(muse.SITE + path)
                except httpx.HTTPError:
                    return ""
                return r.text if r.status_code < 400 else ""

        scanned = 0
        while queue and scanned < MAX_CHUNKS_SCANNED:
            batch, queue = queue[:CHUNK_CONCURRENCY * 2], queue[CHUNK_CONCURRENCY * 2:]
            scanned += len(batch)
            for js in await asyncio.gather(*(fetch(p) for p in batch)):
                if action := parse.find_action_id(js):
                    return action
                for ref in parse.CHUNK_REF.findall(js):
                    if ref not in seen:
                        seen.add(ref)
                        queue.append(ref)
    return None


class ActionNotFound(UpstreamError):
    """The subscription server action id is stale or unknown."""


async def fetch_subscription(jar: CookieJar, action_id: str, *, timeout: float = 12.0,
                             transport: httpx.AsyncBaseTransport | None = None
                             ) -> dict[str, Any]:
    """POST the Next.js server action and return the ``subscription`` object."""
    headers = {**_headers(), "Cookie": jar.header(), "Next-Action": action_id,
               "Accept": "text/x-component", "Content-Type": "text/plain;charset=UTF-8"}
    async with httpx.AsyncClient(timeout=timeout, transport=transport) as client:
        resp = await client.post(muse.NEW_THREAD_URL, headers=headers,
                                 content=b'[{"includeAgreement":true}]')
    if resp.status_code == 401:
        raise UpstreamAuthError("quota lookup rejected by muse.ai (HTTP 401)")
    if resp.status_code >= 400:
        raise ActionNotFound(f"subscription action returned HTTP {resp.status_code}")
    jar.merge(resp)
    sub = parse.parse_action_response(resp.text)
    if sub is None:
        raise ActionNotFound("subscription action answered without a subscription")
    return sub
