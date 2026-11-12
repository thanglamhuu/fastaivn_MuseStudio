"""Đăng nhập muse.ai bằng email + mã OTP từ hộp thư (studio_emaillogin + /studio/login/email).
Không mạng: hộp thư giả bằng httpx.MockTransport, trang đăng nhập giả, Chrome không được mở (thay _run_login)."""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "muse2api" / "src"))

from fastapi.testclient import TestClient  # noqa: E402
from muse2api.accounts.model import Account  # noqa: E402
from muse2api.app import create_app  # noqa: E402
from muse2api.config import Settings  # noqa: E402
from muse2api.drivers.mock import MockDriver  # noqa: E402

import studio_api  # noqa: E402
import studio_emaillogin as el  # noqa: E402

KEY = "test-key"
AUTH = {"Authorization": f"Bearer {KEY}"}


def mail(mid: str, code: str, when: str) -> str:
    # Đúng khung HTML của generator.email (11/2026)
    return (f"<div onclick=\"loadInboxClientSide('dishow.net/user/{mid}')\" class=\"g8r list-group-item\">"
            f"<div class=\"g8r from_div_45g45gg\">notification@email.meta.com</div>"
            f"<div class=\"g8r subj_div_45g45gg\">Use code {code} to log in</div>"
            f"<div class=\"g8r time_div_45g45gg\">{when}</div></div>")


def inbox(*mails: str) -> str:
    return '<html><div id="email-table" class="g8r">' + "".join(mails) + "</div></html>"


def test_parse_lines():
    items = el.parse_lines(
        "# ghi chú\n"
        "Charles@Dishow.net | https://generator.email/charles@dishow.net\n"
        "\n"
        "b@x.io\thttps://mail.example/inbox/b\n"
        "c@x.io\n"
        "charles@dishow.net | trùng\n"
        "không có email\n")
    assert [(i.email, i.inbox_url) for i in items] == [
        ("charles@dishow.net", "https://generator.email/charles@dishow.net"),
        ("b@x.io", "https://mail.example/inbox/b"),
        ("c@x.io", "https://generator.email/c@x.io"),
    ]


def test_parse_inbox_newest_first_with_codes():
    page = inbox(mail("old", "273772", "2026-11-09 19:00:19"), mail("new", "229247", "2026-11-11 03:50:06"))
    mails = el.parse_inbox(page)
    assert [(m.id, m.code) for m in mails] == [("dishow.net/user/new", "229247"), ("dishow.net/user/old", "273772")]
    assert mails[0].sender == "notification@email.meta.com"
    # Trang hộp thư khác: quét mã trong chữ
    assert [m.code for m in el.parse_inbox("<p>Your verification code: 481516</p>")] == ["481516"]


def test_wait_new_code_ignores_mails_that_existed_before():
    pages = [inbox(mail("old", "111111", "2026-11-11 01:00:00"))] * 2 + \
            [inbox(mail("new", "222222", "2026-11-12 01:00:00"), mail("old", "111111", "2026-11-11 01:00:00"))]
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        page = pages[min(calls["n"], len(pages) - 1)]
        calls["n"] += 1
        return httpx.Response(200, text=page)

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
            known = {m.id for m in await el.fetch_inbox(c, "https://generator.email/u@d.net")}

            async def no_sleep(_):
                return None
            return await el.wait_new_code(el.HttpInbox(c, "https://generator.email/u@d.net"), known, sleep=no_sleep)

    assert asyncio.run(run()) == "222222"


def test_wait_new_code_times_out():
    t = {"now": 0.0}

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200, text=inbox()))) as c:
            async def fake_sleep(s):
                t["now"] += s
            await el.wait_new_code(el.HttpInbox(c, "https://x/i"), set(), timeout=20, poll=5, sleep=fake_sleep, clock=lambda: t["now"])

    with pytest.raises(TimeoutError):
        asyncio.run(run())


class FakePage:
    """Trang đăng nhập giả: ô email → (gửi) → ô mã; ghi lại thao tác."""

    def __init__(self):
        self.stage = "email"
        self.actions: list[str] = []

    async def state(self):
        return {"email": self.stage == "email", "code": 1 if self.stage == "code" else 0, "text": self.stage}

    async def click(self, pattern):
        self.actions.append(f"click:{pattern[:12]}")
        return ""

    async def enter_email(self, email):
        self.actions.append(f"email:{email}")
        return True

    async def submit(self):
        self.actions.append("submit")
        if self.stage == "email":
            self.stage = "code"

    async def enter_code(self, code):
        self.actions.append(f"code:{code}")
        self.stage = "done"
        return True


def test_auto_login_types_email_then_newest_code(monkeypatch):
    sent = {"code": False}

    def handler(request: httpx.Request) -> httpx.Response:
        old = mail("old", "111111", "2026-11-11 01:00:00")
        if not sent["code"]:
            return httpx.Response(200, text=inbox(old))
        return httpx.Response(200, text=inbox(mail("new", "654321", "2026-11-12 01:00:00"), old))

    page = FakePage()
    orig_submit = page.submit

    async def submit_and_send():
        await orig_submit()
        sent["code"] = True  # muse.ai gửi thư mã sau khi bấm Continue
    page.submit = submit_and_send

    async def quick(*_a, **_k):
        return None
    monkeypatch.setattr(el.asyncio, "sleep", quick)
    msgs: list[str] = []

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
            await el.auto_login(page, el.EmailLogin("u@d.net", "https://generator.email/u@d.net"), msgs.append, client=c)

    asyncio.run(run())
    assert page.actions[0] == "email:u@d.net" and "submit" in page.actions
    assert "code:654321" in page.actions and "code:111111" not in page.actions
    assert any("nhận mã 65" in m for m in msgs) and not any("654321" in m for m in msgs)  # không lộ đủ mã trong log


# ---------------------------------------------------------------- API
@pytest.fixture
def ctx(tmp_path, monkeypatch):
    settings = Settings(_env_file=None, data_dir=tmp_path / "data", api_key=KEY, driver="mock")
    app = create_app(settings, MockDriver(delay=0))
    app.include_router(studio_api.router)
    order: list[tuple[str, str | None]] = []

    async def fake_run_login(app_, job):  # không mở Chrome: ghi lại thứ tự rồi "thành công"
        order.append((job.email, job.account_id))
        await asyncio.sleep(0)
        job.status, job.message = "succeeded", "ok"
    monkeypatch.setattr(studio_api, "_run_login", fake_run_login)
    studio_api._jobs.clear()
    studio_api._batches.clear()
    with TestClient(app) as c:
        yield c, app, order


def test_email_login_batch_runs_accounts_in_order_and_reuses_existing(ctx):
    c, app, order = ctx
    existing = Account(label="TK cũ", meta={"email": "b@x.io"})
    asyncio.run(app.state.services.pool.upsert(existing))
    r = c.post("/studio/login/email", headers=AUTH,
               json={"text": "a@x.io | https://generator.email/a@x.io\nB@x.io"})
    assert r.status_code == 200, r.text
    bid = r.json()["id"]
    for _ in range(50):
        view = c.get(f"/studio/login/batch/{bid}", headers=AUTH).json()
        if view["finished"]:
            break
    assert view["succeeded"] == 2
    assert order == [("a@x.io", None), ("b@x.io", existing.id)]  # email trùng → đăng nhập lại TK cũ
    assert [j["email"] for j in view["jobs"]] == ["a@x.io", "b@x.io"]


def test_email_login_rejects_text_without_email(ctx):
    c, _, _ = ctx
    r = c.post("/studio/login/email", headers=AUTH, json={"text": "không có gì"})
    assert r.status_code == 400


class FakeCDP:
    """CDP giả: Input.insertText KHÔNG vào được ô (lỗi thật 12/11); gán bằng setter gốc thì vào."""

    def __init__(self, insert_works: bool):
        self.value = ""
        self.insert_works = insert_works
        self.sent: list[str] = []

    async def send(self, method, params=None, timeout=30.0):
        self.sent.append(method)
        if method == "Input.insertText" and self.insert_works:
            self.value = params["text"]
        return {}

    async def evaluate(self, expr, **_):
        tail = expr.rsplit("};", 1)[-1]  # phần thân sau các hàm phụ
        if "set.call" in tail:
            self.value = el.json.loads(tail.split("set.call(i, ", 1)[1].split(");", 1)[0])
            return self.value
        if "i.value : null" in tail:
            return self.value
        if "i.focus()" in tail:
            return True
        return None


@pytest.mark.parametrize("insert_works", [True, False])
def test_type_into_reads_back_and_falls_back_to_native_setter(monkeypatch, insert_works):
    async def quick(*_a, **_k):
        return None
    monkeypatch.setattr(el.asyncio, "sleep", quick)
    cdp = FakeCDP(insert_works)
    assert asyncio.run(el.LoginPage(cdp).enter_email("u@d.net")) is True
    assert cdp.value == "u@d.net" and "Page.bringToFront" in cdp.sent


def test_auto_login_retypes_when_page_dropped_the_email(monkeypatch):
    """Lần gửi đầu trang bỏ mất chữ (ô trống, vẫn ở biểu mẫu email) → gõ và gửi lại."""
    clock = {"t": 0.0}

    async def quick(s=0, *_a, **_k):
        clock["t"] += s or 1
    monkeypatch.setattr(el.asyncio, "sleep", quick)
    monkeypatch.setattr(el.time, "monotonic", lambda: clock["t"])

    class Flaky(FakePage):
        def __init__(self):
            super().__init__()
            self.submits = 0

        async def state(self):
            st = await super().state()
            st["emailValue"] = ""  # trang đã xóa chữ
            return st

        async def submit(self):
            self.submits += 1
            self.actions.append("submit")
            if self.submits >= 2:
                self.stage = "code"

    page = Flaky()

    def handler(request):
        if page.submits < 2:
            return httpx.Response(200, text=inbox())
        return httpx.Response(200, text=inbox(mail("n", "777777", "2026-11-12 02:00:00")))

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
            await el.auto_login(page, el.EmailLogin("u@d.net", "https://x/i"), lambda m: None, client=c)

    asyncio.run(run())
    assert page.actions.count("email:u@d.net") == 2 and "code:777777" in page.actions


class FakeTab:
    """Tab Chrome giả để đọc hộp thư: lần lượt trả các trang HTML, mỗi Page.reload sang trang kế."""

    def __init__(self, pages):
        self.pages, self.i, self.closed = pages, 0, False

    async def send(self, method, params=None, timeout=30.0):
        if method == "Page.reload":
            self.i = min(self.i + 1, len(self.pages) - 1)
        if method == "Page.close":
            self.closed = True
        return {}

    async def evaluate(self, expr, **_):
        return {"ready": "complete", "html": self.pages[self.i], "title": "Email Generator"}

    async def close(self):
        pass


def test_browser_inbox_reads_generator_page_and_reloads(monkeypatch):
    async def quick(*_a, **_k):
        return None
    monkeypatch.setattr(el.asyncio, "sleep", quick)
    tab = FakeTab([inbox(mail("a", "111111", "2026-11-12 01:00:00")),
                   inbox(mail("b", "222222", "2026-11-12 01:05:00"), mail("a", "111111", "2026-11-12 01:00:00"))])
    opened: list[str] = []

    async def open_tab(url):
        opened.append(url)
        return tab

    async def run():
        b = el.BrowserInbox(open_tab, "https://generator.email/u@d.net")
        first = await b.fetch()
        second = await b.fetch()
        await b.close()
        return first, second

    first, second = asyncio.run(run())
    assert opened == ["https://generator.email/u@d.net"]  # mở 1 tab, lần sau chỉ tải lại
    assert [m.code for m in first] == ["111111"] and second[0].code == "222222" and tab.closed


def test_fallback_inbox_uses_http_when_browser_fails():
    class Broken:
        async def fetch(self):
            raise RuntimeError("tab chết")

    async def run():
        page = inbox(mail("x", "333333", "2026-11-12 01:00:00"))
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200, text=page))) as c:
            return await el.FallbackInbox(Broken(), el.HttpInbox(c, "https://x/i")).fetch()

    assert asyncio.run(run())[0].code == "333333"


def test_wait_new_code_by_time_when_old_mails_unknown():
    page = inbox(mail("new", "444444", "2026-11-12 01:10:00"), mail("old", "555555", "2026-11-11 23:00:00"))

    class One:
        async def fetch(self):
            return el.parse_inbox(page)

    async def no_sleep(_):
        return None
    assert asyncio.run(el.wait_new_code(One(), None, since="2026-11-12 01:00:00", sleep=no_sleep)) == "444444"


def test_code_mail_caught_in_old_snapshot_is_still_taken_by_time():
    """Thư mã đến đúng lúc chụp danh sách cũ (id nằm trong known) nhưng thời gian sau lúc yêu cầu mã → vẫn nhận."""
    page = inbox(mail("race", "888888", "2026-11-12 01:10:05"))

    class One:
        async def fetch(self):
            return el.parse_inbox(page)

    async def no_sleep(_):
        return None
    got = asyncio.run(el.wait_new_code(One(), {"dishow.net/user/race"}, since="2026-11-12 01:10:00", sleep=no_sleep))
    assert got == "888888"


def test_auto_login_clicks_resend_when_code_mail_is_late(monkeypatch):
    clock = {"t": 0.0}

    async def quick(s=0, *_a, **_k):
        clock["t"] += s or 1
    monkeypatch.setattr(el.asyncio, "sleep", quick)
    monkeypatch.setattr(el.time, "monotonic", lambda: clock["t"])
    monkeypatch.setattr(el, "RESEND_AFTER_S", 30.0)
    monkeypatch.setattr(el, "INBOX_TIMEOUT_S", 100.0)

    page = FakePage()
    clicks: list[str] = []
    orig_click = page.click

    async def click(pattern):
        await orig_click(pattern)
        if "resend" in pattern:
            clicks.append("resend")
            return "Resend code"
        return ""
    page.click = click

    def handler(request):
        # Thư mã chỉ đến SAU khi bấm "Resend code"
        if not clicks:
            return httpx.Response(200, text=inbox())
        return httpx.Response(200, text=inbox(mail("late", "246810", "2000-01-01 00:00:00")))

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
            await el.auto_login(page, el.EmailLogin("u@d.net", "https://x/i"), lambda m: None, client=c)

    asyncio.run(run())
    assert clicks == ["resend"] and "code:246810" in page.actions
