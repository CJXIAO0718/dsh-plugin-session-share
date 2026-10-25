@echo off
setlocal
title DSH restore (emergency)
echo ============================================================
echo  DSH emergency restore
echo  Rollback the plugin config so DSH can start again.
echo  It only replaces cordis.patch.yml; a backup is kept.
echo  Safe for automation: add -ListOnly / -NoPause as arguments.
echo ============================================================
echo.

set "PS1=%~dp0restore-if-broken.ps1"
if not exist "%PS1%" (
  echo [X] restore-if-broken.ps1 not found next to this file:
  echo     %PS1%
  echo     Keep both files in the same folder.
  set "RC=1"
  goto :done
)

rem Default execution policy blocks unsigned .ps1, so always pass Bypass.
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
set "RC=%ERRORLEVEL%"
echo.
echo [exit code: %RC%]

:done
if not defined RC set "RC=1"
rem Keep the window open for double-click users; skip it when -NoPause is given.
echo %* | findstr /i /c:"-NoPause" >nul
if errorlevel 1 pause

set "FINAL=%RC%"
endlocal & exit /b %FINAL%
