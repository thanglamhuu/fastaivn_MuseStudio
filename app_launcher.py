import os
import sys
import time
import socket
import shutil
import threading
import subprocess
from pathlib import Path
import uvicorn
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from fastapi.middleware.cors import CORSMiddleware

from studio_settings import (HOST, PORT, QuietConnectionResetMiddleware, apply_gateway_env,
                             cleanup_stale_driver_chrome)

def get_resource_path(relative_path: str) -> Path:
    if hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS) / relative_path
    return Path(__file__).parent / relative_path

def detect_windows_chromium() -> str:
    """Tự động tìm đường dẫn Chrome, Edge hoặc Brave trên máy khách Windows."""
    local_app_data = os.getenv("LOCALAPPDATA", "")
    candidates = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.join(local_app_data, r"Google\Chrome\Application\chrome.exe"),
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe",
        os.path.join(local_app_data, r"CocCoc\Browser\Application\browser.exe"),
    ]
    for path in candidates:
        if path and os.path.exists(path):
            return path
    return shutil.which("chrome") or shutil.which("chromium") or ""

# Thư mục lưu dữ liệu Cookie & phiên làm việc bền vững trên máy người dùng
APP_DATA_DIR = Path(os.getenv("APPDATA", Path.home())) / "MuseVideoStudio"
APP_DATA_DIR.mkdir(parents=True, exist_ok=True)

detected_browser = detect_windows_chromium()
if detected_browser:
    os.environ.setdefault("MUSE2API_CHROMIUM_PATH", detected_browser)

apply_gateway_env()
os.environ.setdefault("MUSE2API_DATA_DIR", str(APP_DATA_DIR))

# Bản exe không có console: ghi log ra file để biết vì sao không chạy (trước đây lỗi là thoát im lặng)
import logging
import traceback

LOG_DIR = Path(os.environ["MUSE2API_DATA_DIR"]) / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE = LOG_DIR / "launcher.log"
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    handlers=[logging.FileHandler(LOG_FILE, encoding="utf-8")],
)
launcher_log = logging.getLogger("musestudio.launcher")
launcher_log.info("khởi động MuseVideoStudio (frozen=%s, data=%s, port=%s)", getattr(sys, "frozen", False),
                  os.environ["MUSE2API_DATA_DIR"], os.environ.get("MUSE2API_PORT", "18610"))
sys.excepthook = lambda t, v, tb: launcher_log.error("lỗi chưa bắt:\n%s", "".join(traceback.format_exception(t, v, tb)))

# Khởi tạo FastAPI app từ muse2api.app
try:
    from muse2api.app import create_app
    muse_fastapi_app = create_app()
except ImportError:
    from muse2api.main import app as muse_fastapi_app

# API riêng của MuseStudio: đăng nhập bằng trình duyệt, số luồng theo tài khoản
from studio_api import router as studio_router

muse_fastapi_app.include_router(studio_router)
from studio_product import router as product_router

muse_fastapi_app.include_router(product_router)
from studio_media import router as media_router  # noqa: E402

muse_fastapi_app.include_router(media_router)
from studio_ai import router as ai_router  # noqa: E402

muse_fastapi_app.include_router(ai_router)
from studio_library import router as library_router  # noqa: E402

muse_fastapi_app.include_router(library_router)
from studio_catalog import router as catalog_router  # noqa: E402

muse_fastapi_app.include_router(catalog_router)
from studio_wfthumb import router as wfthumb_router  # noqa: E402

muse_fastapi_app.include_router(wfthumb_router)
from studio_maintenance import router as maintenance_router, start_scheduler  # noqa: E402

muse_fastapi_app.include_router(maintenance_router)
from studio_qc import router as qc_router  # noqa: E402

muse_fastapi_app.include_router(qc_router)  # tự chấm điểm mặt / giọng (QC)
# Sao lưu tự động data/ (mỗi giờ khi có thay đổi) + dọn data/media cũ (mỗi ngày) — luồng nền
start_scheduler(muse_fastapi_app.state.services.settings.data_dir)

# Thêm đoạn cấu hình này ngay sau khi khởi tạo muse_fastapi_app
# Không in traceback ConnectionResetError vô hại khi trình duyệt ngắt tải video giữa chừng (Windows)
muse_fastapi_app.add_middleware(QuietConnectionResetMiddleware)
muse_fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Cho phép mọi origin gọi vào (hoặc chỉ định cụ thể ["http://localhost:5173"])
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Phục vụ giao diện ReactJS đã build
DIST_DIR = get_resource_path("frontend_dist")
if not DIST_DIR.exists():
    DIST_DIR = get_resource_path("frontend/dist")

if DIST_DIR.exists():
    assets_dir = DIST_DIR / "assets"
    if assets_dir.exists():
        muse_fastapi_app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")
    # Thumbnail + clip xem trước của các mẫu Workflow (frontend/public/workflow-thumbs)
    thumbs_dir = DIST_DIR / "workflow-thumbs"
    if thumbs_dir.exists():
        muse_fastapi_app.mount("/workflow-thumbs", StaticFiles(directory=str(thumbs_dir)), name="workflow-thumbs")

    @muse_fastapi_app.get("/")
    async def serve_react_index():
        return FileResponse(str(DIST_DIR / "index.html"))

def wait_for_server_ready(host: str, port: int, timeout: float = 20.0) -> bool:
    start_time = time.time()
    while time.time() - start_time < timeout:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.5)
            if sock.connect_ex((host, port)) == 0:
                return True
        time.sleep(0.3)
    return False

def start_backend_server():
    try:
        uvicorn.run(
            muse_fastapi_app,
            host=HOST,
            port=PORT,
            log_level="info",
            access_log=False,
            log_config=None,  # dùng logging ra file ở trên (exe không có console)
        )
    except BaseException:  # noqa: BLE001
        launcher_log.exception("Gateway dừng vì lỗi")


def show_error(msg: str) -> None:
    """Hộp thoại báo lỗi (exe không có console nên không thấy lỗi nào khác)."""
    launcher_log.error(msg)
    try:
        import ctypes

        ctypes.windll.user32.MessageBoxW(None, msg, "Muse AI Video Batch Studio", 0x10)
    except Exception:  # noqa: BLE001
        pass

def open_browser_window(app_url: str) -> None:
    """Dự phòng khi pywebview không mở được: cửa sổ app của Chrome / Edge. Profile RIÊNG để Popen.wait() chờ đúng cửa sổ này
    (dùng profile mặc định thì Chrome đang mở của người dùng nhận trang rồi tiến trình thoát ngay → app tắt luôn)."""
    if not detected_browser:
        show_error(f"Không mở được cửa sổ giao diện và không tìm thấy Chrome / Edge.\nMở trình duyệt tới: {app_url}\n"
                   f"Chi tiết: {LOG_FILE}")
        return
    profile = Path(os.environ["MUSE2API_DATA_DIR"]) / "app-window"
    launcher_log.info("mở cửa sổ giao diện bằng %s", detected_browser)
    proc = subprocess.Popen([detected_browser, f"--app={app_url}", f"--user-data-dir={profile}",
                             "--window-size=1400,880", "--no-first-run", "--no-default-browser-check"])
    proc.wait()


def launch_desktop_window():
    app_url = f"http://{HOST}:{PORT}"
    try:
        import webview
        # Cho phép nút "Tải video" / "Tải tất cả" lưu file trong cửa sổ desktop
        webview.settings["ALLOW_DOWNLOADS"] = True
        webview.create_window(
            title="Muse AI Video Batch Studio",
            url=app_url,
            width=1400,
            height=880,
            min_size=(1024, 720),
            background_color="#020617",
        )
        started = time.time()
        webview.start()
        if time.time() - started > 5:
            return  # người dùng đóng cửa sổ
        # webview.start() trả về ngay = không có cửa sổ (máy thiếu WebView2 / .NET…) → trước đây app tắt im lặng
        launcher_log.warning("pywebview không mở được cửa sổ (trả về sau %.1fs) — dùng Chrome / Edge", time.time() - started)
    except Exception:  # noqa: BLE001
        launcher_log.exception("pywebview lỗi — dùng Chrome / Edge")
    open_browser_window(app_url)

if __name__ == "__main__":
    cleanup_stale_driver_chrome()  # Chrome ngầm còn sót từ lần chạy trước
    server_thread = threading.Thread(target=start_backend_server, daemon=True)
    server_thread.start()

    if wait_for_server_ready(HOST, PORT, timeout=60.0):
        launch_desktop_window()
    else:
        show_error(
            f"Không khởi động được máy chủ nội bộ (cổng {PORT}).\n\n"
            "- Cổng có thể đang bị chương trình khác dùng (vd. đang mở MuseStudio khác / run_dev.bat).\n"
            f"- Chi tiết lỗi: {LOG_FILE}"
        )

    os._exit(0)