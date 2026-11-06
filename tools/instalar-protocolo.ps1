# ============================================================================
#  Pulso TIC - Instalador do protocolo pulsodiag:// via PowerShell
#  Registra o protocolo para o USUARIO ATUAL (HKCU) - nao precisa de Admin.
#  Faz o botao "Rodar diagnostico agora" do Pulso TIC executar o
#  pre-diagnostico.ps1 desta mesma pasta.
#
#  Como executar:
#  powershell -ExecutionPolicy Bypass -File .\tools\instalar-protocolo.ps1
# ============================================================================

[Console]::OutputEncoding = [Text.Encoding]::UTF8

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $scriptDir) { $scriptDir = (Get-Location).Path }
$ps1Path = Join-Path $scriptDir "pre-diagnostico.ps1"
$pwshPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"

if (-not (Test-Path $ps1Path)) {
    Write-Error "ERRO: nao encontrei pre-diagnostico.ps1 em: $ps1Path"
    Write-Host "Pressione qualquer tecla para sair..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    exit 1
}

$regKey = "HKCU:\Software\Classes\pulsodiag"
$cmdKey = "$regKey\shell\open\command"

try {
    if (-not (Test-Path $regKey)) {
        New-Item -Path $regKey -Force | Out-Null
    }
    Set-ItemProperty -Path $regKey -Name "(default)" -Value "URL:Pulso TIC Pre-diagnostico"
    Set-ItemProperty -Path $regKey -Name "URL Protocol" -Value ""

    if (-not (Test-Path $cmdKey)) {
        New-Item -Path $cmdKey -Force | Out-Null
    }
    $cmdValue = "`"$pwshPath`" -NoProfile -ExecutionPolicy Bypass -File `"$ps1Path`" `"%1`""
    Set-ItemProperty -Path $cmdKey -Name "(default)" -Value $cmdValue

    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host "  Protocolo pulsodiag:// instalado com sucesso!" -ForegroundColor Green
    Write-Host "  Aponta para: $ps1Path" -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Agora, no Pulso TIC, o botao 'Rodar diagnostico agora' executara o pre-diagnostico.ps1 diretamente."
} catch {
    Write-Error "Falha ao registrar protocolo no registro do Windows: $_"
}

Write-Host ""
Write-Host "Pressione qualquer tecla para sair..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
