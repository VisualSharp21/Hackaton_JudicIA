@echo off
REM ============================================================================
REM  Pulso TIC - Pre-diagnostico do computador
REM  Executa o pre-diagnostico.ps1 (mesma pasta): mostra o relatorio no terminal
REM  e copia um bloco JSON estruturado para colar na area "Pre-diagnostico"
REM  do Pulso TIC. Tudo e somente leitura; nada e alterado no computador.
REM
REM  Como usar: de dois cliques neste arquivo (ou execute no Prompt de Comando).
REM  Dica: executar como Administrador traz mais detalhes de dispositivos.
REM ============================================================================

chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pre-diagnostico.ps1"

echo.
echo Pressione uma tecla para sair...
pause >nul
