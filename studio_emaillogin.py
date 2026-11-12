"""Đăng nhập muse.ai tự động bằng email + mã OTP đọc từ hộp thư công khai (vd. generator.email).

Người dùng dán mỗi dòng một tài khoản:
    charlesanderson275@dishow.net | https://generator.email/charlesanderson275@dishow.net
(thiếu link thì mặc định https://generator.email/<email>). studio_api._run_login mở cửa sổ Chrome đăng nhập như
bình thường rồi gọi ``auto_login`` để: gõ email → bấm Continue → chờ ô nhập mã → lấy mã trong thư MỚI NHẤT
(chỉ nhận thư xuất hiện sau khi yêu cầu mã, không dùng lại mã cũ) → gõ mã. Phần lấy cookie / xác minh phiên /
lưu tài khoản vẫn do vòng lặp có sẵn của _run_login làm. Bước nào không tự làm được thì người dùng hoàn tất
bằng tay trong chính cửa sổ đó (cửa sổ vẫn hiện).
"""

from __future__ import annotations

import asyncio
import contextlib
import html as htmllib
import json
import logging
import re
import time
from dataclasses import dataclass
from typing import Any, Callable
from urllib.parse import quote, unquote, urlsplit

import httpx

log = logging.getLogger("musestudio.emaillogin")

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
URL_RE = re.compile(r"https?://\S+")
# "Use code 229247 to log in", "Mã của bạn là 123456", "Your verification code: 123456"
CODE_RE = re.compile(r"(?:code|mã|otp|verification|xác (?:minh|nhận))[^0-9<>]{0,40}?\b(\d{4,8})\b", re.I)
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/130.0.0.0 Safari/537.36")

INBOX_TIMEOUT_S = 300.0  # chờ thư mã tối đa 5 phút (thư có khi đến chậm vài phút)
RESEND_AFTER_S = 100.0  # chưa có thư sau ngần này giây → bấm "Resend code"
RESEND_MAX = 2
INBOX_POLL_S = 10.0  # tải lại hộp thư mỗi 10 s (generator.email chặn khi bị hỏi dồn dập)
STEP_TIMEOUT_S = 60.0


# ---------------------------------------------------------------- dòng nhập
@dataclass
class EmailLogin:
    email: str
    inbox_url: str


def default_inbox_url(email: str) -> str:
    return f"https://generator.email/{quote(email, safe='@')}"


def parse_lines(text: str) -> list[EmailLogin]:
    """Mỗi dòng: ``email | link hộp thư`` (dấu | , ; tab hoặc khoảng trắng đều được); bỏ dòng trống / dòng # ghi chú;
    bỏ email trùng. Thiếu link → generator.email."""
    out: list[EmailLogin] = []
    seen: set[str] = set()
    for raw in (text or "").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        url_m = URL_RE.search(line)
        url = url_m.group(0).rstrip("|,;") if url_m else ""
        rest = line.replace(url, " ") if url else line
        em = EMAIL_RE.search(rest) or (EMAIL_RE.search(url) if url else None)
        if not em:
            continue
        email = em.group(0).lower()
        if email in seen:
            continue
        seen.add(email)
        out.append(EmailLogin(email=email, inbox_url=url or default_inbox_url(email)))
    return out


# ---------------------------------------------------------------- hộp thư
@dataclass
class Mail:
    id: str
    sender: str
    subject: str
    time: str
    code: str


def _text(s: str) -> str:
    return re.sub(r"\s+", " ", htmllib.unescape(re.sub(r"<[^>]+>", " ", s))).strip()


def parse_inbox(page: str) -> list[Mail]:
    """Danh sách thư (mới nhất trước) từ trang hộp thư. generator.email: mỗi thư là 1 khối
    ``loadInboxClientSide('<domain>/<user>/<id>')`` có người gửi / tiêu đề / thời gian. Trang khác: quét mã trong chữ."""
    mails: list[Mail] = []
    blocks = re.split(r"(?=<div[^>]*onclick=\"loadInboxClientSide\()", page)
    for b in blocks[1:]:
        mid = re.search(r"loadInboxClientSide\('([^']+)'\)", b)
        sender = re.search(r'class="[^"]*from_div[^"]*">(.*?)</div>', b, re.S)
        subj = re.search(r'class="[^"]*subj_div[^"]*">(.*?)</div>', b, re.S)
        when = re.search(r'class="[^"]*time_div[^"]*">(.*?)</div>', b, re.S)
        subject = _text(subj.group(1)) if subj else ""
        code = CODE_RE.search(subject)
        mails.append(Mail(id=mid.group(1) if mid else subject, sender=_text(sender.group(1)) if sender else "",
                          subject=subject, time=_text(when.group(1)) if when else "",
                          code=code.group(1) if code else ""))
    if mails:
        # Phòng khi trang không xếp mới nhất trước: xếp theo thời gian "YYYY-MM-DD HH:MM:SS" giảm dần
        if all(re.match(r"\d{4}-\d\d-\d\d", m.time) for m in mails):
            mails.sort(key=lambda m: m.time, reverse=True)
        return mails
    # Trang hộp thư khác: lấy các mã theo thứ tự xuất hiện (thường mới nhất ở trên)
    txt = _text(page)
    return [Mail(id=f"code:{c}", sender="", subject="", time="", code=c) for c in dict.fromkeys(CODE_RE.findall(txt))]


async def fetch_inbox(client: httpx.AsyncClient, url: str) -> list[Mail]:
    r = await client.get(url, headers={"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9",
                                       "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"},
                         follow_redirects=True)
    r.raise_for_status()
    return parse_inbox(r.text)


class HttpInbox:
    """Đọc hộp thư bằng httpx. generator.email hay chặn kiểu truy cập này (HTTP 503 liên tục, đo 12/11) → chỉ là dự phòng."""

    def __init__(self, client: httpx.AsyncClient, url: str) -> None:
        self.client, self.url = client, url

    async def fetch(self) -> list[Mail]:
        return await fetch_inbox(self.client, self.url)


class BrowserInbox:
    """Đọc hộp thư bằng một tab của chính cửa sổ Chrome đăng nhập (trình duyệt thật — không bị chặn như httpx).

    ``open_tab(url)`` mở tab mới và trả về CDPSession của tab đó. Mỗi lần đọc: tải lại tab, chờ trang xong, lấy HTML."""

    def __init__(self, open_tab: Callable[[str], Any], url: str) -> None:
        self.open_tab, self.url = open_tab, url
        self.cdp = None

    async def fetch(self) -> list[Mail]:
        if self.cdp is None:
            self.cdp = await self.open_tab(self.url)
        else:
            await self.cdp.send("Page.reload", {"ignoreCache": True}, timeout=15)
        deadline = time.monotonic() + 20
        html = ""
        while time.monotonic() < deadline:
            await asyncio.sleep(1.0)
            with contextlib.suppress(Exception):
                st = await self.cdp.evaluate(
                    "({ready: document.readyState, html: document.documentElement.outerHTML, "
                    "title: document.title})", timeout=10) or {}
                html = st.get("html") or ""
                if st.get("ready") == "complete" and ("email-table" in html or "loadInboxClientSide" in html
                                                      or CODE_RE.search(_text(html))):
                    break
                if st.get("ready") == "complete" and re.search(r"\b50[23]\b|too many requests", st.get("title", ""), re.I):
                    raise httpx.HTTPError(f"hộp thư báo lỗi: {st.get('title')}")
        return parse_inbox(html)

    async def close(self) -> None:
        if self.cdp is not None:
            with contextlib.suppress(Exception):
                await self.cdp.send("Page.close", timeout=5)
            with contextlib.suppress(Exception):
                await self.cdp.close()


def _iso_to_utc(s: str) -> str:
    """"2026-11-12T03:06:32.314Z" → "2026-11-12 03:06:32" (UTC, cùng dạng so sánh với ``since``)."""
    m = re.match(r"(\d{4}-\d\d-\d\d)[T ](\d\d:\d\d:\d\d)", s or "")
    return f"{m.group(1)} {m.group(2)}" if m else ""


LOGIN_SUBJECT_RE = re.compile(r"log ?in|sign ?in|đăng nhập|security code|login code|use code", re.I)


class ApiInbox:
    """Hộp thư chung cho cả tên miền, có API JSON theo email (vd. ``http://mail.monteam.net:8025`` —
    "Meta & Muse Login OTP Viewer"): ``GET <gốc>/api/email/<tên miền>/<tên>/?page=1&limit=20`` →
    ``{"emails": [{"id","to","from","subject","otp","body","created_at"}]}``. Link không chứa email nên lấy email ở đầu dòng."""

    def __init__(self, client: httpx.AsyncClient, url: str, email: str) -> None:
        sp = urlsplit(url)
        self.base = f"{sp.scheme or 'http'}://{sp.netloc}"
        self.client, self.email = client, email.lower()

    async def fetch(self) -> list[Mail]:
        user, _, dom = self.email.partition("@")
        r = await self.client.get(f"{self.base}/api/email/{quote(dom)}/{quote(user)}/",
                                  params={"page": 1, "limit": 20}, headers={"User-Agent": UA, "Accept": "application/json"})
        r.raise_for_status()
        try:
            data = r.json()
        except ValueError as exc:
            raise httpx.HTTPError("hộp thư không có API JSON") from exc
        if not isinstance(data, dict) or not isinstance(data.get("emails"), list):
            raise httpx.HTTPError("hộp thư không có API JSON")
        mails: list[Mail] = []
        for e in data["emails"]:
            if not isinstance(e, dict) or (e.get("to") and str(e["to"]).lower() != self.email):
                continue
            subject = str(e.get("subject") or "")
            code = str(e.get("otp") or "").strip()
            if not re.fullmatch(r"\d{4,8}", code):
                m = CODE_RE.search(subject) or CODE_RE.search(_text(str(e.get("body") or ""))[:3000])
                code = m.group(1) if m else ""
            mails.append(Mail(id=str(e.get("id") or subject + str(e.get("created_at"))), sender=str(e.get("from") or ""),
                              subject=subject, time=_iso_to_utc(str(e.get("created_at") or "")), code=code))
        mails.sort(key=lambda m: m.time, reverse=True)
        # Hộp thư có cả thư Meta khác kèm mã ("Did you just remove your email address?", đổi email…) → thư đăng nhập lên trước
        return sorted(mails, key=lambda m: 0 if LOGIN_SUBJECT_RE.search(m.subject) else 1)


class FormInbox(BrowserInbox):
    """Trang xem mã kiểu "dán email → bấm Get OTP" mà không có API: mở trang trong tab Chrome, ĐIỀN EMAIL vào ô, bấm nút lấy mã
    rồi đọc mã trên trang (mỗi lần đọc: điền lại + bấm lại)."""

    def __init__(self, open_tab: Callable[[str], Any], url: str, email: str) -> None:
        super().__init__(open_tab, url)
        self.email = email

    async def fetch(self) -> list[Mail]:
        if self.cdp is None:
            self.cdp = await self.open_tab(self.url)
            await asyncio.sleep(2.5)
        page = LoginPage(self.cdp)
        filled = await page._type_into(
            "inputs().find((i) => !['hidden','checkbox','radio','password','submit','button'].includes(i.type))", self.email)
        if not filled:
            raise httpx.HTTPError("trang hộp thư không có ô nhập email")
        if not await page.click(r"get ?otp|get code|check|fetch|search|refresh|xem|lấy|tìm|kiểm tra"):
            await page._enter()
        await asyncio.sleep(3.0)
        html = await self.cdp.evaluate("document.documentElement.outerHTML", timeout=10) or ""
        return parse_inbox(html)


def email_in_url(url: str, email: str) -> bool:
    return email.lower() in unquote(url or "").lower()


def make_inbox(item: EmailLogin, client: httpx.AsyncClient, open_tab: Callable[[str], Any] | None = None):
    """Chọn cách đọc hộp thư theo link:
    - link chứa email (generator.email/<email>): tab Chrome (không bị chặn) → httpx dự phòng;
    - link KHÔNG chứa email (hộp thư chung cả tên miền, vd. http://mail.monteam.net:8025): API JSON theo email → nếu không có
      API thì mở trang, điền email vào ô, bấm lấy mã (cần tab Chrome) → cuối cùng đọc chữ trên trang bằng httpx."""
    if email_in_url(item.inbox_url, item.email):
        return FallbackInbox(BrowserInbox(open_tab, item.inbox_url) if open_tab else None, HttpInbox(client, item.inbox_url))
    return FallbackInbox(ApiInbox(client, item.inbox_url, item.email),
                         FormInbox(open_tab, item.inbox_url, item.email) if open_tab else None,
                         HttpInbox(client, item.inbox_url))  # cuối cùng: đọc chữ trên trang, quét mã


class FallbackInbox:
    """Thử lần lượt các cách đọc hộp thư; cách nào lỗi thì dùng cách sau."""

    def __init__(self, *sources) -> None:
        self.sources = [s for s in sources if s is not None]

    async def fetch(self) -> list[Mail]:
        last: Exception | None = None
        for s in self.sources:
            try:
                return await s.fetch()
            except Exception as exc:  # noqa: BLE001
                last = exc
                log.info("đọc hộp thư bằng %s lỗi: %s", type(s).__name__, exc)
        raise httpx.HTTPError(f"không đọc được hộp thư ({last})")

    async def close(self) -> None:
        for s in self.sources:
            if hasattr(s, "close"):
                with contextlib.suppress(Exception):
                    await s.close()


async def wait_new_code(inbox, known: set[str] | None, *,
                        timeout: float = INBOX_TIMEOUT_S, poll: float = INBOX_POLL_S,
                        on_wait: Callable[[float, str], None] | None = None,
                        since: str = "", sleep=None, clock=None) -> str:
    """Chờ thư CÓ MÃ chưa có trong ``known`` (thư đã có trước khi yêu cầu mã) → trả mã của thư mới nhất.
    Không chụp được danh sách thư cũ (``known`` = None) thì nhận thư có thời gian ≥ ``since`` ("YYYY-MM-DD HH:MM:SS", UTC)."""
    sleep = sleep or asyncio.sleep  # tra lúc gọi (không gắn cứng lúc định nghĩa) để test giả lập được thời gian
    clock = clock or time.monotonic
    deadline = clock() + timeout
    seen = "chưa đọc được hộp thư"
    while True:
        with contextlib.suppress(httpx.HTTPError):
            mails = await inbox.fetch()
            for m in mails:
                if not m.code:
                    continue
                # Thư mới = chưa có lúc chụp danh sách cũ, HOẶC có thời gian từ lúc yêu cầu mã trở đi
                # (phòng thư đến đúng lúc đang chụp nên lọt vào danh sách cũ)
                if (known is not None and m.id not in known) or (since and m.time and m.time >= since):
                    return m.code
            seen = f"hộp thư {len(mails)} thư" + (f", mới nhất {mails[0].time}" if mails and mails[0].time else "")
        left = deadline - clock()
        if left <= 0:
            raise TimeoutError(f"không thấy thư mã mới trong {timeout:.0f} giây ({seen})")
        if on_wait:
            on_wait(left, seen)
        await sleep(min(poll, left))


# ---------------------------------------------------------------- điều khiển trang đăng nhập
# JS tìm phần tử trên trang đăng nhập (muse.ai / Meta). Viết theo nhiều kiểu để chịu được đổi giao diện.
_JS_HELPERS = r"""
const vis = (e) => !!e && e.offsetParent !== null && !e.disabled;
const txt = (e) => ((e.innerText || e.value || e.getAttribute('aria-label') || '') + '').trim();
const inputs = () => [...document.querySelectorAll('input')].filter(vis);
const emailInput = () => inputs().find((i) => i.type === 'email' || /username|email/i.test(i.autocomplete || '')
  || /email|mobile|số điện thoại|phone/i.test((i.getAttribute('aria-label') || '') + ' ' + (i.placeholder || '') + ' ' + (i.name || '')));
const codeInputs = () => {
  const all = inputs().filter((i) => !['hidden', 'checkbox', 'radio', 'email', 'password'].includes(i.type));
  const otp = all.filter((i) => /one-time-code/i.test(i.autocomplete || '')
    || /code|mã|otp|verification/i.test((i.getAttribute('aria-label') || '') + ' ' + (i.placeholder || '') + ' ' + (i.name || '') + ' ' + (i.id || '')));
  if (otp.length) return otp;
  const singles = all.filter((i) => i.maxLength === 1);
  if (singles.length >= 4) return singles;
  return all.filter((i) => (i.inputMode === 'numeric' || i.type === 'tel' || i.type === 'number') && !emailInput());
};
const buttons = () => [...document.querySelectorAll('button,[role=button],a[role=link],input[type=submit]')].filter(vis);
const findBtn = (re) => buttons().find((b) => re.test(txt(b)))
  // Liên kết dạng chữ trong câu ("… sent to you@x.com. Resend code") không phải <button>: tìm phần tử lá có chữ khớp
  || [...document.querySelectorAll('a,span,div,[role=link],[tabindex]')].filter(vis)
       .find((e) => !e.querySelector('a,span,div,button') && re.test(((e.innerText || '') + '').trim()));
"""


def _js(body: str) -> str:
    return "(() => {" + _JS_HELPERS + body + "})()"


class LoginPage:
    """Thao tác trang đăng nhập qua CDP của chính tab đó."""

    def __init__(self, cdp) -> None:
        self.cdp = cdp

    async def state(self) -> dict[str, Any]:
        return await self.cdp.evaluate(_js(r"""
          const pw = inputs().some((i) => i.type === 'password');
          const e = emailInput();
          return {url: location.href, ready: document.readyState === 'complete', email: !!e, emailValue: e ? e.value : '',
                  code: codeInputs().length, password: pw,
                  text: (document.body && document.body.innerText || '').slice(0, 400)};
        """), timeout=10) or {}

    async def _type_into(self, target_js: str, text: str) -> bool:
        """Gõ ``text`` vào ô do ``target_js`` (biểu thức JS trả về phần tử) chỉ ra, rồi ĐỌC LẠI để chắc chữ đã vào ô.

        Lỗi thật 12/11: gõ bằng Input.insertText khi cửa sổ Chrome chưa được đưa lên trước / trang đang dựng lại
        biểu mẫu → ô email vẫn trống, bấm Continue không có tác dụng. Nên: đưa cửa sổ lên trước, gõ, đọc lại; chưa vào
        thì gán bằng setter gốc của input + phát sự kiện input/change (React nhận), đọc lại lần nữa."""
        with contextlib.suppress(Exception):
            await self.cdp.send("Page.bringToFront", timeout=5)
        focus = f"const i = ({target_js}); if (!i) return false; i.focus(); i.select && i.select(); return true;"
        if not await self.cdp.evaluate(_js(focus), timeout=10):
            return False
        # insertText = gõ như người dùng (React nhận sự kiện input), khác với gán .value
        await self.cdp.send("Input.insertText", {"text": text}, timeout=10)
        await asyncio.sleep(0.4)
        read = f"const i = ({target_js}); return i ? i.value : null;"
        if await self.cdp.evaluate(_js(read), timeout=10) == text:
            return True
        native = (
            f"const i = ({target_js}); if (!i) return null; i.focus();"
            "const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;"
            f"set.call(i, {json.dumps(text)});"
            "i.dispatchEvent(new Event('input', {bubbles: true})); i.dispatchEvent(new Event('change', {bubbles: true}));"
            "return i.value;"
        )
        await self.cdp.evaluate(_js(native), timeout=10)
        await asyncio.sleep(0.4)
        return await self.cdp.evaluate(_js(read), timeout=10) == text

    async def _enter(self) -> None:
        for t in ("keyDown", "keyUp"):
            await self.cdp.send("Input.dispatchKeyEvent", {"type": t, "key": "Enter", "code": "Enter",
                                                           "windowsVirtualKeyCode": 13, "nativeVirtualKeyCode": 13},
                                timeout=10)

    async def click(self, pattern: str) -> str:
        """Bấm nút có chữ khớp regex (JS); trả về chữ của nút đã bấm, rỗng nếu không thấy."""
        return await self.cdp.evaluate(_js(
            f"const b = findBtn(new RegExp({json.dumps(pattern)}, 'i')); if (!b) return ''; b.click(); return txt(b).slice(0, 40);"
        ), timeout=10) or ""

    async def submit(self) -> None:
        # Ưu tiên nút gửi của CHÍNH biểu mẫu đang nhập (trang chủ muse.ai có nút "Log in" ở thanh đầu đứng trước
        # nút "Continue" của biểu mẫu → bấm theo chữ dễ bấm nhầm), rồi tới chữ Continue / Verify…, "Log in" xét cuối.
        done = await self.cdp.evaluate(_js(r"""
          const a = document.activeElement; const f = a && (a.form || a.closest && a.closest('form'));
          const s = f && [...f.querySelectorAll('button[type=submit],input[type=submit],button:not([type])')].find(vis);
          if (s) { s.click(); return txt(s).slice(0, 40) || 'submit'; }
          return '';
        """), timeout=10)
        if done:
            return
        for pat in (r"^(continue|next|submit|verify|confirm|tiếp tục|tiếp|xác nhận|xác minh|gửi)$",
                    r"^(log ?in|sign ?in|đăng nhập)$"):
            if await self.click(pat):
                return
        await self._enter()

    async def enter_email(self, email: str) -> bool:
        return await self._type_into("emailInput()", email)

    async def enter_code(self, code: str) -> bool:
        # Ô mã tách 4-8 ô 1 ký tự: gõ từng ô (đọc lại từng ô)
        n = await self.cdp.evaluate(_js("return codeInputs().length;"), timeout=10) or 0
        if n >= 4:
            return all([await self._type_into(f"codeInputs()[{k}]", ch) for k, ch in enumerate(code)])
        return await self._type_into("codeInputs()[0]", code)


async def _wait_for(check: Callable[[], Any], timeout: float, step: float = 1.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        with contextlib.suppress(Exception):
            if v := await check():
                return v
        await asyncio.sleep(step)
    return None


async def auto_login(page: LoginPage, item: EmailLogin, report: Callable[[str], None],
                     client: httpx.AsyncClient | None = None, inbox=None) -> None:
    """Gõ email, yêu cầu mã, đọc mã từ thư mới, gõ mã. Ném lỗi (chữ tiếng Việt) nếu một bước không làm được.
    ``inbox``: cách đọc hộp thư (studio_api truyền tab Chrome + httpx dự phòng); không truyền thì dùng httpx."""
    own = client is None
    client = client or httpx.AsyncClient(timeout=20, trust_env=False)
    inbox = inbox or make_inbox(item, client)
    try:
        # Thư đang có TRƯỚC khi yêu cầu mã → bỏ qua (chỉ nhận mã của thư mới đến). Hộp thư tạm thời không đọc được
        # (generator.email hay trả 503) thì nhận thư có thời gian từ lúc yêu cầu mã trở đi (giờ UTC, lùi 2 phút cho lệch giờ).
        known: set[str] | None = None
        for attempt in range(3):
            try:
                known = {m.id for m in await inbox.fetch()}
                break
            except httpx.HTTPError as exc:
                report(f"{item.email}: chưa mở được hộp thư ({str(exc)[:60]}) — thử lại…")
                await asyncio.sleep(4)

        report(f"{item.email}: đang mở trang đăng nhập…")

        async def email_ready():
            st = await page.state()
            # Chờ trang tải xong hẳn: gõ khi trang còn đang dựng biểu mẫu thì chữ bị xóa mất
            if st.get("email") and st.get("ready", True):
                return True
            if st.get("ready", True) and not st.get("email"):
                # Trang chủ chưa hiện ô email → bấm "Log in"
                await page.click(r"^(log ?in|sign ?in|đăng nhập)$")
            return False

        if not await _wait_for(email_ready, STEP_TIMEOUT_S, 2.0):
            raise RuntimeError("không thấy ô nhập email trên trang đăng nhập")
        await asyncio.sleep(1.5)  # trang vừa tải xong còn chạy script dựng biểu mẫu

        async def send_email() -> None:
            if not await page.enter_email(item.email):
                raise RuntimeError("không gõ được email vào ô (ô vẫn trống sau 2 cách gõ)")
            await asyncio.sleep(0.5)
            await page.submit()

        # Mốc thời gian yêu cầu mã (giờ UTC như generator.email; lùi 30 s phòng lệch giờ máy — không lùi nhiều để
        # lần thử lại liền sau không nhận nhầm mã của lần trước)
        since = time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(time.time() - 30))
        await send_email()
        report(f"{item.email}: đã gửi email, chờ trang nhập mã…")
        resent = {"n": 0, "at": time.monotonic()}

        async def code_ready():
            st = await page.state()
            if st.get("code"):
                return True
            # Vẫn ở biểu mẫu email mà ô trống / chưa chuyển trang sau 8 s → gõ và gửi lại (tối đa 2 lần)
            waited = time.monotonic() - resent["at"]
            emptied = (st.get("emailValue") or "") != item.email
            if st.get("email") and resent["n"] < 2 and ((emptied and waited > 8) or waited > 20):
                resent["n"] += 1
                resent["at"] = time.monotonic()
                report(f"{item.email}: trang chưa nhận email → gõ và gửi lại (lần {resent['n'] + 1})…")
                await send_email()
                return False
            # Tài khoản có mật khẩu / trang hỏi cách xác minh → chọn nhận mã qua email
            await page.click(r"(send|get|email).{0,20}code|code.{0,20}(email|instead)|try another way|another way|"
                             r"gửi mã|nhận mã|mã qua email|cách khác")
            return False

        if not await _wait_for(code_ready, STEP_TIMEOUT_S, 2.0):
            st = await page.state()
            raise RuntimeError("không thấy ô nhập mã sau khi gửi email" + (f" — trang: {st.get('text', '')[:120]}" if st else ""))

        report(f"{item.email}: chờ thư mã mới trong {item.inbox_url} …")
        # Thư mã có khi đến chậm vài phút (lỗi thật 12/11: larrythomas — app hết 180 s chờ, thư đến sau, mã vẫn dùng được)
        # → chờ từng đợt RESEND_AFTER_S, chưa có thư thì bấm "Resend code" (tối đa RESEND_MAX lần), tổng tối đa INBOX_TIMEOUT_S.
        code = ""
        t0 = time.monotonic()
        for round_ in range(RESEND_MAX + 1):
            left_total = INBOX_TIMEOUT_S - (time.monotonic() - t0)
            if left_total <= 0:
                break
            try:
                code = await wait_new_code(
                    inbox, known, since=since, timeout=min(RESEND_AFTER_S, left_total) if round_ < RESEND_MAX else left_total,
                    on_wait=lambda left, seen: report(
                        f"{item.email}: chờ thư mã (còn {INBOX_TIMEOUT_S - (time.monotonic() - t0):.0f} s; {seen})…"))
                break
            except TimeoutError as exc:
                if round_ >= RESEND_MAX or INBOX_TIMEOUT_S - (time.monotonic() - t0) <= 5:
                    raise TimeoutError(f"không thấy thư mã mới sau {INBOX_TIMEOUT_S:.0f} giây — {exc}") from None
                clicked = await page.click(r"resend|send (a )?new code|send again|gửi lại")
                report(f"{item.email}: chưa có thư mã → {'đã bấm gửi lại mã' if clicked else 'không thấy nút gửi lại, chờ tiếp'}…")
        if not code:
            raise TimeoutError(f"không thấy thư mã mới sau {INBOX_TIMEOUT_S:.0f} giây")
        report(f"{item.email}: nhận mã {code[:2]}•••• — đang nhập…")
        if not await page.enter_code(code):
            raise RuntimeError("không gõ được mã vào ô nhập mã")
        await asyncio.sleep(1.0)
        # Nhiều trang tự gửi khi đủ số; còn ô mã thì bấm nút xác nhận
        if (await page.state()).get("code"):
            await page.submit()
        report(f"{item.email}: đã nhập mã, chờ muse.ai đăng nhập xong…")
        # Màn hình phụ sau khi đăng nhập ("Continue", "Not now"…): bấm qua trong 60 giây đầu
        for _ in range(12):
            await asyncio.sleep(5)
            with contextlib.suppress(Exception):
                await page.click(r"^(continue|not now|skip|ok|done|tiếp tục|để sau|bỏ qua|xong)$")
    finally:
        if own:
            await client.aclose()
