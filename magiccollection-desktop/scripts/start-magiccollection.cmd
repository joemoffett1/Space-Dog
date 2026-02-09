@echo off
setlocal

set "ROOT=%~dp0.."
set "LOG_DIR=%ROOT%\logs"
set "RUN_ID=%RANDOM%%RANDOM%"
set "LOG_FILE=%LOG_DIR%\launcher-%RUN_ID%.log"
set "LATEST_LOG=%LOG_DIR%\launcher.log"
cd /d "%ROOT%"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
echo [%date% %time%] Starting MagicCollection launcher... > "%LOG_FILE%"
copy /Y "%LOG_FILE%" "%LATEST_LOG%" >nul 2>&1

powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\cleanup-dev-processes.ps1" -ProjectRoot "%ROOT%" >> "%LOG_FILE%" 2>&1

call "%ROOT%\scripts\win-npm.cmd" run tauri:dev >> "%LOG_FILE%" 2>&1
set "EXIT_CODE=%ERRORLEVEL%"
copy /Y "%LOG_FILE%" "%LATEST_LOG%" >nul 2>&1

if not "%EXIT_CODE%"=="0" (
  set "HAD_APP_RUN=0"
  set "HAD_DEV_SHUTDOWN=0"
  findstr /L /C:"target\debug\app.exe" "%LOG_FILE%" >nul && set "HAD_APP_RUN=1"
  findstr /L /C:"beforeDevCommand" "%LOG_FILE%" >nul && set "HAD_DEV_SHUTDOWN=1"

  if "%HAD_APP_RUN%"=="1" (
    if "%HAD_DEV_SHUTDOWN%"=="1" (
      echo [INFO] Dev session ended after app startup (normal for manual close).>> "%LOG_FILE%"
      set "EXIT_CODE=0"
    )
  )
)

if not "%EXIT_CODE%"=="0" (
  echo.
  echo [ERROR] MagicCollection could not start. See:
  echo        %LOG_FILE%
  echo [INFO] Most recent log alias:
  echo        %LATEST_LOG%
  echo.
  echo [INFO] If Tauri failed with "cargo not found", install Rust for Windows:
  echo        https://rustup.rs/
  echo.
  pause
)

endlocal & exit /b %EXIT_CODE%
