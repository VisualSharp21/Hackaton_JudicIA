@echo off
REM ============================================================================
REM  Pulso TIC - Instalador do protocolo pulsodiag://
REM  Registra o protocolo para o USUARIO ATUAL (HKCU) - nao precisa de Admin.
REM  Faz o botao "Rodar diagnostico agora" do Pulso TIC executar o
REM  pre-diagnostico.ps1 desta mesma pasta.
REM
REM  Rode uma vez por maquina/usuario. Se mover a pasta, rode de novo.
REM ============================================================================

setlocal enabledelayedexpansion
chcp 65001 >nul

set "PS1=%~dp0pre-diagnostico.ps1"
set "PWSH=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"

if not exist "%PS1%" (
  echo ERRO: nao encontrei pre-diagnostico.ps1 nesta pasta.
  echo Esperado em: %PS1%
  pause
  exit /b 1
)

REM -- Dobra as barras invertidas para o formato .reg --
set "PS1R=!PS1:\=\\!"
set "PWSHR=!PWSH:\=\\!"

set "REGFILE=%TEMP%\pulsodiag_install.reg"
> "%REGFILE%" echo Windows Registry Editor Version 5.00
>>"%REGFILE%" echo.
>>"%REGFILE%" echo [HKEY_CURRENT_USER\Software\Classes\pulsodiag]
>>"%REGFILE%" echo @="URL:Pulso TIC Pre-diagnostico"
>>"%REGFILE%" echo "URL Protocol"=""
>>"%REGFILE%" echo.
>>"%REGFILE%" echo [HKEY_CURRENT_USER\Software\Classes\pulsodiag\shell\open\command]
>>"%REGFILE%" echo @="\"!PWSHR!\" -NoProfile -ExecutionPolicy Bypass -File \"!PS1R!\" \"%%1\""

reg import "%REGFILE%" >nul 2>&1
set "RC=%ERRORLEVEL%"
del "%REGFILE%" >nul 2>&1

echo.
if "%RC%"=="0" (
  echo Protocolo pulsodiag:// instalado para o usuario atual.
  echo Aponta para: %PS1%
  echo.
  echo Agora, no Pulso TIC, o botao "Rodar diagnostico agora" ja funciona.
) else (
  echo Falha ao importar o registro ^(codigo %RC%^).
)
echo.
echo Para desinstalar: reg delete "HKCU\Software\Classes\pulsodiag" /f
echo.
pause
endlocal
