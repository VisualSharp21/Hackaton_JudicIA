# ============================================================================
#  Pulso TIC - Pre-diagnostico do computador (logica)
#  Executado pelo pre-diagnostico.bat. Mostra o relatorio no terminal e gera
#  um bloco JSON estruturado (copiado para a area de transferencia) para colar
#  na area "Pre-diagnostico" do Pulso TIC. Tudo e somente leitura.
# ============================================================================
#  Quando chamado pelo protocolo pulsodiag:// (botao "Rodar agora" no
#  Pulso TIC), recebe a URL como argumento, coleta os dados e os ENVIA direto
#  para a API; a pagina preenche sozinha. Sem argumento, funciona como antes
#  (relatorio no terminal + bloco JSON copiado para a area de transferencia).
# ============================================================================

param([string]$Protocol = '')

[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'SilentlyContinue'

# ------------------------- Coleta: sistema -------------------------
$os  = Get-CimInstance Win32_OperatingSystem
$cs  = Get-CimInstance Win32_ComputerSystem
$cpu = (Get-CimInstance Win32_Processor | Select-Object -First 1).Name
$up  = (Get-Date) - $os.LastBootUpTime

# ------------------------- Coleta: rede -------------------------
$adapters = foreach ($c in (Get-NetIPConfiguration | Where-Object { $_.NetAdapter.Status -eq 'Up' })) {
  [pscustomobject]@{
    nome    = $c.InterfaceAlias
    ipv4    = ($c.IPv4Address.IPAddress -join ', ')
    gateway = ($c.IPv4DefaultGateway.NextHop -join ', ')
    dns     = (($c.DNSServer | Where-Object { $_.AddressFamily -eq 2 }).ServerAddresses -join ', ')
  }
}
$gw = (Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } | Select-Object -First 1).IPv4DefaultGateway.NextHop
$pingGateway  = if ($gw) { [bool](Test-Connection -ComputerName $gw -Count 2 -Quiet) } else { $null }
$pingInternet = [bool](Test-Connection -ComputerName 8.8.8.8 -Count 2 -Quiet)
$dnsOk = $false
try { $null = Resolve-DnsName -Name www.google.com -ErrorAction Stop; $dnsOk = $true } catch { $dnsOk = $false }

# ------------------------- Coleta: Microsoft Teams -------------------------
$teamsDetalhes = @()
$new = Get-AppxPackage -Name MSTeams
if ($new) { $teamsDetalhes += 'Novo Teams (Microsoft Teams) v' + $new.Version }
$cl = $env:LOCALAPPDATA + '\Microsoft\Teams\current\Teams.exe'
if (Test-Path $cl) { $teamsDetalhes += 'Teams classico v' + ((Get-Item $cl).VersionInfo.ProductVersion) }
$pf = $env:ProgramFiles + '\Teams Installer\Teams.exe'
$px = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)') + '\Teams Installer\Teams.exe'
if ((Test-Path $pf) -or (Test-Path $px)) { $teamsDetalhes += 'Instalador machine-wide presente' }
$teamsInstalado = [bool]($teamsDetalhes.Count -gt 0)
$teamsProc = [bool](Get-Process -Name ms-teams, Teams)

# ------------------------- Coleta: dispositivos / drivers -------------------------
$map = @{
  1='Nao configurado'; 3='Driver corrompido'; 10='Nao pode iniciar'; 12='Recursos insuficientes';
  14='Reinicio necessario'; 18='Reinstalar drivers'; 19='Registro corrompido'; 22='Desabilitado';
  24='Ausente ou com defeito'; 28='Driver nao instalado'; 29='Firmware desabilitou';
  31='Driver nao funcional'; 32='Servico do driver desabilitado'; 33='Nao determina recursos';
  35='Falta entrada no BIOS'; 37='Driver falhou ao iniciar'; 38='Driver anterior ainda na memoria';
  39='Driver corrompido ou ausente'; 40='Info de servico invalida'; 43='Windows parou o dispositivo';
  44='Aplicativo parou o dispositivo'; 45='Nao conectado'; 46='Indisponivel'; 47='Preparado para remocao';
  48='Execucao bloqueada'; 49='Hive do sistema cheio'; 52='Driver sem assinatura valida'
}
$all    = Get-CimInstance Win32_PnPEntity
$badRaw = $all | Where-Object { $_.ConfigManagerErrorCode -ne 0 -and $_.ConfigManagerErrorCode -ne $null }
$okCount = ($all | Where-Object { $_.ConfigManagerErrorCode -eq 0 }).Count
$badList = foreach ($d in ($badRaw | Sort-Object Name)) {
  $c = [int]$d.ConfigManagerErrorCode
  $desc = $map[$c]; if (-not $desc) { $desc = 'codigo ' + $c }
  [pscustomobject]@{ nome = $d.Name; codigo = $c; descricao = $desc }
}

# ------------------------- Objeto estruturado -------------------------
$r = [pscustomobject]@{
  schema     = 'pulso-prediag-1'
  geradoEm   = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss')
  computador = $env:COMPUTERNAME
  usuario    = $env:USERNAME
  sistema    = [pscustomobject]@{
    so          = $os.Caption
    versao      = $os.Version
    build       = $os.BuildNumber
    arquitetura = $os.OSArchitecture
    modelo      = ($cs.Manufacturer + ' ' + $cs.Model)
    cpu         = $cpu
    ramTotalGB  = [math]::Round($cs.TotalPhysicalMemory / 1GB, 1)
    ramLivreGB  = [math]::Round($os.FreePhysicalMemory * 1KB / 1GB, 1)
    uptime      = ('{0}d {1}h {2}m' -f $up.Days, $up.Hours, $up.Minutes)
  }
  rede = [pscustomobject]@{
    adaptadores  = @($adapters)
    pingGateway  = $pingGateway
    pingInternet = $pingInternet
    dns          = $dnsOk
  }
  teams = [pscustomobject]@{
    instalado = $teamsInstalado
    detalhes  = @($teamsDetalhes)
    processo  = $teamsProc
  }
  dispositivos = [pscustomobject]@{
    ok       = [int]$okCount
    problema = @($badList).Count
    lista    = @($badList)
  }
}

# ------------------------- Relatorio legivel -------------------------
function Linha { '------------------------------------------------------------' }
$simnao = { param($b) if ($b -eq $null) { 'nao identificado' } elseif ($b) { 'OK' } else { 'FALHA' } }

Write-Output ''
Write-Output '============================================================'
Write-Output '  Pulso TIC - PRE-DIAGNOSTICO DO COMPUTADOR'
Write-Output '============================================================'
Write-Output ''
Write-Output (Linha); Write-Output 'RESUMO RAPIDO'; Write-Output (Linha)
Write-Output ('Internet (ping 8.8.8.8)   : ' + (& $simnao $r.rede.pingInternet))
Write-Output ('Resolucao de DNS          : ' + (& $simnao $r.rede.dns))
Write-Output ('Microsoft Teams           : ' + $(if ($r.teams.instalado) { 'Instalado' } else { 'NAO instalado' }))
Write-Output ('Dispositivos com problema : ' + $r.dispositivos.problema)
Write-Output ''
Write-Output (Linha); Write-Output 'SISTEMA'; Write-Output (Linha)
Write-Output ('Nome do computador : ' + $r.computador)
Write-Output ('Usuario            : ' + $r.usuario)
Write-Output ('Sistema operacional: ' + $r.sistema.so + ' ' + $r.sistema.versao + ' (build ' + $r.sistema.build + ')')
Write-Output ('Arquitetura        : ' + $r.sistema.arquitetura)
Write-Output ('Fabricante/Modelo  : ' + $r.sistema.modelo)
Write-Output ('Processador        : ' + $r.sistema.cpu)
Write-Output ('Memoria RAM        : ' + $r.sistema.ramTotalGB + ' GB total / ' + $r.sistema.ramLivreGB + ' GB livre')
Write-Output ('Tempo ligado       : ' + $r.sistema.uptime)
Write-Output ''
Write-Output (Linha); Write-Output 'REDE'; Write-Output (Linha)
if (@($r.rede.adaptadores).Count -eq 0) { Write-Output 'Nenhum adaptador ativo encontrado.' }
foreach ($a in $r.rede.adaptadores) {
  Write-Output ('Adaptador : ' + $a.nome)
  Write-Output ('IPv4      : ' + $a.ipv4)
  Write-Output ('Gateway   : ' + $a.gateway)
  Write-Output ('DNS       : ' + $a.dns)
  Write-Output ''
}
Write-Output ('Ping gateway   : ' + (& $simnao $r.rede.pingGateway))
Write-Output ('Ping internet  : ' + (& $simnao $r.rede.pingInternet))
Write-Output ('Resolucao DNS  : ' + (& $simnao $r.rede.dns))
Write-Output ''
Write-Output (Linha); Write-Output 'MICROSOFT TEAMS'; Write-Output (Linha)
if ($r.teams.instalado) { foreach ($t in $r.teams.detalhes) { Write-Output $t } } else { Write-Output 'Microsoft Teams: NAO ENCONTRADO' }
Write-Output ('Processo Teams em execucao: ' + $(if ($r.teams.processo) { 'Sim' } else { 'Nao' }))
Write-Output ''
Write-Output (Linha); Write-Output 'DRIVERS / DISPOSITIVOS'; Write-Output (Linha)
Write-Output ('Dispositivos OK (funcionais) : ' + $r.dispositivos.ok)
Write-Output ('Dispositivos com problema    : ' + $r.dispositivos.problema)
if ($r.dispositivos.problema -gt 0) {
  Write-Output ''
  Write-Output 'DISPOSITIVOS COM PROBLEMA:'
  foreach ($d in $r.dispositivos.lista) { Write-Output (' - ' + $d.nome + '  [codigo ' + $d.codigo + ': ' + $d.descricao + ']') }
} else {
  Write-Output 'Nenhum dispositivo com erro detectado.'
}

# ------------------------- Bloco estruturado (JSON) -------------------------
$json = $r | ConvertTo-Json -Depth 6 -Compress
Write-Output ''
Write-Output (Linha)
Write-Output 'DADOS ESTRUTURADOS (cole este bloco na area Pre-diagnostico do Pulso TIC)'
Write-Output (Linha)
Write-Output '----PULSO-JSON-INICIO----'
Write-Output $json
Write-Output '----PULSO-JSON-FIM----'
try {
  Set-Clipboard -Value $json
  Write-Output ''
  Write-Output '>> O bloco JSON foi COPIADO para a area de transferencia. Basta colar (Ctrl+V) no Pulso TIC.'
} catch {
  Write-Output ''
  Write-Output '>> Copie manualmente o bloco entre as marcas acima e cole no Pulso TIC.'
}

# ------------------------- Envio automatico (protocolo pulsodiag://) -------------------------
if ($Protocol -and $Protocol -match '^pulsodiag:') {
  $q = ''
  if ($Protocol -match '\?(.*)$') { $q = $Matches[1] }
  $params = @{}
  foreach ($pair in ($q -split '&')) {
    if ($pair) {
      $kv = $pair -split '=', 2
      if ($kv.Count -eq 2) { $params[$kv[0]] = [Uri]::UnescapeDataString($kv[1]) }
    }
  }
  $token = $params['token']
  $api = $params['api']
  Write-Output ''
  Write-Output (Linha)
  Write-Output 'ENVIO AUTOMATICO PARA O Pulso TIC'
  Write-Output (Linha)
  if ($token -and $api) {
    try {
      $envelope = @{ token = $token; payload = $r } | ConvertTo-Json -Depth 6 -Compress
      $uri = ($api.TrimEnd('/')) + '/api/prediag/ingest'
      Invoke-RestMethod -Uri $uri -Method Post -Body $envelope -ContentType 'application/json' | Out-Null
      Write-Output '>> Resultado ENVIADO. Volte ao navegador: os dados serao preenchidos automaticamente.'
    } catch {
      Write-Output ('>> Falha ao enviar: ' + $_.Exception.Message)
      Write-Output '>> O bloco JSON ja esta na area de transferencia; cole manualmente no Pulso TIC.'
    }
  } else {
    Write-Output '>> Link invalido (sem token/api). Cole o bloco JSON manualmente no Pulso TIC.'
  }
  Write-Output ''
  Write-Output 'Esta janela fecha em alguns segundos...'
  Start-Sleep -Seconds 6
}
