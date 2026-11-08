@echo off
chcp 65001 >nul
echo ===================================================
echo   DONG GOI MUSE AI VIDEO BATCH STUDIO (.EXE)
echo ===================================================

:: 1. Kiem tra muse2api (da nhung san trong repo, kem ban va Windows)
if not exist "muse2api\src\muse2api" (
    echo [LOI] Khong tim thay thu muc muse2api. Thu muc nay nam trong repo, KHONG clone lai tu GitHub
    echo       vi ban goc thieu cac ban va Windows ^(cdp.py, chromium.py^).
    pause
    exit /b 1
)
echo [1/5] Thu muc muse2api da san sang.

:: 2. Build giao dien ReactJS Vite
echo [2/5] Dang build giao dien ReactJS Vite...
cd frontend
call npm install
call npm run build
if %errorlevel% neq 0 (
    echo [LOI] Khong the build giao dien ReactJS!
    pause
    exit /b %errorlevel%
)
cd ..

:: 3. Cai dat thu vien Python va muse2api
echo [3/5] Dang cai dat muse2api va cac thu vien dong goi...
pip install -r requirements.txt
if exist "muse2api" (
    pip install -e ./muse2api
)

:: 4. Don dep thu muc build cu
echo [4/5] Dang don dep thu muc build cu...
if exist build rmdir /s /q build
if exist dist rmdir /s /q dist

:: 5. Dong goi thanh 1 file .EXE duy nhat
echo [5/5] Dang dong goi thanh file MuseVideoStudio.exe...
pyinstaller --noconfirm --clean ^
    --name "MuseVideoStudio" ^
    --onefile ^
    --paths "muse2api/src" ^
    --noconsole ^
    --add-data "frontend/dist;frontend_dist" ^
    --collect-all muse2api ^
    --collect-all uvicorn ^
    --collect-all fastapi ^
    --collect-all starlette ^
    --collect-all webview ^
    app_launcher.py

echo ===================================================
echo   HOAN TAT! File chay nam tai: dist\MuseVideoStudio.exe
echo ===================================================
pause
