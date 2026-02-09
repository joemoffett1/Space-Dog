@echo off
setlocal

set "ROOT=%~dp0.."
set "NODE_BIN=%ROOT%\tools\node"
set "NPM_CMD=%NODE_BIN%\npm.cmd"
set "CARGO_BIN=%USERPROFILE%\.cargo\bin"
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
set "LAUNCH_DEV_CMD="

if not exist "%NPM_CMD%" (
  echo [ERROR] Node runtime not found at "%NPM_CMD%".
  echo         Install or extract portable Node into "%NODE_BIN%".
  exit /b 1
)

if exist "%VSWHERE%" (
  for /f "usebackq delims=" %%I in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do (
    set "LAUNCH_DEV_CMD=%%I\Common7\Tools\VsDevCmd.bat"
  )
)

if exist "%CARGO_BIN%" (
  set "PATH=%NODE_BIN%;%CARGO_BIN%;%PATH%"
) else (
  set "PATH=%NODE_BIN%;%PATH%"
)

cd /d "%ROOT%"
if defined LAUNCH_DEV_CMD (
  if exist "%LAUNCH_DEV_CMD%" (
    call "%LAUNCH_DEV_CMD%" -arch=amd64 -host_arch=amd64 >nul
  )
)

if "%CARGO_BUILD_JOBS%"=="" set "CARGO_BUILD_JOBS=1"
if "%CARGO_INCREMENTAL%"=="" set "CARGO_INCREMENTAL=0"

call "%NPM_CMD%" %*
set "EXIT_CODE=%ERRORLEVEL%"
endlocal & exit /b %EXIT_CODE%
