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

from studio_settings import HOST, PORT, apply_gateway_env, cleanup_stale_driver_chrome

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

# Thêm đoạn cấu hình này ngay sau khi khởi tạo muse_fastapi_app
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
    uvicorn.run(
        muse_fastapi_app,
        host=HOST,
        port=PORT,
        log_level="info",
        access_log=False,
    )

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
        webview.start()
    except ImportError:
        if detected_browser:
            proc = subprocess.Popen([detected_browser, f"--app={app_url}", "--window-size=1400,880"])
            proc.wait()

if __name__ == "__main__":
    cleanup_stale_driver_chrome()  # Chrome ngầm còn sót từ lần chạy trước
    server_thread = threading.Thread(target=start_backend_server, daemon=True)
    server_thread.start()

    if wait_for_server_ready(HOST, PORT):
        launch_desktop_window()

    os._exit(0)