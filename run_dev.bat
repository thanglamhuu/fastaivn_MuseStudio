@echo off
chcp 65001 >nul
echo ===================================================
echo   KHOI CHAY MOI TRUONG DEV - MUSE VIDEO STUDIO
echo ===================================================

:: Tu dong do tim duong dan Chrome / Edge tren Windows
set "CHROME_PATH="
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" set "CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not defined CHROME_PATH if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" set "CHROME_PATH=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if not defined CHROME_PATH if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "CHROME_PATH=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if not defined CHROME_PATH if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" set "CHROME_PATH=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if not defined CHROME_PATH if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" set "CHROME_PATH=C:\Program Files\Microsoft\Edge\Application\msedge.exe"

if defined CHROME_PATH (
    set "MUSE2API_CHROMIUM_PATH=%CHROME_PATH%"
)

:: Khoi chay Gateway tu chinh kem CORS Middleware
:: Uu tien Python trong .venv (can Python 3.10+), neu khong co thi dung python he thong
set "PY_EXE=python"
if exist "%~dp0.venv\Scripts\python.exe" set "PY_EXE=%~dp0.venv\Scripts\python.exe"
start "Muse2API Local Gateway" cmd /k ""%PY_EXE%" gateway_server.py"

:: Khoi chay giao dien React Vite
cd frontend
if not exist "node_modules" (
    call npm install
)
:: Chay Vite truc tiep bang node (khong phu thuoc npm, tranh loi npm hong)
if exist "node_modules\vite\bin\vite.js" (
    node node_modules\vite\bin\vite.js
) else (
    call npm run dev
)