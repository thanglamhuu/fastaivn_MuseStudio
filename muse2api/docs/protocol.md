# muse.ai direct protocol (http driver)

What `MUSE2API_DRIVER=http` speaks to muse.ai, as implemented in
`src/muse2api/drivers/http/`. It was put together from the web client's behaviour
and has **only been tested offline** (against an in-memory Noise responder, see
`tests/test_http_driver.py`). Items marked *unverified* are educated guesses that
need a check against a real account.

```
             cookies (hatch_sess, hatch_native_auth_device, ...)
  muse2api ───────── HTTPS ─────────▶ muse.ai          /api/session, /api/hatch/*, server action
     │
     └──── WSS + Noise XX ──────────▶ hatch.metaaivm.com/v1/noise ──▶ account's agent VM
                                       (HTTP-style requests multiplexed by stream id)
```

## 1. Gateway credentials (plain HTTPS, `hatch.py`)

All calls send the account's cookies, `Origin: https://muse.ai`,
`Referer: https://muse.ai/thread/new` and a desktop Chrome user agent. Cookies that
muse.ai rotates via `Set-Cookie` are kept in memory per account and layered over the
stored ones until the account's cookies change (keepalive / import).

| Step | Request | Notes |
|---|---|---|
| 1 | `GET /api/session?vm_state=live` | `vm_id` (or `vm_name`, or `vms[0].*`), `vm_state`, `endpoint_url`, sometimes `token` / `notary_token`. 401/403 → `UpstreamAuthError`. |
| 2 | `POST /api/hatch/vm/wake` `{vm_id, retry_count: 0, connect_attempt_id}` | Only when `vm_state` is set and not `RUNNING`; then step 1 is polled every 1.5 s for up to 20 s. `DISABLED` → `UpstreamError`. |
| 3 | `POST /api/hatch/token` `{vmAddress, vmName}` | Only if step 1 gave no token. `vmAddress` defaults to `wss://<vm>.metaaivm.com/`. Answer: `token` (and maybe `notary_token`). |
| 4 | `POST /api/hatch/noise-notary-token` `{vmName}` | Only if no notary token yet; failure is ignored. Answer: `notaryToken`. |

A token is reused for reconnects for 4 minutes (`CREDS_MAX_AGE`); a failed connect is
retried once with freshly fetched credentials (after 2.5 s on 502/503, the VM is
probably still starting). Token and cookie values are never logged and `GatewayCreds`
hides them from `repr`.

## 2. Noise WebSocket (`client.py`, `noise/`)

```
wss://hatch.metaaivm.com/v1/noise?vm_id=<vm>&auth_token=<token>&app_id=hatch-web
                                  &request_id=<uuid4>[&notary_token=<notary>]
Origin: https://muse.ai
```

The URL carries the token, so it is never logged; connection errors report status
codes only.

### Handshake

`Noise_XX_25519_AESGCM_SHA256`, muse2api is the initiator, empty prologue:

1. → `e` (32 bytes)
2. ← `e, ee, s, es` + encrypted payload. The web client continues only if the payload's
   first byte is `0x12` (protobuf field 2, length-delimited). Any other payload means
   the gateway wants an extra device-key verification, which this driver cannot do:
   `UpstreamError` (*unverified what that field holds*).
3. → `s, se` + empty payload; `split()` gives the send/receive cipher states.

Every later WebSocket binary message is one AES-GCM ciphertext (empty AD, nonce
counter per direction). Encrypting and sending happen under one lock so the nonce
order is the wire order.

### Framing (vendored, `noise/framing.py`, `noise/envelope.py`)

Plaintext = `NoiseTransportFrame{chunk_id, chunk_index, total_chunks, payload}`
(protobuf); payloads over 65 489 bytes are split into up to 256 chunks (16 MB per
message). The reassembled bytes are a `ServiceRequest{service, payload}` (client →
VM; service `daemon`=0, `sentinel`=1, `vault`=2, `authd`=3) or a
`ServiceResponse{payload}` (VM → client), whose payload is a `ServiceFrame`:

| field | kind | content |
|---|---|---|
| 1 | `stream_id` | int64, chosen by the client, increasing per connection |
| 2 | request | `{verb, path, headers[], body, end_body}` |
| 3 | response | `{status, headers[], body, end_body}` |
| 4 | body_chunk | `{data, end_body}` |
| 5 | reset | `{code, reason}` (code 1 = cancelled) |

A request is answered by one response frame, then body chunks until `end_body`.
Requests send `Content-Type: application/json`, `x-app-id: hatch-web` and a fresh
`x-request-id`. JSON answers are usually `{"ok": true, "result": ...}`;
`ok: false` is an error. One connection per account carries all of its concurrent
requests; when the socket drops, every open stream fails with `ConnectionLost` and
the next request reconnects.

The `noise/` package is Meta's Apache-2.0 Muse Gadget SDK code (see
`noise/NOTICE.txt`); only `noise_xx.py` was changed (its non-`cryptography`
fallbacks were removed).

## 3. Agent VM endpoints used

All on service `daemon` unless noted.

| Request | Use |
|---|---|
| `GET /api/session/list` | Health probe right after the handshake. |
| `POST /chat/stream` `{session_id, items, capabilities: ["chat_cancel","delta_stream"]}` | Starts a turn. `session_id` is a new UUID per muse2api request, so a new muse.ai session. `items`: `{type:"image", mime_type, data_base64}`… then `{type:"text", text}`. The answer streams for the length of the turn. |
| `GET /api/session/list/<session_id>` | Session `status` (`running`, `completed`, `failed`, …). 404 = not created yet. |
| `GET /chat/history?session_id=…&limit=200` | `chat_events` (or `messages`) of the session; see below. |
| `POST /chat/cancel` `{session_id}` | On timeout or when the client cancels. |
| `POST /voice/active_voice/save` `{voice_id}` | Before a video turn when `VideoRequest.voice` is set. 400/404/422 → `InvalidRequest`. |
| `GET /fs/raw/<path>` | Downloads a produced file (what the web UI's media URLs point at). |
| `POST /fs/read` `{path, offset, len}` → `{data_base64, eof}` | Fallback download in 256 KiB pieces. |
| `POST /approvals/<id>/decide` `{decision: "deny"}` (service `sentinel`) | Denies an approval request. muse2api never sends an allowing decision. *The `deny` value is unverified*; a failure is only logged. |

### Stream events

The `/chat/stream` body is read as NDJSON or SSE (`data: {...}` lines). Recognised
(*event names unverified*):

- text deltas: `event_name`/`type` starting with `delta` (not tool, task,
  presentation, reasoning, approval or status) with a string `text`/`delta`/`content`
  in `delta`, `payload`, `data` or the event itself;
- a finished assistant message (`role: assistant`, `message.*`, `display_text`) that
  extends the text so far;
- errors: an `error` member or `type`/`event_name` `error`;
- approvals: `approvals.snapshot` with `pending[]`, or an `approval` object with
  status pending.

Because the stream format is not confirmed, `chat_stream` also polls the history
every 1.5 s while the stream has produced no text, and after the stream ends. The
history is the source of truth: text it has beyond what was streamed is emitted, and
the turn ends when the stream has ended, no tool is running and the session status
is terminal (or unknown but text is present).

### History (`parse.parse_history`)

Everything that is not a user message belongs to the request (the session is ours).
From each event:

- tools/tasks: `type: "task"`, `delta.tool_call` / `delta.task`, or a payload of type
  `tool_call`/`task`, with an id and status; `running`/`queued`/`in_progress`/
  `working`/`starting`/`pending` count as active;
- media: `delta.presentation` payloads (`data.images[]`, `data.videos[]`, a direct
  `data.path/url`, or paths in `fallback_text`), skipping `missing` items, plus file
  paths mentioned in assistant text;
- assistant text: `display_text`, else the `text` items;
- pending approvals (as above).

Media paths are normalised to the VM path: `/fs/raw/<url-quoted>` →
`/<unquoted>`, `sandbox:///home/…` → `/home/…`; http(s) URLs are kept and fetched
directly. Paths that also appear in user messages (uploaded references) are never
results. The kind comes from the MIME type, the hint, or the extension; the
downloaded bytes must match it by magic number.

## 4. Media flow

1. Optional voice selection, then `POST /chat/stream` with the reference images and
   the prompt (`Generate an image|a video (aspect ratio …, N seconds long): …`, plus a
   note that the first image is the opening frame and the others references).
2. The stream is drained in the background (approvals denied, error events and a
   non-2xx status mapped as below).
3. Every 1.5 s: session status + history. Media of the requested kind is downloaded
   once the turn is terminal, no tool is running, or it has been visible for 8 s.
4. A terminal turn without media: failure wording is mapped (below); otherwise one
   neutral follow-up, *"Please attach the final {kind} file here in the chat, as a
   single attachment."*, is sent in the same session; a second text-only end →
   `UpstreamRefused`.
5. The timeout is soft (up to 2.5×) while a tool runs or the turn is not over, then
   `/chat/cancel` and `UpstreamTimeout`. A dropped socket is reconnected up to three
   times while waiting; the turn keeps running in the VM.

## 5. Error mapping

| Upstream | muse2api error |
|---|---|
| 401/403 from the cookie endpoints, 401 from the VM, missing session cookies | `UpstreamAuthError` |
| HTTP 429, or "out of credits", "usage limit", "weekly limit", "limit reached", "token limit", "quota exceeded/exhausted", `insufficient_quota` | `UpstreamQuotaError` |
| `video_daily_budget_exhausted`, "24-hour (video) limit", "daily video limit", "video limit for the last 24 hours" (video only) | `UpstreamKindBlocked(kind="video", reason="limit", until=<resets_at/retry_after in the error body, else now+24h>)` |
| `video_not_available`, "not available/supported in your region/country" (video only) | `UpstreamKindBlocked(kind="video", reason="region", until=now+7d)` |
| turn ended with text only (after the one follow-up) | `UpstreamRefused` |
| no reply / media in time | `UpstreamTimeout` |
| socket dropped, other statuses | `UpstreamError` (retryable) |

For chat, a final reply of at most 500 characters is also checked for the quota
wording (as the browser driver does), since longer answers may merely discuss limits.

## 6. Quota (`HttpDriver.quota`)

The web app's settings dialog calls a Next.js server action:

```
POST https://muse.ai/thread/new
Next-Action: <action id>
Accept: text/x-component
Content-Type: text/plain;charset=UTF-8

[{"includeAgreement":true}]
```

The answer is React Server Components lines (`<n>:<json>`); the one holding
`{"success": true, "subscription": {...}}` is used:

| subscription field | quota key |
|---|---|
| `tier.name` | `plan` |
| `usage.percentUsed` | `weekly_used_pct` (`found` is true when present) |
| `usage.resetsAt` (ms or s since epoch, or ISO) | `resets_at`, ISO-8601 UTC (the browser driver reports the page's display text instead) |
| `topupRowValueLabel`, else `topupBalance` | `extra_left` |
| `topupBalance` | `topup_balance` (only when present) |

plus `source: "http"` and `fetched_at`. The action id changes with every site
deploy, so it is discovered: fetch `/thread/new` (with the account's cookies), then
its `/_next/static/chunks/*.js` and the chunks they reference (at most 120, 8 at a
time) until one contains `"<hex id>" … "fetchSubscriptionAction"`. The id is shared by
all accounts and rediscovered when a call answers an error or no subscription.
Snapshots are cached per account for `MUSE2API_QUOTA_CACHE_S` (default 1800 s);
`forget_quota(account_id)` (used by `?refresh=1`) drops the cached one. A failed
lookup returns `found: false` with an `error` and is not cached.

## 7. Not implemented / open questions

- The real `/chat/stream` event vocabulary, the approval decision value, and whether
  `/api/session/list/<id>` is the right status endpoint all need a live check.
- `/chat/subscribe` (account-wide event feed) is not used.
- Sessions created by muse2api are not deleted afterwards.
- Proxies: HTTP calls follow `http_proxy`/`https_proxy`; the WebSocket uses the
  `websockets` library's own proxy handling (environment, websockets ≥ 15).
