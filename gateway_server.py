# I:\AiFast\MUSE\srcs\MuseVideoStudio\gateway_server.py
import os
import uvicorn
from fastapi.middleware.cors import CORSMiddleware

# Đặt biến môi trường mặc định
os.environ.setdefault("MUSE2API_HOST", "127.0.0.1")
os.environ.setdefault("MUSE2API_PORT", "18610")
os.environ.setdefault("MUSE2API_DRIVER", "browser")
os.environ.setdefault("MUSE2API_API_KEY", "m2a_secret_key")

from muse2api.app import create_app

# Khởi tạo app FastAPI từ thư viện
app = create_app()

# Bật CORS Middleware toàn diện để nhận mọi request OPTIONS/POST từ React
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=18610, log_level="info")