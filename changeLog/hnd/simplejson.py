# -*- coding: utf-8 -*-
"""
HND Muse AI — License Verification & Enforcement Engine
Loaded automatically by HND-Muse-AI-Tool.exe at startup.
"""
import base64
import ctypes
from ctypes import wintypes
from datetime import date, datetime
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import ssl
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
import zlib

_GUARD_ATTR = "_hnd_license_hook_installed"

if not getattr(sys, _GUARD_ATTR, False):
    setattr(sys, _GUARD_ATTR, True)

    def _ensure_single_visible_instance():
        """Nếu cổng 5680 đang bị giữ bởi một tiến trình HND-Muse-AI-Tool chạy ngầm (không có cửa sổ hiển thị),
        tự động giải phóng tiến trình ngầm đó để mở cửa sổ mới; nếu cửa sổ đang hiển thị thì đưa lên tiền cảnh."""
        try:
            import socket
            import subprocess
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(0.25)
                in_use = (s.connect_ex(("127.0.0.1", 5680)) == 0)
            if in_use:
                user32 = ctypes.windll.user32
                for title in ("HND Muse AI       ", "HND Muse AI"):
                    hwnd = user32.FindWindowW(None, title)
                    if hwnd and user32.IsWindowVisible(hwnd):
                        if user32.IsIconic(hwnd):
                            user32.ShowWindow(hwnd, 9)  # SW_RESTORE
                        else:
                            user32.ShowWindow(hwnd, 5)  # SW_SHOW
                        user32.SetForegroundWindow(hwnd)
                        os._exit(0)
                # Cổng 5680 đang bị giữ bởi tiến trình chạy ẩn không có cửa sổ -> giải phóng ngay
                my_pid = os.getpid()
                subprocess.run(
                    ["taskkill", "/F", "/FI", f"PID ne {my_pid}", "/IM", "HND-Muse-AI-Tool.exe"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    creationflags=0x08000000,
                    timeout=4,
                )
                time.sleep(0.5)
        except Exception:
            pass



    _ensure_single_visible_instance()

    def read_windows_clipboard_text() -> str:
        """Đọc trực tiếp nội dung text từ Windows Clipboard qua Win32 API (không bị chặn bởi quyền trình duyệt)."""
        try:
            user32 = ctypes.windll.user32
            kernel32 = ctypes.windll.kernel32
            user32.OpenClipboard.argtypes = [wintypes.HWND]
            user32.OpenClipboard.restype = wintypes.BOOL
            user32.GetClipboardData.argtypes = [wintypes.UINT]
            user32.GetClipboardData.restype = wintypes.HANDLE
            user32.CloseClipboard.argtypes = []
            user32.CloseClipboard.restype = wintypes.BOOL
            kernel32.GlobalLock.argtypes = [wintypes.HGLOBAL]
            kernel32.GlobalLock.restype = ctypes.c_void_p
            kernel32.GlobalUnlock.argtypes = [wintypes.HGLOBAL]
            kernel32.GlobalUnlock.restype = wintypes.BOOL

            for _ in range(5):
                if user32.OpenClipboard(None):
                    try:
                        h_data = user32.GetClipboardData(13)  # CF_UNICODETEXT = 13
                        if h_data:
                            ptr = kernel32.GlobalLock(h_data)
                            if ptr:
                                try:
                                    return ctypes.wstring_at(ptr).strip()
                                finally:
                                    kernel32.GlobalUnlock(h_data)
                    finally:
                        user32.CloseClipboard()
                    break
                time.sleep(0.02)
        except Exception:
            pass
        return ""



    _APP_NAMESPACE = "HN-MUSE-STUDIO-PRO-V1"
    _DPAPI_ENTROPY = b"HN-MUSE-STUDIO-PRO::DPAPI-ENTROPY::2026"
    # Base64 encoded endpoint (never expose management URL in UI or plain strings)
    _ENDPOINT_PARTS = (
        "aHR0cHM6Ly9uZ2hpYS1t",
        "bW8udmVyY2VsLmFwcC9h",
        "cGkva2V5cw==",
    )
    _HTTP_HEADERS = {
        "Accept": "application/json",
        "Cache-Control": "no-cache",
        "User-Agent": "HNDMuseAI/1.0",
    }

    _BASE_DIR = Path(__file__).resolve().parent
    _DATA_DIR = _BASE_DIR / "data"
    _STORAGE_PATH = _DATA_DIR / "license.dat"

    def _clean_all_chrome_profiles_prefs(remove_cdp_port: bool = False):
        """Đánh dấu thoát sạch cho toàn bộ profile Chrome tài khoản Muse & Web2API để không hiện bảng Restore pages."""
        try:
            import re as _re
            chrome_root = _DATA_DIR / "chrome"
            if not chrome_root.is_dir():
                return
            for prof_dir in chrome_root.iterdir():
                if not prof_dir.is_dir():
                    continue
                if remove_cdp_port:
                    try:
                        pfile = prof_dir / "cdp_port"
                        if pfile.is_file():
                            pfile.unlink(missing_ok=True)
                    except Exception:
                        pass
                try:
                    pref_file = prof_dir / "Default" / "Preferences"
                    if pref_file.is_file():
                        txt = pref_file.read_text(encoding="utf-8", errors="ignore")
                        txt2 = _re.sub(r'"exit_type"\s*:\s*"[^"]*"', '"exit_type":"Normal"', txt)
                        txt2 = _re.sub(r'"exited_cleanly"\s*:\s*false', '"exited_cleanly":true', txt2)
                        if txt2 != txt:
                            pref_file.write_text(txt2, encoding="utf-8")
                except Exception:
                    pass
        except Exception:
            pass

    def _kill_all_hnd_browsers_now():
        """Đóng ngay lập tức toàn bộ Chrome/Edge của tài khoản Muse AI (data\chrome\*) và Gemini/GPT Web2API."""
        if os.name != "nt":
            return
        import subprocess as _sp
        my_pid = os.getpid()
        launcher_exe = _BASE_DIR / "HND Muse AI.exe"
        if launcher_exe.is_file():
            try:
                _sp.run(
                    [str(launcher_exe), "--kill-browsers", str(my_pid)],
                    stdout=_sp.DEVNULL,
                    stderr=_sp.DEVNULL,
                    creationflags=0x08000000,
                    timeout=3,
                )
            except Exception:
                pass
        try:
            ps_kill = (
                "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe' OR Name='msedge.exe'\" | Where-Object { "
                "$c = [string]$_.CommandLine; $cn = $c.ToLowerInvariant().Replace('/', '\\'); "
                "$cn.Contains('\\data\\chrome\\') -or $cn.Contains('hnd_web2api') -or $cn.Contains('59222') -or $cn.Contains('\\data\\appwindow') "
                "} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
            )
            _sp.run(
                ["powershell", "-NoProfile", "-WindowStyle", "Hidden", "-Command", ps_kill],
                stdout=_sp.DEVNULL,
                stderr=_sp.DEVNULL,
                creationflags=0x08000000,
                timeout=3,
            )
        except Exception:
            pass
        _clean_all_chrome_profiles_prefs(remove_cdp_port=True)

    def _install_global_browser_exit_guard():
        """Gắn đa tầng bảo vệ đóng sạch toàn bộ Chrome Muse + Web2API ngay khi đóng tool."""
        if "--multiprocessing-fork" in sys.argv:
            return
        if getattr(sys, "_hnd_global_browser_guard_installed", False):
            return
        setattr(sys, "_hnd_global_browser_guard_installed", True)

        _clean_all_chrome_profiles_prefs(remove_cdp_port=False)

        import atexit as _atexit
        _atexit.register(_kill_all_hnd_browsers_now)

        _orig_exit = getattr(os, "_exit", None)
        if _orig_exit and not getattr(os, "_hnd_os_exit_wrapped", False):
            def _wrapped_exit(code=0):
                try:
                    _kill_all_hnd_browsers_now()
                except Exception:
                    pass
                return _orig_exit(code)
            setattr(os, "_hnd_os_exit_wrapped", True)
            os._exit = _wrapped_exit

        def _spawn_watchdogs_and_bind_window():
            import subprocess as _sp
            my_pid = os.getpid()
            # 1. Native C# Watchdog (0% CPU, phản hồi 200ms khi cửa sổ đóng hoặc tiến trình tắt)
            launcher_exe = _BASE_DIR / "HND Muse AI.exe"
            if launcher_exe.is_file():
                try:
                    _sp.Popen(
                        [str(launcher_exe), "--watchdog", str(my_pid)],
                        cwd=str(_BASE_DIR),
                        stdout=_sp.DEVNULL,
                        stderr=_sp.DEVNULL,
                        creationflags=0x08000000,
                        close_fds=True,
                    )
                except Exception:
                    pass

            # 2. PowerShell OS Watchdog dự phòng
            try:
                ps_wd = (
                    f"Wait-Process -Id {my_pid} -ErrorAction SilentlyContinue; "
                    "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe' OR Name='msedge.exe'\" | Where-Object { "
                    "$c = [string]$_.CommandLine; $cn = $c.ToLowerInvariant().Replace('/', '\\'); "
                    "$cn.Contains('\\data\\chrome\\') -or $cn.Contains('hnd_web2api') -or $cn.Contains('59222') -or $cn.Contains('\\data\\appwindow') "
                    "} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
                )
                _sp.Popen(
                    ["powershell", "-NoProfile", "-WindowStyle", "Hidden", "-Command", ps_wd],
                    stdout=_sp.DEVNULL,
                    stderr=_sp.DEVNULL,
                    creationflags=0x08000000,
                    close_fds=True,
                )
            except Exception:
                pass

            # 3. Gắn trực tiếp vào sự kiện đóng cửa sổ pywebview (closing & closed)
            for _ in range(45):
                try:
                    wv = sys.modules.get("webview")
                    if wv and getattr(wv, "windows", None):
                        win = wv.windows[0]
                        if hasattr(win, "events"):
                            def _on_win_closing(*_a, **_kw):
                                try:
                                    _kill_all_hnd_browsers_now()
                                except Exception:
                                    pass
                            def _on_win_closed(*_a, **_kw):
                                try:
                                    _kill_all_hnd_browsers_now()
                                except Exception:
                                    pass
                                try:
                                    os._exit(0)
                                except Exception:
                                    pass
                            if hasattr(win.events, "closing"):
                                win.events.closing += _on_win_closing
                            if hasattr(win.events, "closed"):
                                win.events.closed += _on_win_closed
                            break
                except Exception:
                    pass
                time.sleep(0.5)

        threading.Thread(target=_spawn_watchdogs_and_bind_window, name="HndGlobalBrowserExitGuard", daemon=True).start()

    _install_global_browser_exit_guard()

    def _license_api_url() -> str:
        encoded = "".join(_ENDPOINT_PARTS).encode("ascii")
        return base64.b64decode(encoded).decode("utf-8")

    def _read_windows_machine_guid() -> str:
        if os.name != "nt":
            return ""
        try:
            import winreg
            access = winreg.KEY_READ | getattr(winreg, "KEY_WOW64_64KEY", 0)
            with winreg.OpenKey(
                winreg.HKEY_LOCAL_MACHINE,
                r"SOFTWARE\Microsoft\Cryptography",
                0,
                access,
            ) as key:
                value, _ = winreg.QueryValueEx(key, "MachineGuid")
                return str(value).strip()
        except OSError:
            return ""

    def get_machine_id() -> str:
        raw = _read_windows_machine_guid()
        if not raw:
            raw = f"{platform.node()}|{uuid.getnode():012x}"
        digest = hashlib.sha256(f"{_APP_NAMESPACE}|{raw}".encode("utf-8")).hexdigest().upper()
        groups = [digest[i:i + 4] for i in range(0, 16, 4)]
        return "HNMS-" + "-".join(groups)

    _INITIAL_MID = get_machine_id()
    _lock = threading.Lock()
    _license_state = {
        "checked": False,
        "valid": False,
        "ok": False,
        "code": "no_key",
        "reason": "NO_KEY",
        "message": "Gửi Machine ID cho Admin để kích hoạt key, sau đó nhập key vào ô bên dưới.",
        "key": "",
        "masked_key": "",
        "machine_id": _INITIAL_MID,
        "device": _INITIAL_MID,
        "expiration": "",
        "expiry": "",
        "checked_at": 0.0,
    }

    # Synchronously inject disk static assets (index.html, style.css, app.js, i18n.js) + Machine ID into qtstudio._bundle!
    _BUNDLE_STAMP = f"hnd_{_INITIAL_MID[-4:].lower()}_{int(time.time())}"
    _HND_APP_VERSION = "1.2"
    def _inject_mid_into_html(html_text: str) -> str:
        s = str(html_text or "")
        s = s.replace('value="Đang lấy Machine ID..."', f'value="{_INITIAL_MID}"')
        s = re.sub(
            r'(<input[^>]*\bid="g-device"[^>]*\bvalue=")[^"]*(")',
            rf"\g<1>{_INITIAL_MID}\2",
            s,
        )
        s = s.replace(
            "Đang kiểm tra trạng thái bản quyền...",
            "Gửi Machine ID cho Admin để kích hoạt key, sau đó nhập key vào ô bên dưới.",
        )
        return s

    def _patch_bundled_html_sync():
        try:
            for _m_name in ("qtstudio", "qtstudio.config", "qtstudio.api", "qtstudio.updater"):
                _m_obj = sys.modules.get(_m_name)
                if _m_obj is not None and hasattr(_m_obj, "VERSION"):
                    try:
                        setattr(_m_obj, "VERSION", _HND_APP_VERSION)
                    except Exception:
                        pass
            b_mod = sys.modules.get("qtstudio._bundle")
            if b_mod is None:
                import qtstudio._bundle as b_mod
            static_dir = _BASE_DIR / "qtstudio" / "static"
            disk_html = static_dir / "index.html"
            if disk_html.is_file():
                dh = _inject_mid_into_html(disk_html.read_text(encoding="utf-8"))
                if b_mod and hasattr(b_mod, "FILES"):
                    b_mod.FILES["static/index.html"] = zlib.compress(dh.encode("utf-8"), 9)
            elif b_mod and hasattr(b_mod, "FILES") and "static/index.html" in b_mod.FILES:
                raw_html = _inject_mid_into_html(zlib.decompress(b_mod.FILES["static/index.html"]).decode("utf-8"))
                b_mod.FILES["static/index.html"] = zlib.compress(raw_html.encode("utf-8"), 9)

            if b_mod and hasattr(b_mod, "FILES"):
                for asset_name in ("style.css", "app.js", "i18n.js", "workflow.css", "workflow.js"):
                    asset_path = static_dir / asset_name
                    if asset_path.is_file():
                        raw_bytes = asset_path.read_bytes()
                        if asset_name == "style.css":
                            wf_css_p = static_dir / "workflow.css"
                            if wf_css_p.is_file():
                                raw_bytes = raw_bytes + b"\n" + wf_css_p.read_bytes()
                        elif asset_name == "app.js":
                            wf_js_p = static_dir / "workflow.js"
                            if wf_js_p.is_file():
                                raw_bytes = raw_bytes + b"\n;\n" + wf_js_p.read_bytes()
                        b_mod.FILES[f"static/{asset_name}"] = zlib.compress(raw_bytes, 9)
                b_mod.STAMP = _BUNDLE_STAMP

            bundle_wrapper = sys.modules.get("qtstudio.bundle")
            if bundle_wrapper:
                if hasattr(bundle_wrapper, "STAMP"):
                    bundle_wrapper.STAMP = _BUNDLE_STAMP
                if hasattr(bundle_wrapper, "_cache"):
                    bundle_wrapper._cache.clear()
            api_m = sys.modules.get("qtstudio.api")
            if api_m and hasattr(api_m, "STAMP"):
                api_m.STAMP = _BUNDLE_STAMP
        except Exception:
            pass

    _patch_bundled_html_sync()

    class _DATA_BLOB(ctypes.Structure):
        _fields_ = [
            ("cbData", ctypes.c_ulong),
            ("pbData", ctypes.POINTER(ctypes.c_ubyte)),
        ]

    def _to_blob(data: bytes):
        buf = (ctypes.c_ubyte * len(data)).from_buffer_copy(data)
        return buf, _DATA_BLOB(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_ubyte)))

    def _dpapi_transform(data: bytes, *, protect: bool) -> bytes:
        crypt32 = ctypes.windll.crypt32
        kernel32 = ctypes.windll.kernel32
        crypt32.CryptProtectData.argtypes = [
            ctypes.POINTER(_DATA_BLOB),
            wintypes.LPCWSTR,
            ctypes.POINTER(_DATA_BLOB),
            ctypes.c_void_p,
            ctypes.c_void_p,
            wintypes.DWORD,
            ctypes.POINTER(_DATA_BLOB),
        ]
        crypt32.CryptProtectData.restype = wintypes.BOOL
        crypt32.CryptUnprotectData.argtypes = [
            ctypes.POINTER(_DATA_BLOB),
            ctypes.c_void_p,
            ctypes.POINTER(_DATA_BLOB),
            ctypes.c_void_p,
            ctypes.c_void_p,
            wintypes.DWORD,
            ctypes.POINTER(_DATA_BLOB),
        ]
        crypt32.CryptUnprotectData.restype = wintypes.BOOL
        kernel32.LocalFree.argtypes = [ctypes.c_void_p]
        kernel32.LocalFree.restype = ctypes.c_void_p

        src_buf, src_blob = _to_blob(data)
        ent_buf, ent_blob = _to_blob(_DPAPI_ENTROPY)
        dst = _DATA_BLOB()
        flags = 0x01  # CRYPTPROTECT_UI_FORBIDDEN
        if protect:
            ok = crypt32.CryptProtectData(
                ctypes.byref(src_blob), None, ctypes.byref(ent_blob), None, None, flags, ctypes.byref(dst)
            )
        else:
            ok = crypt32.CryptUnprotectData(
                ctypes.byref(src_blob), None, ctypes.byref(ent_blob), None, None, flags, ctypes.byref(dst)
            )
        _ = (src_buf, ent_buf)
        if not ok:
            raise ctypes.WinError()
        try:
            return ctypes.string_at(dst.pbData, dst.cbData)
        finally:
            kernel32.LocalFree(dst.pbData)

    def save_license_key(license_key: str, machine_id: str, expiration: str = "") -> None:
        _DATA_DIR.mkdir(parents=True, exist_ok=True)
        payload = json.dumps(
            {
                "key": license_key.strip(),
                "machine_id": machine_id,
                # Lưu kèm hạn dùng đã xác thực để cho phép mở offline tới đúng ngày hết hạn,
                # không phải nhập/kích hoạt lại mỗi lần khi tạm thời không gọi được máy chủ.
                "expiration": (expiration or "").strip(),
                "validated_at": time.time(),
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        
        encrypted = _dpapi_transform(payload, protect=True)
        tmp = _STORAGE_PATH.with_name(_STORAGE_PATH.name + ".tmp")
        tmp.write_bytes(base64.b64encode(encrypted))
        os.replace(tmp, _STORAGE_PATH)

    def load_license_record(machine_id: str) -> dict:
        if not _STORAGE_PATH.is_file():
            return {}
        try:
            encrypted = base64.b64decode(_STORAGE_PATH.read_bytes(), validate=True)
            payload = json.loads(_dpapi_transform(encrypted, protect=False).decode("utf-8"))
            if not isinstance(payload, dict) or payload.get("machine_id") != machine_id:
                return {}
            return payload
        except Exception:
            return {}

    def load_license_key(machine_id: str) -> str:
        rec = load_license_record(machine_id)
        return str(rec.get("key") or "").strip()

    def clear_license_key() -> None:
        try:
            if _STORAGE_PATH.is_file():
                _STORAGE_PATH.unlink()
        except Exception:
            pass

    def _fetch_license_rows(timeout: float = 12.0) -> list:
        req = urllib.request.Request(_license_api_url(), headers=_HTTP_HEADERS, method="GET")
        cafile = _BASE_DIR / "certifi" / "cacert.pem"
        try:
            ctx = ssl.create_default_context(cafile=str(cafile)) if cafile.is_file() else ssl.create_default_context()
        except Exception:
            ctx = ssl._create_unverified_context()
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
                raw = resp.read().decode("utf-8")
        except urllib.error.URLError:
            try:
                ctx_fallback = ssl._create_unverified_context()
                with urllib.request.urlopen(req, timeout=timeout, context=ctx_fallback) as resp:
                    raw = resp.read().decode("utf-8")
            except urllib.error.URLError as exc:
                raise ConnectionError("network_error") from exc
        data = json.loads(raw)
        rows = data.get("keys") if isinstance(data, dict) else None
        if not isinstance(rows, list):
            raise ValueError("invalid_response")
        return [r for r in rows if isinstance(r, dict)]

    def _field(record: dict, *names: str) -> str:
        for n in names:
            v = record.get(n)
            if v is not None:
                return str(v).strip()
        return ""

    def _parse_expiration(value: str) -> date:
        cleaned = (value or "").strip()
        for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
            try:
                return datetime.strptime(cleaned, fmt).date()
            except ValueError:
                continue
        raise ValueError("invalid_expiration")

    def validate_license_remote(license_key: str, machine_id: str) -> dict:
        key = (license_key or "").strip()
        machine = (machine_id or "").strip()
        if not key:
            return {
                "valid": False,
                "code": "empty_key",
                "message": "Vui lòng nhập key kích hoạt do Admin cấp.",
                "expiration": "",
            }
        if not machine:
            return {
                "valid": False,
                "code": "missing_machine",
                "message": "Không xác định được Machine ID của máy.",
                "expiration": "",
            }
        try:
            rows = _fetch_license_rows()
        except ConnectionError:
            return {
                "valid": False,
                "code": "network_error",
                "message": "Không thể kết nối máy chủ kích hoạt. Vui lòng kiểm tra kết nối Internet rồi thử lại.",
                "expiration": "",
            }
        except Exception:
            return {
                "valid": False,
                "code": "invalid_response",
                "message": "Máy chủ kích hoạt trả về dữ liệu không hợp lệ. Vui lòng liên hệ Admin.",
                "expiration": "",
            }

        wanted = key.casefold()
        record = None
        for r in rows:
            if _field(r, "licenseKey", "license_key", "key").casefold() == wanted:
                record = r
                break

        if record is None:
            return {
                "valid": False,
                "code": "not_found",
                "message": "Key không tồn tại hoặc đã bị xóa. Vui lòng liên hệ Admin.",
                "expiration": "",
            }

        assigned_machine = _field(record, "machineId", "machine_id")
        if not assigned_machine:
            return {
                "valid": False,
                "code": "unassigned",
                "message": "Key chưa được gắn Machine ID. Hãy gửi Machine ID này cho Admin để kích hoạt.",
                "expiration": "",
            }
        if assigned_machine.casefold() != machine.casefold():
            return {
                "valid": False,
                "code": "machine_mismatch",
                "message": "Key này không được cấp cho Machine ID của máy tính này.",
                "expiration": "",
            }

        status = _field(record, "status")
        if status.casefold() != "active":
            return {
                "valid": False,
                "code": "inactive",
                "message": "Key đã bị khóa hoặc tạm ngưng hoạt động. Vui lòng liên hệ Admin.",
                "expiration": "",
            }

        try:
            exp_date = _parse_expiration(_field(record, "expiration", "expiresAt", "expires_at"))
        except ValueError:
            return {
                "valid": False,
                "code": "invalid_expiration",
                "message": "Ngày hết hạn của key không hợp lệ. Vui lòng liên hệ Admin.",
                "expiration": "",
            }

        exp_str = exp_date.strftime("%d/%m/%Y")
        if exp_date < date.today():
            return {
                "valid": False,
                "code": "expired",
                "message": f"Key đã hết hạn ({exp_str}). Vui lòng liên hệ Admin để gia hạn.",
                "expiration": exp_str,
            }

        return {
            "valid": True,
            "code": "active",
            "message": f"Kích hoạt thành công. Key còn hạn đến {exp_str}.",
            "expiration": exp_str,
        }

    def _mask_key(k: str) -> str:
        k = (k or "").strip()
        if len(k) <= 8:
            return k
        return k[:6] + "****" + k[-4:]

    def _offline_grace_ok(expiration: str) -> bool:
        """True nếu key đã lưu vẫn còn hạn theo ngày hết hạn đã xác thực trước đó."""
        try:
            return _parse_expiration(expiration) >= date.today()
            # return _parse_expiration(expiration) >=  date(2028, 1, 1)
        except ValueError:
            return False

    def refresh_saved_license() -> dict:
        mid = get_machine_id()
        rec = load_license_record(mid)
        saved = str(rec.get("key") or "").strip()
        cached_exp = str(rec.get("expiration") or "").strip()
        if not saved:
            with _lock:
                _license_state.update({
                    "checked": True,
                    "valid": False,
                    "ok": False,
                    "code": "no_key",
                    "reason": "NO_KEY",
                    "message": "Gửi Machine ID cho Admin để kích hoạt key, sau đó nhập key vào ô bên dưới.",
                    "key": "",
                    "masked_key": "",
                    "machine_id": mid,
                    "device": mid,
                    "expiration": "",
                    "expiry": "",
                    "checked_at": time.time(),
                })
                return dict(_license_state)


        # Không gọi được máy chủ (mất mạng / server tạm lỗi): nếu key đã lưu vẫn còn hạn
        # theo lần xác thực gần nhất thì cho mở luôn, khỏi phải nhập/kích hoạt lại.
        if  _offline_grace_ok(cached_exp):
            with _lock:
                _license_state.update({
                    "checked": True,
                    "valid": True,
                    "ok": True,
                    "code": "active_offline",
                    "reason": "OK",
                    "message": f"Đang dùng bản quyền đã lưu (còn hạn đến {cached_exp}). Sẽ tự kiểm tra lại khi có mạng.",
                    "key": saved,
                    "masked_key": _mask_key(saved),
                    "machine_id": mid,
                    "device": mid,
                    "expiration": cached_exp,
                    "expiry": cached_exp,
                    "checked_at": time.time(),
                })
                return dict(_license_state)

        if res["code"] in ("not_found", "expired", "inactive", "machine_mismatch"):
            try:
                api_mod = sys.modules.get("qtstudio.api")
                if api_mod and hasattr(api_mod, "runner"):
                    api_mod.runner.stop()
            except Exception:
                pass

        exp_val = res.get("expiration", "")
        # Xác thực online thành công: cập nhật lại hạn dùng đã lưu để lần sau mở offline được.
        if res["valid"]:
            try:
                save_license_key(saved, mid, exp_val)
            except Exception:
                pass
        with _lock:
            _license_state.update({
                "checked": True,
                "valid": bool(res["valid"]),
                "ok": bool(res["valid"]),
                "code": res["code"],
                "reason": "OK" if res["valid"] else res["code"].upper(),
                "message": res["message"],
                "key": saved,
                "masked_key": _mask_key(saved),
                "machine_id": mid,
                "device": mid,
                "expiration": exp_val,
                "expiry": exp_val,
                "checked_at": time.time(),
            })
            return dict(_license_state)

    def activate_with_key(raw_key: str) -> dict:
        mid = get_machine_id()
        clean_key = (raw_key or "").strip()
        res = validate_license_remote(clean_key, mid)
        if res["valid"]:
            try:
                save_license_key(clean_key, mid, res.get("expiration", ""))
            except Exception:
                pass
        exp_val = res.get("expiration", "")
        with _lock:
            _license_state.update({
                "checked": True,
                "valid": bool(res["valid"]),
                "ok": bool(res["valid"]),
                "code": res["code"],
                "reason": "OK" if res["valid"] else res["code"].upper(),
                "message": res["message"],
                "key": clean_key if res["valid"] else _license_state.get("key", ""),
                "masked_key": _mask_key(clean_key) if res["valid"] else _license_state.get("masked_key", ""),
                "machine_id": mid,
                "device": mid,
                "expiration": exp_val,
                "expiry": exp_val,
                "checked_at": time.time(),
            })
            return dict(_license_state)

    def deactivate_current_key() -> dict:
        clear_license_key()
        mid = get_machine_id()
        with _lock:
            _license_state.update({
                "checked": True,
                "valid": False,
                "ok": False,
                "code": "no_key",
                "reason": "NO_KEY",
                "message": "Đã gỡ key trên máy này. Vui lòng nhập key mới để tiếp tục sử dụng.",
                "key": "",
                "masked_key": "",
                "machine_id": mid,
                "device": mid,
                "expiration": "",
                "expiry": "",
                "checked_at": time.time(),
            })
            return dict(_license_state)

    def get_current_status() -> dict:
        with _lock:
            if not _license_state.get("machine_id"):
                m = get_machine_id()
                _license_state["machine_id"] = m
                _license_state["device"] = m
            return dict(_license_state)

    def _install_fastapi_hooks():
        # Wait for qtstudio.license and qtstudio.api to finish loading
        for _ in range(200):
            lic_mod = sys.modules.get("qtstudio.license")
            if lic_mod is not None and hasattr(lic_mod, "status"):
                lic_mod.device_id = get_machine_id
                lic_mod.check_saved = refresh_saved_license
                lic_mod.activate = activate_with_key
                lic_mod.deactivate = deactivate_current_key
                lic_mod.status = get_current_status
            api_mod = sys.modules.get("qtstudio.api")
            if api_mod is not None and hasattr(api_mod, "app"):
                break
            time.sleep(0.01)
        else:
            return

        _patch_bundled_html_sync()

        lic_mod = sys.modules.get("qtstudio.license")
        if lic_mod is not None:
            lic_mod.device_id = get_machine_id
            lic_mod.check_saved = refresh_saved_license
            lic_mod.activate = activate_with_key
            lic_mod.deactivate = deactivate_current_key
            lic_mod.status = get_current_status

        app = api_mod.app
        from fastapi import Request
        from fastapi.responses import JSONResponse
        import importlib.util
        import types
        import traceback

        # =====================================================================
        # HND Account Session Diagnostics (Read-Only Informational Tracker)
        # Chỉ hiển thị chẩn đoán trong cột "Phiên" (Dính quốc gia 403 / Limit 24h
        # / Nghẽn chưa tắt luồng + đồng hồ đếm ngược). TUYỆT ĐỐI KHÔNG tự khoá
        # hay tự tắt bất kỳ tài khoản nào.
        # =====================================================================
        _ACCOUNT_DIAG_FILE = _DATA_DIR / "account_video_diag.json"
        _diag_lock = threading.RLock()
        _diag_state = {
            "loaded": False,
            "last_log_id": 0,
            "accounts": {},
            "seen_running": {},  # {acc_id: {session_id: first_seen_ts}}
        }

        def _default_acc_diag() -> dict:
            return {
                "region_403": False,
                "region_403_at": 0.0,
                "region_403_reason": "",
                "limit_24h_at": 0.0,
                "limit_24h_until": 0.0,
                "limit_24h_reason": "",
                "congested_at": 0.0,
                "congested_until": 0.0,
                "congested_reason": "",
                "unclosed_threads": 0,
                "unclosed_until": 0.0,
                "muse_running_threads": 0,
                "last_video_ok_at": 0.0,
                "cleared_at": 0.0,
                "updated_at": 0.0,
            }

        def _ensure_diag_loaded():
            with _diag_lock:
                if _diag_state["loaded"]:
                    return
                _diag_state["loaded"] = True
                try:
                    if _ACCOUNT_DIAG_FILE.is_file():
                        saved = json.loads(_ACCOUNT_DIAG_FILE.read_text(encoding="utf-8"))
                        if isinstance(saved, dict):
                            accs = saved.get("accounts")
                            if isinstance(accs, dict):
                                for k, v in accs.items():
                                    if isinstance(v, dict):
                                        d = _default_acc_diag()
                                        d.update(v)
                                        _diag_state["accounts"][str(k)] = d
                            _diag_state["last_log_id"] = int(saved.get("last_log_id") or 0)
                except Exception:
                    pass

        def _save_diag_state():
            try:
                with _diag_lock:
                    payload = {
                        "last_log_id": int(_diag_state.get("last_log_id") or 0),
                        "accounts": _diag_state.get("accounts") or {},
                        "saved_at": time.time(),
                    }
                    tmp_p = _ACCOUNT_DIAG_FILE.with_suffix(".json.tmp")
                    tmp_p.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
                    os.replace(str(tmp_p), str(_ACCOUNT_DIAG_FILE))
            except Exception:
                pass

        def _get_acc_diag_entry(aid: str) -> dict:
            _ensure_diag_loaded()
            entry = _diag_state["accounts"].get(aid)
            if entry is None:
                entry = _default_acc_diag()
                _diag_state["accounts"][aid] = entry
            return entry

        def _parse_24h_unlock_ts(text: str, base_ts: float):
            """Trích xuất thời điểm mở lại tạo video (Unix seconds) từ thông báo lỗi 24h của Muse."""
            s = str(text or "")
            # 1) Kiểm tra trường JSON timestamp / retry_after
            for m in re.finditer(r'"(?:reset_at|resets_at|unlock_at)"\s*:\s*([0-9]+(?:\.[0-9]+)?)', s, re.I):
                try:
                    val = float(m.group(1))
                    if val > 1e12:
                        val /= 1000.0
                    if base_ts < val <= base_ts + 172800:
                        return val, True
                except Exception:
                    pass
            for m in re.finditer(r'"(?:retry_after|retry_after_seconds)"\s*:\s*([0-9]+(?:\.[0-9]+)?)', s, re.I):
                try:
                    sec = float(m.group(1))
                    if 60 <= sec <= 172800:
                        return base_ts + sec, True
                except Exception:
                    pass
            # 2) Kiểm tra cụm từ thời gian tự nhiên (EN / VI): "in X hours Y minutes", "sau X giờ Y phút"
            m_hm = re.search(
                r'(?:in|after|sau|còn|wait|chờ|đợi)\s+(\d{1,2})\s*(?:hours?|hrs?|giờ|tiếng|h)\b(?:\s*(?:and|và)?\s*(\d{1,2})\s*(?:minutes?|mins?|phút|p|m)\b)?',
                s,
                re.I,
            )
            if m_hm:
                hrs = int(m_hm.group(1) or 0)
                mins = int(m_hm.group(2) or 0)
                if 0 < (hrs * 3600 + mins * 60) <= 172800:
                    return base_ts + hrs * 3600.0 + mins * 60.0, True
            m_min = re.search(
                r'(?:in|after|sau|còn|wait|chờ|đợi)\s+(\d{2,4})\s*(?:minutes?|mins?|phút)\b',
                s,
                re.I,
            )
            if m_min:
                mins = int(m_min.group(1) or 0)
                if 10 <= mins <= 2880:
                    return base_ts + mins * 60.0, True
            # Mặc định rolling 24h của Muse/Meta = 86400 giây kể từ lúc chạm giới hạn
            return base_ts + 86400.0, False

        def _classify_muse_diag_text(text: str, base_ts: float = 0.0):
            """Phân loại chính xác 3 nhóm lỗi tài khoản Muse:
            1. region_403: Dính quốc gia / chặn cứng 403 không tạo được video
            2. limit_24h: Bị giới hạn tạo video 24h (kèm mốc đếm ngược)
            3. congested: Tài khoản bị nghẽn luồng / treo luồng chưa tắt (kèm mốc đếm ngược)"""
            s = str(text or "").strip()
            if not s:
                return None
            low = s.lower()
            ts = float(base_ts or time.time())

            # Bỏ qua các dòng log thông tin hạn mức tuần bình thường
            if "] hạn mức:" in low or "giới hạn hàng tuần sẽ đặt lại" in low:
                return None

            # --- NHÓM 1: DÍNH QUỐC GIA / CHẶN CỨNG VIDEO 403 ---
            is_403_region = (
                "video_not_available" in low
                or bool(re.search(r"\b403\b.*?(?:video|imagine_media|generate_video|quốc gia|khu vực|country|region|cấp tài khoản)", low))
                or bool(re.search(r"(?:video|imagine_media|generate_video).*?\b403\b", low))
                or bool(re.search(r"video\s+generation\s+(?:isn't|is\s+not|not)\s+available", low))
                or bool(re.search(r"(?:isn't|is\s+not|not)\s+available\s+in\s+your\s+(?:country|region)", low))
                or "không khả dụng cho tài khoản này ở khu vực" in low
                or bool(re.search(r"(?:bị\s+chặn|chặn\s+cứng).*?(?:cấp\s+tài\s+khoản|khu\s+vực|quốc\s+gia)", low))
                or ("giới hạn cố định" in low and "không phải lỗi tạm thời" in low)
                or "không gọi lại generate_video" in low
            )
            if is_403_region:
                return {
                    "type": "region_403",
                    "at": ts,
                    "reason": "Chặn 403 quốc gia / tài khoản (chỉ tạo được Ảnh)",
                }

            # --- NHÓM 2: GIỚI HẠN TẠO VIDEO 24H ---
            is_limit_24h = (
                bool(re.search(r"\b429\b.*?(?:video|imagine_media|generate|limit|rate|too\s+many|muse|quá\s+nhiều)", low))
                or bool(re.search(r"(?:video|imagine_media|generate_video).*?\b429\b", low))
                or bool(re.search(r"rate[_\s-]?limit(?:ed|_exceeded)?", low))
                or bool(re.search(r"too[_\s-]?many[_\s-]?(?:requests|videos|generations)", low))
                or bool(re.search(r"daily\s+(?:video\s+)?(?:generation\s+)?limit", low))
                or bool(re.search(r"(?:reached|hit|exceeded)\s+(?:your\s+|the\s+)?(?:daily|24[-\s]*hour|24h|video)\s+(?:generation\s+)?limit", low))
                or "limit for today" in low
                or "try again tomorrow" in low
                or "quay lại vào ngày mai" in low
                or "thử lại vào ngày mai" in low
                or bool(re.search(r"(?:24\s*-?\s*hour|24\s*h\b|24\s*giờ|24\s*tiếng).*?(?:limit|giới\s+hạn|video|try\s+again|thử\s+lại|chờ|đợi|hết\s+lượt)", low))
                or bool(re.search(r"(?:limit|giới\s+hạn|hết\s+lượt|đạt\s+giới\s+hạn|vượt\s+quá\s+giới\s+hạn|tạm\s+giới\s+hạn).*?(?:24\s*h\b|24\s*giờ|24\s*tiếng|24\s*-?\s*hour|trong\s+ngày|hôm\s+nay|tạo\s+video\s+trong\s+ngày)", low))
            )
            if is_limit_24h:
                unlock_at, parsed_exact = _parse_24h_unlock_ts(s, ts)
                return {
                    "type": "limit_24h",
                    "at": ts,
                    "unlock_at": unlock_at,
                    "parsed_exact": parsed_exact,
                    "reason": "Đạt giới hạn tạo Video 24h",
                }

            # --- NHÓM 3: NGHẼN CHƯA TẮT LUỒNG / NGHẼN PHIÊN NHẬN LỆNH ---
            if '"send_failed"' in low or "reason': 'send_failed'" in low or "send_failed" in low:
                return {
                    "type": "congested",
                    "at": ts,
                    "congested_until": ts + 300.0,
                    "reason": "Nghẽn gửi lệnh (luồng cũ trên Muse chưa tắt)",
                }
            if "gatewayrequesterror" in low or "subscription stream reset" in low or "session not found" in low:
                return {
                    "type": "congested",
                    "at": ts,
                    "congested_until": ts + 300.0,
                    "reason": "Nghẽn luồng kết nối Muse VM (stream reset)",
                }
            if "timed out during opening handshake" in low or "máy ảo muse chưa dậy" in low:
                return {
                    "type": "congested",
                    "at": ts,
                    "congested_until": ts + 300.0,
                    "reason": "Máy ảo Muse đang nghẽn / chờ khởi động lại",
                }
            if re.search(r"quá\s+\d+\s+giây\s+chưa\s+có\s+kết\s+quả", low):
                return {
                    "type": "congested",
                    "at": ts,
                    "congested_until": ts + 420.0,
                    "reason": "Luồng tạo bị treo quá hạn chưa tắt trên Muse",
                }
            if (
                "too many concurrent" in low
                or "concurrent generation" in low
                or "another generation is in progress" in low
                or "đang có yêu cầu khác đang xử lý" in low
            ):
                return {
                    "type": "congested",
                    "at": ts,
                    "congested_until": ts + 300.0,
                    "reason": "Nghẽn quá tải luồng đồng thời trên Muse",
                }
            return None

        def _apply_classified_diag(aid: str, cls_info: dict, save: bool = True) -> bool:
            if not aid or not isinstance(cls_info, dict):
                return False
            changed = False
            with _diag_lock:
                d = _get_acc_diag_entry(aid)
                ev_ts = float(cls_info.get("at") or time.time())
                if ev_ts <= float(d.get("cleared_at") or 0.0):
                    return False
                if ev_ts < float(d.get("last_video_ok_at") or 0.0):
                    return False

                kind = cls_info.get("type")
                if kind == "region_403":
                    if not d.get("region_403") or ev_ts > float(d.get("region_403_at") or 0.0):
                        d["region_403"] = True
                        d["region_403_at"] = ev_ts
                        d["region_403_reason"] = str(cls_info.get("reason") or "Chặn 403 quốc gia / tài khoản")
                        d["updated_at"] = time.time()
                        changed = True
                elif kind == "limit_24h":
                    new_until = float(cls_info.get("unlock_at") or (ev_ts + 86400.0))
                    cur_until = float(d.get("limit_24h_until") or 0.0)
                    # Giữ nguyên mốc 24h đầu tiên nếu đang trong chu kỳ 24h (tránh việc thử lại làm cộng dồn thêm 24h),
                    # trừ khi Muse trả về thời gian mở lại chính xác (parsed_exact=True).
                    if cur_until <= ev_ts or bool(cls_info.get("parsed_exact")):
                        d["limit_24h_at"] = ev_ts
                        d["limit_24h_until"] = new_until
                        d["limit_24h_reason"] = str(cls_info.get("reason") or "Đạt giới hạn tạo Video 24h")
                        d["updated_at"] = time.time()
                        changed = True
                elif kind == "congested":
                    new_until = float(cls_info.get("congested_until") or (ev_ts + 300.0))
                    if new_until > float(d.get("congested_until") or 0.0):
                        d["congested_at"] = ev_ts
                        d["congested_until"] = new_until
                        d["congested_reason"] = str(cls_info.get("reason") or "Nghẽn luồng trên Muse")
                        d["updated_at"] = time.time()
                        changed = True
            if changed and save:
                _save_diag_state()
            return changed

        def _mark_account_video_ok(aid: str, ok_ts: float = 0.0, save: bool = True) -> bool:
            if not aid:
                return False
            ts = float(ok_ts or time.time())
            changed = False
            with _diag_lock:
                d = _get_acc_diag_entry(aid)
                if ts >= float(d.get("last_video_ok_at") or 0.0):
                    d["last_video_ok_at"] = ts
                    if d.get("region_403") or float(d.get("limit_24h_until") or 0.0) > 0 or float(d.get("congested_until") or 0.0) > 0:
                        changed = True
                    d["region_403"] = False
                    d["region_403_reason"] = ""
                    d["limit_24h_until"] = 0.0
                    d["limit_24h_reason"] = ""
                    d["congested_until"] = 0.0
                    d["congested_reason"] = ""
                    d["updated_at"] = time.time()
            if changed and save:
                _save_diag_state()
            return changed

        def _record_account_diag_from_error(aid: str, err, task_row=None):
            try:
                if not aid or err is None:
                    return
                err_txt = str(err)
                cls_info = _classify_muse_diag_text(err_txt, time.time())
                if cls_info is not None:
                    # Nếu tác vụ là tạo ảnh ('image') thì không gắn nhầm lỗi 403 video
                    t_kind = ""
                    if isinstance(task_row, dict):
                        t_kind = str(task_row.get("kind") or "")
                    if t_kind == "image" and cls_info.get("type") in ("region_403", "limit_24h"):
                        return
                    _apply_classified_diag(aid, cls_info, save=True)
            except Exception:
                pass

        def _get_local_running_count_for_acc(aid: str) -> int:
            try:
                runner_inst = getattr(api_mod, "runner", None)
                if runner_inst is not None and hasattr(runner_inst, "active_meta"):
                    return sum(
                        1
                        for m in list(runner_inst.active_meta.values())
                        if (m[0] if isinstance(m, (tuple, list)) else m.get("account_id")) == aid
                    )
            except Exception:
                pass
            return 0

        def _get_video_timeout_setting() -> float:
            try:
                db_mod = sys.modules.get("qtstudio.db")
                conn = getattr(db_mod, "_conn", None) if db_mod else None
                if conn is not None:
                    row = conn.execute("SELECT value FROM settings WHERE key='video_timeout'").fetchone()
                    if row and row[0]:
                        return max(120.0, min(1800.0, float(row[0])))
            except Exception:
                pass
            return 600.0

        def _update_diag_from_muse_sessions(aid: str, sessions_list):
            """Cập nhật số luồng đang treo (status=='running') trên máy ảo Muse so với số tác vụ local đang chạy."""
            try:
                if not aid or not isinstance(sessions_list, list):
                    return
                now_ts = time.time()
                running_items = [s for s in sessions_list if isinstance(s, dict) and s.get("status") == "running"]
                local_cnt = _get_local_running_count_for_acc(aid)
                orphan_cnt = max(0, len(running_items) - local_cnt)
                v_timeout = _get_video_timeout_setting()

                with _diag_lock:
                    seen_map = _diag_state["seen_running"].setdefault(aid, {})
                    cur_ids = set()
                    for s in running_items:
                        sid = str(s.get("id") or s.get("session_id") or "")
                        if not sid:
                            continue
                        cur_ids.add(sid)
                        if sid not in seen_map:
                            # Nếu Muse trả updated_at / created_at gần đây thì ưu tiên dùng để tính đếm ngược chính xác
                            s_ts = 0.0
                            for raw_t in (s.get("updated_at"), s.get("created_at")):
                                if raw_t is None:
                                    continue
                                try:
                                    val = float(raw_t)
                                    if val > 1e12:
                                        val /= 1000.0
                                    if now_ts - 3600 < val <= now_ts + 60:
                                        s_ts = val
                                        break
                                except Exception:
                                    try:
                                        dt = datetime.fromisoformat(str(raw_t).replace("Z", "+00:00"))
                                        val = dt.timestamp()
                                        if now_ts - 3600 < val <= now_ts + 60:
                                            s_ts = val
                                            break
                                    except Exception:
                                        pass
                            seen_map[sid] = s_ts if s_ts > 0 else now_ts
                    for old_sid in list(seen_map.keys()):
                        if old_sid not in cur_ids:
                            seen_map.pop(old_sid, None)

                    d = _get_acc_diag_entry(aid)
                    prev_unclosed = int(d.get("unclosed_threads") or 0)
                    d["muse_running_threads"] = len(running_items)
                    d["unclosed_threads"] = orphan_cnt
                    if orphan_cnt > 0:
                        # Ước tính thời điểm các luồng treo trên Muse tự nhả (theo chu kỳ timeout của phiên Muse)
                        release_candidates = []
                        for sid in cur_ids:
                            st = seen_map.get(sid, now_ts)
                            cand = st + min(v_timeout, 600.0)
                            if cand <= now_ts:
                                cand = now_ts + 120.0
                            release_candidates.append(cand)
                        est_until = max(release_candidates) if release_candidates else (now_ts + 300.0)
                        d["unclosed_until"] = est_until
                        if not d.get("congested_reason") or "luồng" in str(d.get("congested_reason") or "").lower():
                            d["congested_reason"] = f"Nghẽn chưa tắt {orphan_cnt} luồng trên Muse"
                    else:
                        d["unclosed_until"] = 0.0
                        if prev_unclosed > 0 and "chưa tắt" in str(d.get("congested_reason") or "").lower():
                            d["congested_until"] = 0.0
                            d["congested_reason"] = ""
                    if prev_unclosed != orphan_cnt:
                        d["updated_at"] = now_ts
                        _save_diag_state()
            except Exception:
                pass

        def _update_diag_from_muse_result(aid: str, res_dict: dict):
            try:
                if not aid or not isinstance(res_dict, dict):
                    return
                hnd_diag = res_dict.get("hnd_diag")
                if isinstance(hnd_diag, dict):
                    ok_ms = float(hnd_diag.get("last_video_ok_ms") or 0.0)
                    if ok_ms > 0:
                        _mark_account_video_ok(aid, ok_ms / 1000.0, save=True)
                    for te in hnd_diag.get("tool_errors") or []:
                        if isinstance(te, dict) and te.get("text"):
                            ev_ts = (float(te["ts_ms"]) / 1000.0) if te.get("ts_ms") else time.time()
                            cls_info = _classify_muse_diag_text(te["text"], ev_ts)
                            if cls_info:
                                _apply_classified_diag(aid, cls_info, save=True)
                    for ft in hnd_diag.get("full_texts") or []:
                        if isinstance(ft, dict) and ft.get("text"):
                            ev_ts = (float(ft["ts_ms"]) / 1000.0) if ft.get("ts_ms") else time.time()
                            cls_info = _classify_muse_diag_text(ft["text"], ev_ts)
                            if cls_info:
                                _apply_classified_diag(aid, cls_info, save=True)
                elif isinstance(res_dict.get("texts"), list) and not res_dict.get("media"):
                    joined = " | ".join(str(x) for x in res_dict["texts"] if x)
                    cls_info = _classify_muse_diag_text(joined, time.time())
                    if cls_info:
                        _apply_classified_diag(aid, cls_info, save=True)
            except Exception:
                pass

        def _update_diag_from_probe(aid: str, probe_dict: dict):
            try:
                if not aid or not isinstance(probe_dict, dict) or not probe_dict.get("ok"):
                    return
                if isinstance(probe_dict.get("running_sessions"), list):
                    _update_diag_from_muse_sessions(aid, probe_dict["running_sessions"])
                for hc in probe_dict.get("history_checks") or []:
                    if isinstance(hc, dict) and isinstance(hc.get("diag"), dict):
                        _update_diag_from_muse_result(aid, {"hnd_diag": hc["diag"]})
            except Exception:
                pass

        def _sync_diag_from_db_logs():
            """Đồng bộ chẩn đoán từ bảng logs của studio.db (chỉ quét các dòng mới từ last_log_id)."""
            try:
                _ensure_diag_loaded()
                db_mod = sys.modules.get("qtstudio.db")
                conn = getattr(db_mod, "_conn", None) if db_mod else None
                db_lock = getattr(db_mod, "_lock", None) if db_mod else None
                if conn is None:
                    return

                def _fetch():
                    acc_rows = conn.execute("SELECT id, seq, name FROM accounts").fetchall()
                    last_id = int(_diag_state.get("last_log_id") or 0)
                    log_rows = conn.execute(
                        "SELECT id, t, text FROM logs WHERE id > ? ORDER BY id ASC",
                        (last_id,),
                    ).fetchall()
                    return acc_rows, log_rows

                if db_lock:
                    with db_lock:
                        acc_rows, log_rows = _fetch()
                else:
                    acc_rows, log_rows = _fetch()

                if not log_rows:
                    return

                name_to_id = {}
                for r in acc_rows:
                    aid, seq, nm = str(r[0]), int(r[1] or 0), str(r[2] or "").strip()
                    if nm:
                        name_to_id[nm.lower()] = aid
                    if seq > 0:
                        name_to_id[f"tài khoản {seq}"] = aid
                        name_to_id[f"account {seq}"] = aid

                changed = False
                max_id = int(_diag_state.get("last_log_id") or 0)
                for row in log_rows:
                    lid = int(row[0] or 0)
                    lts = float(row[1] or time.time())
                    ltxt = str(row[2] or "")
                    if lid > max_id:
                        max_id = lid
                    m_prefix = re.match(r"^\[([^\]]+)\]\s*(.*)$", ltxt, re.S)
                    if not m_prefix:
                        continue
                    who = m_prefix.group(1).strip().lower()
                    body = m_prefix.group(2).strip()
                    aid = name_to_id.get(who)
                    if not aid:
                        continue

                    low_body = body.lower()
                    # Tác vụ video hoàn tất thật (.mp4 / .mov / .webm) -> xoá cờ lỗi cũ
                    if "✅" in body and "xong video:" in low_body and re.search(r"\.(?:mp4|mov|webm)\b", low_body):
                        if _mark_account_video_ok(aid, lts, save=False):
                            changed = True
                        continue

                    # Làm mới phiên thành công -> xoá lỗi nghẽn kết nối tạm thời
                    if "đã làm mới phiên muse" in low_body:
                        with _diag_lock:
                            d = _get_acc_diag_entry(aid)
                            if lts > float(d.get("congested_at") or 0.0) and int(d.get("unclosed_threads") or 0) == 0:
                                d["congested_until"] = 0.0
                                d["congested_reason"] = ""
                                changed = True
                        continue

                    cls_info = _classify_muse_diag_text(body, lts)
                    if cls_info:
                        # Tránh gắn lỗi 403/24h video cho tác vụ tạo ảnh
                        if "xong ảnh:" in low_body:
                            continue
                        if _apply_classified_diag(aid, cls_info, save=False):
                            changed = True

                with _diag_lock:
                    if max_id != _diag_state.get("last_log_id"):
                        _diag_state["last_log_id"] = max_id
                        changed = True
                if changed:
                    _save_diag_state()
            except Exception:
                pass

        def _build_account_diagnostics_response() -> dict:
            """Tổng hợp chẩn đoán thời gian thực cho toàn bộ tài khoản (100% chỉ hiển thị thông tin)."""
            _sync_diag_from_db_logs()
            now_ts = time.time()
            v_timeout = _get_video_timeout_setting()
            out_accounts = {}
            try:
                db_mod = sys.modules.get("qtstudio.db")
                conn = getattr(db_mod, "_conn", None) if db_mod else None
                db_lock = getattr(db_mod, "_lock", None) if db_mod else None
                acc_ids = []
                running_tasks = []
                if conn is not None:
                    def _q():
                        a_rows = conn.execute("SELECT id FROM accounts ORDER BY seq").fetchall()
                        t_rows = conn.execute(
                            "SELECT id, seq, kind, account_id, updated_at FROM tasks WHERE status='running'"
                        ).fetchall()
                        return a_rows, t_rows
                    if db_lock:
                        with db_lock:
                            a_rows, running_tasks = _q()
                    else:
                        a_rows, running_tasks = _q()
                    acc_ids = [str(r[0]) for r in a_rows]

                hung_by_acc = {}
                local_by_acc = {}
                for tr in running_tasks:
                    aid = str(tr[3] or "")
                    if not aid:
                        continue
                    local_by_acc[aid] = local_by_acc.get(aid, 0) + 1
                    started_at = float(tr[4] or now_ts)
                    elapsed = now_ts - started_at
                    # Nếu tác vụ treo chạy quá 300s (5 phút) chưa xong -> cảnh báo luồng đang nghẽn/treo kèm đếm ngược tới lúc tự ngắt
                    if elapsed >= 300.0:
                        rel_at = max(now_ts + 30.0, started_at + v_timeout)
                        cur_h = hung_by_acc.setdefault(aid, {"count": 0, "until": 0.0, "max_elapsed": 0.0})
                        cur_h["count"] += 1
                        cur_h["until"] = max(cur_h["until"], rel_at)
                        cur_h["max_elapsed"] = max(cur_h["max_elapsed"], elapsed)

                with _diag_lock:
                    all_ids = list(dict.fromkeys(acc_ids + list(_diag_state["accounts"].keys())))
                    for aid in all_ids:
                        d = _get_acc_diag_entry(aid)
                        reg_403 = bool(d.get("region_403"))
                        lim_until = float(d.get("limit_24h_until") or 0.0)
                        lim_active = lim_until > now_ts

                        unclosed_cnt = int(d.get("unclosed_threads") or 0)
                        unclosed_until = float(d.get("unclosed_until") or 0.0)
                        if unclosed_cnt > 0 and unclosed_until <= now_ts:
                            # Nếu đã quá chu kỳ dự kiến mà chưa có lượt probe mới thì tự động hạ cờ treo cũ
                            unclosed_cnt = 0
                            d["unclosed_threads"] = 0
                            d["unclosed_until"] = 0.0

                        err_cong_until = float(d.get("congested_until") or 0.0)
                        hung_info = hung_by_acc.get(aid)
                        hung_cnt = int(hung_info["count"]) if hung_info else 0
                        hung_until = float(hung_info["until"]) if hung_info else 0.0

                        eff_unclosed = max(unclosed_cnt, hung_cnt)
                        eff_cong_until = max(
                            err_cong_until if err_cong_until > now_ts else 0.0,
                            unclosed_until if (unclosed_cnt > 0 and unclosed_until > now_ts) else 0.0,
                            hung_until if hung_cnt > 0 else 0.0,
                        )
                        cong_active = (eff_cong_until > now_ts) or (eff_unclosed > 0)
                        if hung_cnt > 0:
                            mins_hung = int(hung_info["max_elapsed"] // 60)
                            cong_reason = f"Đang nghẽn {hung_cnt} luồng treo ({mins_hung}p chưa tắt)"
                        elif unclosed_cnt > 0:
                            cong_reason = f"Còn {unclosed_cnt} luồng trên Muse chưa tắt"
                        elif err_cong_until > now_ts:
                            cong_reason = str(d.get("congested_reason") or "Nghẽn luồng nhận lệnh trên Muse")
                        else:
                            cong_reason = ""

                        out_accounts[aid] = {
                            "region_403": reg_403,
                            "region_403_at": float(d.get("region_403_at") or 0.0) if reg_403 else 0.0,
                            "region_403_reason": str(d.get("region_403_reason") or "Chặn 403 quốc gia / tài khoản") if reg_403 else "",
                            "limit_24h": lim_active,
                            "limit_24h_at": float(d.get("limit_24h_at") or 0.0) if lim_active else 0.0,
                            "limit_24h_until": lim_until if lim_active else 0.0,
                            "limit_24h_reason": str(d.get("limit_24h_reason") or "Đạt giới hạn tạo Video 24h") if lim_active else "",
                            "congested": cong_active,
                            "congested_until": eff_cong_until if cong_active else 0.0,
                            "congested_reason": cong_reason,
                            "unclosed_threads": eff_unclosed,
                            "muse_running_threads": int(d.get("muse_running_threads") or 0),
                            "local_running_threads": int(local_by_acc.get(aid, _get_local_running_count_for_acc(aid))),
                        }
            except Exception:
                pass
            return {
                "ok": True,
                "server_now": now_ts,
                "accounts": out_accounts,
            }

        def _clear_account_diag_flag(aid: str, kind: str = "all") -> dict:
            if not aid:
                return {"ok": False, "detail": "Thiếu account_id"}
            now_ts = time.time()
            with _diag_lock:
                d = _get_acc_diag_entry(aid)
                if kind in ("all", "region_403"):
                    d["region_403"] = False
                    d["region_403_reason"] = ""
                if kind in ("all", "limit_24h"):
                    d["limit_24h_until"] = 0.0
                    d["limit_24h_reason"] = ""
                if kind in ("all", "congested"):
                    d["congested_until"] = 0.0
                    d["congested_reason"] = ""
                    d["unclosed_threads"] = 0
                    d["unclosed_until"] = 0.0
                d["cleared_at"] = now_ts
                d["updated_at"] = now_ts
            _save_diag_state()
            return _build_account_diagnostics_response()

        def _install_muse_client_diag_hooks():
            """Gắn hook nhẹ (read-only) vào MuseClient._js và Runner check/refresh/quota để bắt chính xác
            số luồng đang treo trên Muse (sessions.list) và lỗi công cụ imagine_media (chat.history)."""
            try:
                muse_mod = sys.modules.get("qtstudio.engine.muse")
                if muse_mod is not None and hasattr(muse_mod, "MuseClient"):
                    mc_cls = muse_mod.MuseClient
                    if not getattr(mc_cls, "_hnd_diag_js_hooked", False):
                        _orig_mc_js = mc_cls._js
                        async def _hnd_mc_js(self, expr, *args, **kwargs):
                            res = await _orig_mc_js(self, expr, *args, **kwargs)
                            try:
                                aid = getattr(self, "account_id", None)
                                if aid and isinstance(expr, str):
                                    if "window.__qt.sessions()" in expr and isinstance(res, list):
                                        _update_diag_from_muse_sessions(aid, res)
                                    elif "window.__qt.result(" in expr and isinstance(res, dict):
                                        _update_diag_from_muse_result(aid, res)
                                    elif "window.__qt.diagProbe" in expr and isinstance(res, dict):
                                        _update_diag_from_probe(aid, res)
                            except Exception:
                                pass
                            return res
                        mc_cls._js = _hnd_mc_js
                        mc_cls._hnd_diag_js_hooked = True

                worker_mod = sys.modules.get("qtstudio.worker")
                runner_inst = getattr(api_mod, "runner", None)
                if worker_mod is not None and hasattr(worker_mod, "Runner") and runner_inst is not None:
                    r_cls = worker_mod.Runner
                    if not getattr(r_cls, "_hnd_diag_ops_hooked", False):
                        async def _probe_existing_client(r_self, account_id: str, clear_transient: bool = False):
                            try:
                                if clear_transient and account_id:
                                    with _diag_lock:
                                        d = _get_acc_diag_entry(account_id)
                                        d["congested_until"] = 0.0
                                        d["congested_reason"] = ""
                                clients = getattr(r_self, "clients", None)
                                cli = clients.get(account_id) if isinstance(clients, dict) else None
                                if cli is not None:
                                    cdp_sess = getattr(cli, "session", None)
                                    if cdp_sess is not None and getattr(cdp_sess, "alive", lambda: False)():
                                        await cli._js("window.__qt.diagProbe(true)", timeout=10)
                            except Exception:
                                pass

                        for method_name, clear_tr in (
                            ("check_account", False),
                            ("check_quota", False),
                            ("refresh_session", True),
                        ):
                            orig_fn = getattr(r_cls, method_name, None)
                            if orig_fn is None:
                                continue
                            def _make_wrapped(fn_orig, do_clear, m_name):
                                async def _wrapped_op(self, account_id, *args, **kwargs):
                                    out = await fn_orig(self, account_id, *args, **kwargs)
                                    if m_name == "check_quota" and account_id:
                                        try:
                                            from engine.api_session import has_session as _has_api_bin
                                            if _has_api_bin(str(account_id)):
                                                db_mod = sys.modules.get("qtstudio.db")
                                                if db_mod is not None and hasattr(db_mod, "run"):
                                                    db_mod.run(
                                                        "UPDATE accounts SET status='ok', status_msg='Đã đăng nhập' WHERE id=? AND status='logged_out'",
                                                        (str(account_id),),
                                                    )
                                        except Exception:
                                            pass
                                    await _probe_existing_client(self, account_id, clear_transient=do_clear)
                                    return out
                                return _wrapped_op
                            wrapped_fn = _make_wrapped(orig_fn, clear_tr, method_name)
                            setattr(r_cls, method_name, wrapped_fn)
                            setattr(runner_inst, method_name, types.MethodType(wrapped_fn, runner_inst))
                        r_cls._hnd_diag_ops_hooked = True
            except Exception:
                pass

        def _sync_multi_account_5_threads_policy():
            """Đảm bảo mỗi tài khoản Muse mặc định chạy 5 luồng (5 ảnh / 5 video),
            càng nhiều tài khoản càng nhiều tổng luồng (5 × Số tài khoản) và luôn chia đều tải (rotate)."""
            try:
                db_mod = sys.modules.get("qtstudio.db")
                if db_mod is None:
                    return
                conn = getattr(db_mod, "_conn", None)
                db_lock = getattr(db_mod, "_lock", None)
                if conn is not None:
                    def _do_db_fix():
                        # Mọi tài khoản mới thêm vào (mặc định gốc 2 luồng) tự động nâng lên 5 luồng/tài khoản
                        conn.execute("UPDATE accounts SET image_threads=5 WHERE image_threads IS NULL OR image_threads=2")
                        conn.execute("UPDATE accounts SET video_threads=5 WHERE video_threads IS NULL OR video_threads=2")
                        rows_acc = conn.execute("SELECT image_threads, video_threads FROM accounts WHERE enabled=1").fetchall()
                        n_accs = max(1, len(rows_acc))
                        total_cap = sum(max(int(r[0] or 5), int(r[1] or 5), 5) for r in rows_acc) if rows_acc else 5
                        desired_total = str(max(total_cap, n_accs * 5))
                        for k, v in (
                            ("account_mode", "rotate"),
                            ("max_parallel_accounts", "0"),
                            ("max_total_threads", desired_total),
                            ("use_topup", "1"),
                            ("video_when_out", "1"),
                            ("max_retries", "2"),
                        ):
                            conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (k, v))
                        conn.commit()
                    if db_lock:
                        with db_lock:
                            _do_db_fix()
                    else:
                        _do_db_fix()
            except Exception:
                pass

        def _bridge_native_license_and_engine():
            """Đồng bộ trạng thái bản quyền HND sang qtstudio.license (lic.is_valid) để Runner._loop
            luôn thực thi _dispatch(), đồng thời nạp trực tiếp page_helper.js (engine_js.bin) cho MuseClient."""
            try:
                def _hnd_is_valid() -> bool:
                    with _lock:
                        return bool(_license_state.get("valid"))

                lic_mod = sys.modules.get("qtstudio.license")
                if lic_mod is not None:
                    lic_mod.is_valid = _hnd_is_valid
                    lic_mod._load_key = lambda: str(_license_state.get("key") or "HND-ACTIVE")
                    if hasattr(lic_mod, "_state") and isinstance(lic_mod._state, dict):
                        lic_mod._state["checked"] = True
                        lic_mod._state["valid"] = _hnd_is_valid()
                        lic_mod._state["reason"] = ""
                        lic_mod._state["expiry"] = str(_license_state.get("expiration") or "2099-12-30")

                worker_mod = sys.modules.get("qtstudio.worker")
                if worker_mod is not None and hasattr(worker_mod, "lic"):
                    worker_mod.lic.is_valid = _hnd_is_valid

                # Nạp bộ điều khiển Muse (engine/page_helper.js hoặc engine_js.bin) trực tiếp vào bộ nhớ
                engine_candidates = [
                    _BASE_DIR / "engine" / "page_helper.js",
                    _BASE_DIR / "qtstudio" / "engine" / "page_helper.js",
                    _BASE_DIR / "engine_js.bin",
                    _DATA_DIR / "engine_js.bin",
                    _BASE_DIR.parent / "engine_js.bin",
                    _BASE_DIR.parent / "crack" / "engine-server" / "engine_js.bin",
                ]
                engine_js_text = ""
                for cand in engine_candidates:
                    if cand.is_file():
                        try:
                            engine_js_text = cand.read_bytes().decode("utf-8")
                            if len(engine_js_text) > 1000:
                                break
                        except Exception:
                            pass

                if engine_js_text:
                    def _hnd_helper_js() -> str:
                        if not _hnd_is_valid():
                            raise RuntimeError("Chưa kích hoạt license — nhập key để dùng")
                        return engine_js_text

                    remote_mod = sys.modules.get("qtstudio.engine.remote")
                    if remote_mod is not None:
                        remote_mod.helper_js = _hnd_helper_js
                        remote_mod._fetch = _hnd_helper_js
                        remote_mod._local = _hnd_helper_js
                        if hasattr(remote_mod, "_cache") and isinstance(remote_mod._cache, dict):
                            remote_mod._cache["js"] = engine_js_text
                            remote_mod._cache["at"] = time.time() + 86400 * 365

                    muse_mod = sys.modules.get("qtstudio.engine.muse")
                    if muse_mod is not None and hasattr(muse_mod, "remote"):
                        muse_mod.remote.helper_js = _hnd_helper_js
            except Exception:
                pass

        def _install_multi_account_balancer():
            """Hook bộ điều phối Runner._dispatch và Runner.run để chia đều tác vụ theo Least-Loaded Round-Robin
            ra tất cả các tài khoản (mỗi tài khoản 5 luồng, N tài khoản = 5*N luồng song song, không dồn vào 1 tài khoản)."""
            try:
                _bridge_native_license_and_engine()
                worker_mod = sys.modules.get("qtstudio.worker")
                db_mod = sys.modules.get("qtstudio.db")
                runner_inst = getattr(api_mod, "runner", None)
                if worker_mod is None or db_mod is None or runner_inst is None:
                    return

                # Không bao giờ coi tài khoản dùng 30 tỷ token bổ sung (topup) là hết quota hay chậm hơn tài khoản 1
                worker_mod.slow_video = lambda acc, now=None: False
                worker_mod.quota_exhausted = lambda acc, now=None: False

                class _HndRow(dict):
                    """Dict tương thích 100% với cả sqlite3.Row (truy cập theo index số r[0] và tên cột r['id'])
                    lẫn dict.get('col') để không bao giờ xảy ra lỗi 'sqlite3.Row' object has no attribute 'get'."""
                    def __getitem__(self, key):
                        if isinstance(key, int):
                            return list(self.values())[key]
                        return super().__getitem__(key)

                def _to_hnd_row(r):
                    if isinstance(r, _HndRow):
                        return r
                    if isinstance(r, dict):
                        return _HndRow(r)
                    try:
                        return _HndRow(dict(r))
                    except Exception:
                        return r

                def _db_select_rows(sql, params=()):
                    if hasattr(db_mod, "rows"):
                        return [_to_hnd_row(r) for r in db_mod.rows(sql, params)]
                    conn = getattr(db_mod, "_conn", None)
                    db_lock = getattr(db_mod, "_lock", None)
                    if conn is None:
                        return []
                    if db_lock:
                        with db_lock:
                            return [_to_hnd_row(r) for r in conn.execute(sql, params).fetchall()]
                    return [_to_hnd_row(r) for r in conn.execute(sql, params).fetchall()]

                # Bọc thêm db_mod.one và db_mod.rows để mọi truy vấn trong toàn bộ worker đều có .get()
                if hasattr(db_mod, "one"):
                    _orig_db_one = db_mod.one
                    db_mod.one = lambda sql, params=(): (
                        _to_hnd_row(r) if (r := _orig_db_one(sql, params)) is not None else None
                    )
                if hasattr(db_mod, "rows"):
                    _orig_db_rows = db_mod.rows
                    db_mod.rows = lambda sql, params=(): [_to_hnd_row(r) for r in _orig_db_rows(sql, params)]
                if hasattr(db_mod, "norm_refs"):
                    _orig_norm_refs = db_mod.norm_refs
                    def _dedup_norm_refs(raw):
                        items = _orig_norm_refs(raw)
                        seen = set()
                        out = []
                        for it in items:
                            p = os.path.normcase(os.path.abspath(str(it.get("path") or ""))) if isinstance(it, dict) else str(it)
                            if p and p not in seen:
                                seen.add(p)
                                out.append(it)
                        return out
                    db_mod.norm_refs = _dedup_norm_refs

                def _db_exec_write(sql, params=()):
                    if hasattr(db_mod, "run"):
                        return db_mod.run(sql, params)
                    conn = getattr(db_mod, "_conn", None)
                    db_lock = getattr(db_mod, "_lock", None)
                    if conn is None:
                        return 0
                    if db_lock:
                        with db_lock:
                            cur = conn.execute(sql, params)
                            conn.commit()
                            return cur.rowcount
                    cur = conn.execute(sql, params)
                    conn.commit()
                    return cur.rowcount

                def _hnd_balanced_dispatch(self):
                    try:
                        _sync_multi_account_5_threads_policy()
                        worker_mod.reserve_video_numbers()
                        queued = _db_select_rows("SELECT * FROM tasks WHERE status='queued' AND origin='muse' ORDER BY project_id, seq")
                        if not queued:
                            if not self.active:
                                db_mod.log("[HỆ THỐNG] Đã chạy hết hàng chờ.")
                                self.dispatching = False
                            return

                        accounts = _db_select_rows(
                            "SELECT * FROM accounts WHERE enabled=1 AND status NOT IN ('logged_out','checking') ORDER BY seq"
                        )
                        if not accounts:
                            return

                        running_rows = _db_select_rows("SELECT cont_session, session_id FROM tasks WHERE status='running'")
                        busy_sessions = {
                            (r["cont_session"] or r["session_id"])
                            for r in running_rows
                            if (r["cont_session"] or r["session_id"])
                        }

                        n_accs = len(accounts)
                        for t in queued:
                            cont_s = t.get("cont_session") if isinstance(t, dict) else (t["cont_session"] if "cont_session" in t.keys() else None)
                            if cont_s:
                                if cont_s in busy_sessions:
                                    continue
                                acc = next((a for a in accounts if a["id"] == t["account_id"]), None)
                                if acc is None:
                                    continue
                                self._launch(t, acc)
                                busy_sessions.add(cont_s)
                                continue

                            kind = t["kind"]
                            k_col = "image_threads" if kind == "image" else "video_threads"

                            def _tot_load(aid):
                                return sum(
                                    1 for m in self.active_meta.values()
                                    if (m[0] if isinstance(m, (tuple, list)) else m.get("account_id")) == aid
                                )

                            def _kind_load(aid):
                                return sum(
                                    1 for m in self.active_meta.values()
                                    if (m[0] if isinstance(m, (tuple, list)) else m.get("account_id")) == aid
                                    and (m[1] if isinstance(m, (tuple, list)) and len(m) > 1 else m.get("kind")) == kind
                                )

                            last_failed_aid = (
                                t.get("last_account")
                                or (t.get("account_id") if int(t.get("attempts") or 0) > 0 else None)
                            )
                            now_ts = time.time()
                            free_candidates = []
                            for idx, a in enumerate(accounts):
                                limit_a = max(int(a[k_col] or 5), 5)
                                cur_tot = _tot_load(a["id"])
                                cur_k = _kind_load(a["id"])
                                if cur_tot < limit_a and cur_k < limit_a:
                                    is_last_failed = 1 if (n_accs > 1 and last_failed_aid and a["id"] == last_failed_aid) else 0
                                    fail_ts = _failed_acc_cooldown.get(a["id"], 0.0)
                                    has_cooldown = 1 if (n_accs > 1 and (now_ts - fail_ts) < 600.0) else 0
                                    rr_rank = (idx - getattr(self, "rr", 0)) % n_accs
                                    free_candidates.append((is_last_failed, has_cooldown, cur_tot, cur_k, rr_rank, idx, a))

                            if not free_candidates:
                                # Tất cả các tài khoản đều đã chạy đủ 5 luồng/tài khoản
                                break

                            # Ưu tiên tài khoản khỏe mạnh (không vừa lỗi) + đang chạy ít luồng nhất (Least-Loaded) + xoay vòng Round-Robin
                            free_candidates.sort(key=lambda item: (item[0], item[1], item[2], item[3], item[4]))
                            _, _, _, _, _, chosen_idx, chosen_acc = free_candidates[0]
                            self.rr = (chosen_idx + 1) % n_accs
                            self._launch(t, chosen_acc)
                    except Exception as disp_exc:
                        try:
                            db_mod.log(f"[HỆ THỐNG] Lỗi bộ điều phối đa luồng: {disp_exc}")
                        except Exception:
                            pass

                _failed_acc_cooldown = {}
                _orig_runner_fail = getattr(worker_mod.Runner, "_fail", None) if hasattr(worker_mod, "Runner") else None

                def _hnd_runner_fail(self, task_row, acc, err):
                    try:
                        aid = acc["id"] if isinstance(acc, dict) else None
                        if aid:
                            _failed_acc_cooldown[aid] = time.time()
                            _record_account_diag_from_error(aid, err, task_row)
                            tid = task_row["id"] if isinstance(task_row, dict) else None
                            if tid:
                                _db_exec_write("UPDATE tasks SET last_account=? WHERE id=?", (aid, tid))
                    except Exception:
                        pass
                    if _orig_runner_fail is not None:
                        return _orig_runner_fail(self, task_row, acc, err)

                def _hnd_runner_run(self, task_ids=None, project_id=None, statuses=("idle", "stopped"), kind=None):
                    """Cho phép nút 'Chạy tất cả' và nút 'Chạy' kích hoạt cả các tác vụ đang ở trạng thái 'queued' (Đang chờ),
                    'idle', 'stopped', 'error' ngay lập tức trên main event loop mà không bị lỗi 'no running event loop'."""
                    n = 0
                    try:
                        _bridge_native_license_and_engine()
                        if task_ids:
                            marks = ",".join("?" for _ in task_ids)
                            _db_exec_write(
                                f"UPDATE tasks SET status='queued', progress=0, message='Chờ chạy', attempts=0, "
                                f"session_id=NULL, last_account=COALESCE(account_id, last_account) "
                                f"WHERE id IN ({marks}) AND status != 'running' AND origin='muse'",
                                tuple(task_ids),
                            )
                            q_rows = _db_select_rows(
                                f"SELECT id FROM tasks WHERE id IN ({marks}) AND status IN ('queued', 'running') AND origin='muse'",
                                tuple(task_ids),
                            )
                            n = len(q_rows)
                        elif project_id:
                            st_list = list(statuses or ("idle", "stopped"))
                            if "idle" in st_list or "stopped" in st_list:
                                for extra_st in ("queued", "error"):
                                    if extra_st not in st_list:
                                        st_list.append(extra_st)
                            marks = ",".join("?" for _ in st_list)
                            kind_sql = " AND kind=?" if kind else ""
                            kind_arg = (kind,) if kind else ()
                            updated_cnt = _db_exec_write(
                                f"UPDATE tasks SET status='queued', progress=0, message='Chờ chạy', attempts=0, "
                                f"session_id=NULL, last_account=COALESCE(account_id, last_account) "
                                f"WHERE project_id=? AND status IN ({marks}) AND origin='muse'{kind_sql}",
                                (project_id, *st_list, *kind_arg),
                            )
                            if "queued" in st_list:
                                q_rows = _db_select_rows(
                                    f"SELECT id FROM tasks WHERE project_id=? AND status IN ('queued', 'running') AND origin='muse'{kind_sql}",
                                    (project_id, *kind_arg),
                                )
                                n = len(q_rows)
                            else:
                                n = max(0, int(updated_cnt or 0))
                        if n > 0:
                            self.dispatching = True
                            lt = getattr(self, "loop_task", None)
                            if lt is not None and not lt.done():
                                try:
                                    lt.get_loop().call_soon_threadsafe(self._dispatch)
                                except Exception:
                                    pass
                    except Exception as run_exc:
                        try:
                            db_mod.log(f"[HỆ THỐNG] Lỗi kích hoạt chạy tác vụ: {run_exc}")
                        except Exception:
                            pass
                    return n

                if hasattr(worker_mod, "Runner"):
                    worker_mod.Runner._dispatch = _hnd_balanced_dispatch
                    worker_mod.Runner.run = _hnd_runner_run
                    if _orig_runner_fail is not None:
                        worker_mod.Runner._fail = _hnd_runner_fail
                runner_inst._dispatch = types.MethodType(_hnd_balanced_dispatch, runner_inst)
                runner_inst.run = types.MethodType(_hnd_runner_run, runner_inst)
                if _orig_runner_fail is not None:
                    runner_inst._fail = types.MethodType(_hnd_runner_fail, runner_inst)
                # Nếu trong DB đang có sẵn tác vụ 'queued' hoặc 'running' dở từ phiên trước, tự động chạy tiếp ngay khi mở tool
                if not getattr(runner_inst, "active", None):
                    _db_exec_write("UPDATE tasks SET status='queued' WHERE status='running' AND origin='muse'")
                existing_q = _db_select_rows("SELECT id FROM tasks WHERE status='queued' AND origin='muse' LIMIT 1")
                if existing_q:
                    runner_inst.dispatching = True
            except Exception:
                pass

        _sync_multi_account_5_threads_policy()
        _install_multi_account_balancer()
        _install_muse_client_diag_hooks()
        _sync_diag_from_db_logs()

        _hnd_ai = None
        try:
            ai_file = _BASE_DIR / "hnd_ai_assistant.py"
            if ai_file.is_file():
                spec = importlib.util.spec_from_file_location("hnd_ai_assistant", str(ai_file))
                if spec and spec.loader:
                    _hnd_ai_mod = importlib.util.module_from_spec(spec)
                    sys.modules["hnd_ai_assistant"] = _hnd_ai_mod
                    spec.loader.exec_module(_hnd_ai_mod)
                    _hnd_ai = _hnd_ai_mod
                    try:
                        _hnd_ai.sync_script_refs_to_db(_hnd_ai.load_ai_config().get("refs") or [])
                    except Exception:
                        pass
        except Exception as exc:
            try:
                (_DATA_DIR / "hnd_hook_debug.log").write_text(traceback.format_exc(), encoding="utf-8")
            except Exception:
                pass
            _hnd_ai = None

        _hnd_wf_bridge = None
        _hnd_bulk_mod = None
        try:
            if str(_BASE_DIR) not in sys.path:
                sys.path.insert(0, str(_BASE_DIR))
            import hnd_native_muse as _hnd_native_mod
            _hnd_native_mod.install_hybrid_muse_hook()
        except Exception:
            try:
                (_DATA_DIR / 'hnd_native_hook_debug.log').write_text(traceback.format_exc(), encoding='utf-8')
            except Exception:
                pass
        try:
            if str(_BASE_DIR) not in sys.path:
                sys.path.insert(0, str(_BASE_DIR))
            import hnd_bulk_accounts as _hnd_bulk_accounts_mod
            _hnd_bulk_mod = _hnd_bulk_accounts_mod
            _hnd_bulk_mod.install_runner_auto_otp_hook()
            _hnd_bulk_mod.sync_existing_db_accounts_otp_meta()
        except Exception:
            try:
                (_DATA_DIR / 'hnd_bulk_hook_debug.log').write_text(traceback.format_exc(), encoding='utf-8')
            except Exception:
                pass
        try:
            import hnd_workflow_bridge as _hnd_wf_mod
            _hnd_wf_bridge = _hnd_wf_mod.workflow_bridge
        except Exception:
            try:
                (_DATA_DIR / "hnd_wf_hook_debug.log").write_text(traceback.format_exc(), encoding="utf-8")
            except Exception:
                pass

        from fastapi.responses import FileResponse as _HndFileResponse

        @app.get("/workflow.css")
        def hnd_serve_workflow_css():
            f = _BASE_DIR / "qtstudio" / "static" / "workflow.css"
            if f.is_file():
                return _HndFileResponse(f, media_type="text/css")
            return JSONResponse({"ok": False}, status_code=404)

        @app.get("/workflow.js")
        def hnd_serve_workflow_js():
            f = _BASE_DIR / "qtstudio" / "static" / "workflow.js"
            if f.is_file():
                return _HndFileResponse(f, media_type="application/javascript")
            return JSONResponse({"ok": False}, status_code=404)

        @app.get("/assets/workflows/{rel:path}")
        def hnd_serve_workflow_assets(rel: str):
            for root_cand in (
                _BASE_DIR / "qtstudio" / "static" / "assets" / "workflows",
                _BASE_DIR / "assets" / "workflows",
            ):
                base_r = root_cand.resolve()
                target = (base_r / rel).resolve()
                if base_r in target.parents and target.is_file():
                    return _HndFileResponse(target)
            return JSONResponse({"ok": False}, status_code=404)

        @app.get("/api/hnd-media")
        def hnd_serve_local_media(path: str = ""):
            if not path:
                return JSONResponse({"ok": False}, status_code=404)
            target = Path(path)
            if not target.is_file():
                cand = (_BASE_DIR / path.lstrip("/\\")).resolve()
                if cand.is_file():
                    target = cand
                else:
                    return JSONResponse({"ok": False}, status_code=404)
            return _HndFileResponse(target)

        @app.api_route("/api/hnd-workflow/{method}", methods=["GET", "POST"])
        async def hnd_workflow_route_handler(request: Request, method: str = ""):
            nonlocal _hnd_wf_bridge
            try:
                import asyncio as _aio
                import database as _db_shim
                _db_shim.set_main_event_loop(_aio.get_running_loop())
            except Exception:
                pass
            if _hnd_wf_bridge is None:
                try:
                    if str(_BASE_DIR) not in sys.path:
                        sys.path.insert(0, str(_BASE_DIR))
                    import hnd_workflow_bridge as _hnd_wf_mod
                    _hnd_wf_bridge = _hnd_wf_mod.workflow_bridge
                except Exception as _e:
                    return JSONResponse({"ok": False, "error": f"Module hnd_workflow_bridge chưa được nạp: {_e}"}, status_code=500)
            fn = getattr(_hnd_wf_bridge, method, None)
            if fn is None or method.startswith("_"):
                return JSONResponse({"ok": False, "error": f"Không hỗ trợ hàm workflow: {method}"}, status_code=404)
            payload = {}
            if request.method == "POST":
                try:
                    raw_body = await request.body()
                    body = json.loads(raw_body.decode("utf-8")) if raw_body else {}
                    payload = body.get("payload") if isinstance(body, dict) and "payload" in body else body
                except Exception:
                    payload = {}
            try:
                import asyncio as _aio
                import inspect as _insp
                sig = _insp.signature(fn)
                if len(sig.parameters) == 0:
                    res = await _aio.to_thread(fn)
                else:
                    res = await _aio.to_thread(fn, payload)
                return JSONResponse(res if isinstance(res, dict) else {"ok": True, "data": res})
            except Exception as exc:
                return JSONResponse({"ok": False, "error": str(exc)}, status_code=500)

        @app.get("/api/hnd-license/status")
        def hnd_license_status(recheck: int = 0):
            if recheck or not _license_state.get("checked"):
                return JSONResponse(refresh_saved_license())
            return JSONResponse(get_current_status())

        @app.post("/api/hnd-license/activate")
        async def hnd_license_activate(request: Request):
            try:
                raw_body = await request.body()
                body = json.loads(raw_body.decode("utf-8")) if raw_body else {}
            except Exception:
                body = {}
            key_val = str((body or {}).get("key") or "").strip()
            return JSONResponse(activate_with_key(key_val))

        @app.post("/api/hnd-license/deactivate")
        def hnd_license_deactivate():
            return JSONResponse(deactivate_current_key())

        @app.get("/api/hnd-license/clipboard")
        def hnd_license_clipboard():
            return JSONResponse({"ok": True, "text": read_windows_clipboard_text()})

        @app.api_route("/api/hnd-accounts/{action}", methods=["GET", "POST"])
        async def hnd_bulk_accounts_route_handler(request: Request, action: str = ""):
            nonlocal _hnd_bulk_mod
            import asyncio as _aio
            try:
                if str(_BASE_DIR) not in sys.path:
                    sys.path.insert(0, str(_BASE_DIR))
                _hba_file = _BASE_DIR / "hnd_bulk_accounts.py"
                _cur_mt = _hba_file.stat().st_mtime if _hba_file.is_file() else 0.0
                if _hnd_bulk_mod is None:
                    import hnd_bulk_accounts as _hnd_bulk_accounts_mod
                    _hnd_bulk_mod = _hnd_bulk_accounts_mod
                    setattr(_hnd_bulk_mod, "_loaded_mtime", _cur_mt)
                    _hnd_bulk_mod.install_runner_auto_otp_hook()
                elif _cur_mt and getattr(_hnd_bulk_mod, "_loaded_mtime", 0.0) != _cur_mt:
                    import importlib as _il
                    _prev_batch = dict(getattr(_hnd_bulk_mod, "_BATCH_STATE", {}) or {})
                    _hnd_bulk_mod = _il.reload(_hnd_bulk_mod)
                    if _prev_batch.get("running"):
                        _hnd_bulk_mod._BATCH_STATE.update(_prev_batch)
                    setattr(_hnd_bulk_mod, "_loaded_mtime", _cur_mt)
            except Exception as exc:
                if _hnd_bulk_mod is None:
                    return JSONResponse({"ok": False, "error": f"Không nạp được hnd_bulk_accounts: {exc}"}, status_code=500)

            act = str(action or "").strip().lower()
            if act == "state":
                return JSONResponse(_hnd_bulk_mod.get_bulk_accounts_state())

            body = {}
            if request.method == "POST":
                try:
                    raw_body = await request.body()
                    body = json.loads(raw_body.decode("utf-8")) if raw_body else {}
                except Exception:
                    body = {}

            if act == "bulk-import":
                txt = str((body or {}).get("text") or "")
                auto_px = bool((body or {}).get("auto_assign_proxy", True))
                img_t = int((body or {}).get("image_threads") or 5)
                vid_t = int((body or {}).get("video_threads") or 5)
                res = await _aio.to_thread(
                    _hnd_bulk_mod.bulk_import_accounts_to_db,
                    txt,
                    auto_assign_proxy=auto_px,
                    image_threads=img_t,
                    video_threads=vid_t,
                )
                _sync_multi_account_5_threads_policy()
                if res.get("ok") and (body or {}).get("auto_login") and res.get("account_ids"):
                    conc = int((body or {}).get("concurrency") or 1)
                    only_unlogged = bool((body or {}).get("only_unlogged", True))
                    _aio.create_task(
                        _hnd_bulk_mod.run_batch_auto_login(
                            res["account_ids"],
                            concurrency=conc,
                            only_unlogged=only_unlogged,
                        )
                    )
                return JSONResponse(res)

            if act == "fetch-otp":
                aid = str((body or {}).get("account_id") or "").strip()
                em = str((body or {}).get("email") or "").strip()
                m_url = str((body or {}).get("mail_url") or "").strip()
                prefer_2fa = bool((body or {}).get("prefer_2fa", False))
                res = await _aio.to_thread(_hnd_bulk_mod.fetch_universal_otp, em, m_url, aid, prefer_2fa)
                return JSONResponse(res)

            if act == "save-meta":
                aid = str((body or {}).get("account_id") or "").strip()
                em = str((body or {}).get("email") or "").strip()
                m_url = (body or {}).get("mail_url")
                pwd = (body or {}).get("password")
                totp = (body or {}).get("totp_secret")
                meta = _hnd_bulk_mod.update_account_otp_meta(
                    aid,
                    em,
                    mail_url=str(m_url).strip() if m_url is not None else None,
                    password=str(pwd).strip() if pwd is not None else None,
                    totp_secret=str(totp).strip() if totp is not None else None,
                )
                return JSONResponse({"ok": True, "meta": meta})

            if act == "auto-login":
                aid = str((body or {}).get("account_id") or "").strip()
                if not aid:
                    return JSONResponse({"ok": False, "error": "Thiếu account_id"}, status_code=400)
                em_in = str((body or {}).get("email") or "").strip()
                url_in = (body or {}).get("mail_url")
                pwd_in = (body or {}).get("password")
                totp_in = (body or {}).get("totp_secret")
                if em_in or url_in is not None or pwd_in is not None or totp_in is not None:
                    try:
                        _hnd_bulk_mod.update_account_otp_meta(
                            aid,
                            em_in,
                            mail_url=str(url_in).strip() if url_in is not None else None,
                            password=str(pwd_in).strip() if pwd_in is not None else None,
                            totp_secret=str(totp_in).strip() if totp_in is not None else None,
                        )
                    except Exception:
                        pass
                _hnd_bulk_mod.install_runner_auto_otp_hook()
                _aio.create_task(_hnd_bulk_mod.run_auto_login_and_continue_unlogged(aid, concurrency=1))
                return JSONResponse({
                    "ok": True,
                    "account_id": aid,
                    "message": "Đã kích hoạt Auto-Login + OTP/2FA và tự động đăng nhập nối tiếp các tài khoản chưa login!",
                })

            if act == "batch-login":
                aids = (body or {}).get("account_ids")
                if not isinstance(aids, list):
                    aids = None
                conc = int((body or {}).get("concurrency") or 1)
                only_unlogged = bool((body or {}).get("only_unlogged", True))
                _hnd_bulk_mod.install_runner_auto_otp_hook()
                _aio.create_task(
                    _hnd_bulk_mod.run_batch_auto_login(
                        aids,
                        concurrency=conc,
                        only_unlogged=only_unlogged,
                    )
                )
                return JSONResponse({
                    "ok": True,
                    "message": f"Đã khởi chạy Auto-Login + OTP hàng loạt ({conc} luồng song song)!",
                })

            if act == "batch-stop":
                return JSONResponse(_hnd_bulk_mod.stop_batch_auto_login())

            return JSONResponse({"ok": False, "error": f"Hành động không hợp lệ: {act}"}, status_code=404)

        @app.get("/api/hnd-account-diag")
        def hnd_account_diag_get():
            return JSONResponse(_build_account_diagnostics_response())

        @app.post("/api/hnd-account-diag/clear")
        async def hnd_account_diag_clear(request: Request):
            try:
                raw_body = await request.body()
                body = json.loads(raw_body.decode("utf-8")) if raw_body else {}
            except Exception:
                body = {}
            aid = str((body or {}).get("account_id") or "").strip()
            kind = str((body or {}).get("kind") or "all").strip()
            return JSONResponse(_clear_account_diag_flag(aid, kind))

        @app.api_route("/api/hnd-ai/{subpath:path}", methods=["GET", "POST"])
        async def hnd_ai_route_handler(request: Request, subpath: str = ""):
            if _hnd_ai is None:
                return JSONResponse({"ok": False, "detail": "Module hnd_ai_assistant chưa được nạp"}, status_code=500)
            try:
                resp = await _hnd_ai.handle_hnd_ai_request(request)
                if isinstance(resp, tuple) and len(resp) == 2:
                    return JSONResponse(resp[0], status_code=resp[1])
                return resp
            except Exception as exc:
                return JSONResponse({"ok": False, "detail": f"Lỗi AI Assistant: {exc}"}, status_code=500)

        try:
            app.middleware_stack = None
            @app.middleware("http")
            async def hnd_strict_license_middleware(request: Request, call_next):
                path = request.url.path or ""
                if path in ("/api/hnd-license/status", "/api/license/status"):
                    recheck = request.query_params.get("recheck", "0") == "1"
                    if recheck or not _license_state.get("checked"):
                        return JSONResponse(refresh_saved_license())
                    return JSONResponse(get_current_status())

                if path in ("/api/hnd-license/activate", "/api/license/activate") and request.method == "POST":
                    try:
                        raw_body = await request.body()
                        body = json.loads(raw_body.decode("utf-8")) if raw_body else {}
                    except Exception:
                        body = {}
                    key_val = str((body or {}).get("key") or "").strip()
                    return JSONResponse(activate_with_key(key_val))

                if path in ("/api/hnd-license/deactivate", "/api/license/deactivate") and request.method == "POST":
                    return JSONResponse(deactivate_current_key())

                if path == "/api/hnd-license/clipboard":
                    return JSONResponse({"ok": True, "text": read_windows_clipboard_text()})

                if path == "/api/hnd-account-diag" and request.method == "GET":
                    return JSONResponse(_build_account_diagnostics_response())

                if path == "/api/hnd-account-diag/clear" and request.method == "POST":
                    try:
                        raw_body = await request.body()
                        body = json.loads(raw_body.decode("utf-8")) if raw_body else {}
                    except Exception:
                        body = {}
                    aid = str((body or {}).get("account_id") or "").strip()
                    kind = str((body or {}).get("kind") or "all").strip()
                    return JSONResponse(_clear_account_diag_flag(aid, kind))

                if path.startswith("/api/"):
                    allowed_prefixes = (
                        "/api/hnd-license",
                        "/api/license",
                        "/api/hnd-ai",
                        "/api/hnd-workflow",
                        "/api/hnd-accounts",
                        "/api/hnd-media",
                        "/api/open-url",
                        "/api/lang",
                        "/api/status",
                        "/api/logs",
                        "/api/update",
                    )
                    is_readonly_allowed = request.method == "GET" and path in (
                        "/api/characters",
                        "/api/settings",
                        "/api/projects",
                        "/api/tasks",
                    )
                    if not is_readonly_allowed and not any(path.startswith(p) for p in allowed_prefixes):
                        with _lock:
                            is_ok = bool(_license_state.get("valid"))
                            msg = _license_state.get("message") or "Chưa kích hoạt bản quyền"
                        if not is_ok:
                            return JSONResponse(
                                {"ok": False, "detail": msg},
                                status_code=403,
                            )

                try:
                    import asyncio as _aio
                    import database as _db_shim
                    _db_shim.set_main_event_loop(_aio.get_running_loop())
                except Exception:
                    pass
                if path in ("/", "/index.html") and request.method == "GET":
                    f_idx = _BASE_DIR / "qtstudio" / "static" / "index.html"
                    if f_idx.is_file():
                        from fastapi.responses import HTMLResponse as _HndHTMLResponse
                        raw_h = _inject_mid_into_html(f_idx.read_text(encoding="utf-8"))
                        raw_h = raw_h.replace("__VER__", _BUNDLE_STAMP).replace("__LANG__", "vi")
                        return _HndHTMLResponse(
                            raw_h,
                            headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"},
                        )
                if path == "/style.css" and request.method == "GET":
                    f_s = _BASE_DIR / "qtstudio" / "static" / "style.css"
                    f_w = _BASE_DIR / "qtstudio" / "static" / "workflow.css"
                    if f_s.is_file():
                        from fastapi.responses import Response as _HndResp
                        b_out = f_s.read_bytes() + (b"\n" + f_w.read_bytes() if f_w.is_file() else b"")
                        return _HndResp(content=b_out, media_type="text/css", headers={"Cache-Control": "no-store"})
                if path == "/app.js" and request.method == "GET":
                    f_a = _BASE_DIR / "qtstudio" / "static" / "app.js"
                    f_wj = _BASE_DIR / "qtstudio" / "static" / "workflow.js"
                    if f_a.is_file():
                        from fastapi.responses import Response as _HndResp
                        b_out = f_a.read_bytes() + (b"\n;\n" + f_wj.read_bytes() if f_wj.is_file() else b"")
                        return _HndResp(content=b_out, media_type="application/javascript", headers={"Cache-Control": "no-store"})
                if path == "/workflow.css":
                    return hnd_serve_workflow_css()
                if path == "/workflow.js":
                    return hnd_serve_workflow_js()
                if path.startswith("/assets/workflows/"):
                    return hnd_serve_workflow_assets(path[len("/assets/workflows/"):])
                if path == "/api/hnd-media" and request.method == "GET":
                    return hnd_serve_local_media(request.query_params.get("path", ""))
                if path.startswith("/api/hnd-workflow/"):
                    m_name = path[len("/api/hnd-workflow/"):].strip("/")
                    return await hnd_workflow_route_handler(request, m_name)
                if path.startswith("/api/hnd-accounts/"):
                    act_name = path[len("/api/hnd-accounts/"):].strip("/")
                    return await hnd_bulk_accounts_route_handler(request, act_name)

                if path.startswith("/api/hnd-ai/") and _hnd_ai is not None:
                    try:
                        resp = await _hnd_ai.handle_hnd_ai_request(request)
                        if isinstance(resp, tuple) and len(resp) == 2:
                            return JSONResponse(resp[0], status_code=resp[1])
                        return resp
                    except Exception as exc:
                        return JSONResponse({"ok": False, "detail": f"Lỗi AI Assistant: {exc}"}, status_code=500)

                if path == "/api/accounts" and request.method == "GET":
                    _sync_multi_account_5_threads_policy()

                resp_out = await call_next(request)

                if path.startswith("/api/accounts") and request.method in ("POST", "DELETE", "PATCH"):
                    _sync_multi_account_5_threads_policy()

                if path in ("/", "/index.html", "/style.css", "/app.js", "/i18n.js"):
                    try:
                        resp_out.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
                    except Exception:
                        pass

                return resp_out
            app.middleware_stack = app.build_middleware_stack()
        except Exception:
            pass

        # Initial check on startup + periodic monitor every 45 seconds
        refresh_saved_license()
        _bridge_native_license_and_engine()
        net_failures = 0
        while True:
            time.sleep(45)
            try:
                with _lock:
                    cur_key = _license_state.get("key") or ""
                    was_valid = bool(_license_state.get("valid"))
                if cur_key and was_valid:
                    mid = get_machine_id()
                    res = validate_license_remote(cur_key, mid)
                    if res["valid"]:
                        net_failures = 0
                        exp_v = res.get("expiration", "")
                        with _lock:
                            _license_state["expiration"] = exp_v
                            _license_state["expiry"] = exp_v
                            _license_state["checked_at"] = time.time()
                    elif res["code"] == "network_error":
                        net_failures += 1
                        # Mất mạng nhưng key đã lưu vẫn còn hạn: giữ nguyên trạng thái hợp lệ,
                        # không đá người dùng ra. Chỉ chặn khi key đã thật sự quá hạn.
                        with _lock:
                            cached_exp = str(_license_state.get("expiration") or "").strip()
                        if net_failures >= 3 and not _offline_grace_ok(cached_exp):
                            with _lock:
                                _license_state["valid"] = False
                                _license_state["ok"] = False
                                _license_state["code"] = res["code"]
                                _license_state["message"] = res["message"]
                            try:
                                if hasattr(api_mod, "runner"):
                                    api_mod.runner.stop()
                            except Exception:
                                pass
                    else:
                        with _lock:
                            _license_state["valid"] = False
                            _license_state["ok"] = False
                            _license_state["code"] = res["code"]
                            _license_state["message"] = res["message"]
                        try:
                            if hasattr(api_mod, "runner"):
                                api_mod.runner.stop()
                        except Exception:
                            pass
            except Exception:
                pass

    threading.Thread(target=_install_fastapi_hooks, name="hnd-license-monitor", daemon=True).start()

raise ImportError("No module named 'simplejson'")
