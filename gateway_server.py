# Gateway cho môi trường dev (run_dev.bat). Bản đóng gói dùng app_launcher.py.
import uvicorn
from fastapi.middleware.cors import CORSMiddleware

from studio_settings import HOST, PORT, apply_gateway_env, cleanup_stale_driver_chrome

apply_gateway_env()

from muse2api.app import create_app  # noqa: E402  (phải import sau khi đặt env)

app = create_app()

from studio_api import router as studio_router  # noqa: E402

app.include_router(studio_router)
from studio_product import router as product_router  # noqa: E402

app.include_router(product_router)
from studio_media import router as media_router  # noqa: E402

app.include_router(media_router)
from studio_ai import router as ai_router  # noqa: E402

app.include_router(ai_router)

# Bật CORS để Vite dev server (http://localhost:5173) gọi được Gateway
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if __name__ == "__main__":
    cleanup_stale_driver_chrome()  # Chrome ngầm còn sót từ lần chạy trước
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
