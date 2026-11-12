@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo ===================================================
echo   DONG GOI MUSE AI VIDEO BATCH STUDIO (.EXE) DE BAN GIAO
echo ===================================================
echo   Tuy chon: build_exe.bat full   = kem clip day du cho nut Play (~160 MB)
echo.

:: 1. Kiem tra muse2api (da nhung san trong repo, kem ban va Windows)
if not exist "muse2api\src\muse2api" (
    echo [LOI] Khong tim thay thu muc muse2api. Thu muc nay nam trong repo, KHONG clone lai tu GitHub
    echo       vi ban goc thieu cac ban va Windows ^(cdp.py, chromium.py^).
    goto :fail
)
echo [1/5] Thu muc muse2api da san sang.

:: 2. Build giao dien React (goi vite truc tiep bang node: khong phu thuoc npm run, tranh loi npm)
echo [2/5] Dang build giao dien...
pushd frontend
if not exist "node_modules\vite\bin\vite.js" (
    echo       Chua co node_modules - dang cai thu vien ^(npm install^)...
    call npm install
)
if exist dist rmdir /s /q dist
node node_modules\vite\bin\vite.js build
popd
if not exist "frontend\dist\index.html" (
    echo [LOI] Build giao dien that bai: khong co frontend\dist\index.html
    goto :fail
)

:: 3. Thu vien Python can de dong goi (khong cai lai muse2api: spec lay thang ban trong repo)
echo [3/5] Kiem tra thu vien Python...
python -m pip install -q -r requirements.txt
if errorlevel 1 (
    echo [LOI] Cai thu vien Python that bai ^(xem loi o tren^).
    goto :fail
)

:: 4. Dong goi exe theo MuseVideoStudio.spec (chi goi giao dien + ma Python, KHONG goi data/ log / media / cookie)
echo [4/5] Dang dong goi MuseVideoStudio.exe ^(vai phut^)...
if exist build rmdir /s /q build
if exist dist rmdir /s /q dist
python -m PyInstaller --noconfirm --clean MuseVideoStudio.spec
if not exist "dist\MuseVideoStudio.exe" (
    echo [LOI] PyInstaller khong tao duoc dist\MuseVideoStudio.exe ^(xem loi o tren^).
    goto :fail
)

:: 5. Gom thu muc ban giao: exe + wfthumb + ffmpeg + huong dan, nen zip
echo [5/5] Dang gom thu muc ban giao...
if /i "%~1"=="full" (
    python tools\package_release.py --full-clips
) else (
    python tools\package_release.py
)
if errorlevel 1 goto :fail

echo ===================================================
echo   HOAN TAT! Thu muc + file zip ban giao nam trong: release\
echo ===================================================
pause
exit /b 0

:fail
echo ===================================================
echo   DONG GOI THAT BAI
echo ===================================================
pause
exit /b 1
