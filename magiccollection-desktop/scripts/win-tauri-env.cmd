@echo off
setlocal

set "ROOT=%~dp0.."
set "NODE_BIN=%ROOT%\tools\node"
set "CARGO_BIN=%USERPROFILE%\.cargo\bin"
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
set "VS_INSTALL="
set "LAUNCH_DEV_CMD="

if not exist "%VSWHERE%" (
  echo [ERROR] vswhere.exe not found at "%VSWHERE%".
  exit /b 1
)

for /f "usebackq delims=" %%I in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do (
  set "VS_INSTALL=%%I"
)

if "%VS_INSTALL%"=="" (
  echo [ERROR] Visual C++ Build Tools installation not found.
  exit /b 1
)

set "LAUNCH_DEV_CMD=%VS_INSTALL%\Common7\Tools\VsDevCmd.bat"
if not exist "%LAUNCH_DEV_CMD%" (
  echo [ERROR] VsDevCmd.bat not found at "%LAUNCH_DEV_CMD%".
  exit /b 1
)

set "PATH=%NODE_BIN%;%CARGO_BIN%;%PATH%"
call "%LAUNCH_DEV_CMD%" -arch=amd64 -host_arch=amd64 >nul

if "%~1"=="" (
  echo [INFO] Visual Studio and Rust environment loaded.
  where link
  where cargo
  where node
  exit /b 0
)

cd /d "%ROOT%"
call %*
set "EXIT_CODE=%ERRORLEVEL%"
endlocal & exit /b %EXIT_CODE%
