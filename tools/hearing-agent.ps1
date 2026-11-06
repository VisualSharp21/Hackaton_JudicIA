param(
  [Parameter(Mandatory=$true)][string]$ApiBase,
  [Parameter(Mandatory=$true)][string]$TenantId,
  [Parameter(Mandatory=$true)][string]$StationId,
  [Parameter(Mandatory=$true)][string]$TokenFile,
  [string[]]$AllowedDeviceIds = @(),
  [switch]$AllowEnableAudioDevice,
  [switch]$Once
)
# Run under an explicitly provisioned station account. Token file must have a
# restrictive ACL. The service never executes shell text supplied by the API/LLM.
$ErrorActionPreference = 'Stop'
$base = [Uri]$ApiBase
if ($base.Scheme -ne 'https' -and -not $base.IsLoopback) { throw 'Agente remoto exige HTTPS.' }
$agentToken = (Get-Content -LiteralPath $TokenFile -Raw).Trim()
$headers = @{ Authorization = "Bearer $agentToken" }
$query = '?tenantId=' + [Uri]::EscapeDataString($TenantId) + '&stationId=' + [Uri]::EscapeDataString($StationId)
$apiRoot = $ApiBase.TrimEnd('/') + '/api/prevention/agent'
do {
  try {
    $tasks = Invoke-RestMethod -Uri ($apiRoot + '/tasks' + $query) -Headers $headers -TimeoutSec 15
    foreach ($task in $tasks.tasks) {
      $actionResult = $null
      if ($task.action) {
        $actionResult = @{ id=$task.action.id; status='FAILED'; evidence='Ação não autorizada localmente ou dispositivo fora da lista.' }
        if ($AllowEnableAudioDevice -and $task.action.name -eq 'enable_audio_device') {
          $changed = @()
          try {
            foreach ($deviceId in $task.action.deviceIds) {
              if ($AllowedDeviceIds -notcontains $deviceId) { continue }
              $device = Get-PnpDevice -InstanceId $deviceId -ErrorAction Stop
              if ($device.Class -notin @('AudioEndpoint','MEDIA')) { continue }
              $problem = Get-PnpDeviceProperty -InstanceId $deviceId -KeyName 'DEVPKEY_Device_ProblemCode'
              if ($problem.Data -ne 22) { continue }
              Enable-PnpDevice -InstanceId $deviceId -Confirm:$false
              $changed += $deviceId
              if ((Get-PnpDevice -InstanceId $deviceId).Status -ne 'OK') { throw 'Reverificação PnP falhou.' }
            }
            if ($changed.Count -gt 0) { $actionResult = @{ id=$task.action.id; status='EXECUTED'; evidence='Dispositivo antes desabilitado foi habilitado e PnP reavaliado. Captura funcional ainda exige navegador.' } }
          } catch {
            foreach ($deviceId in $changed) { Disable-PnpDevice -InstanceId $deviceId -Confirm:$false -ErrorAction Continue }
            $actionResult = @{ id=$task.action.id; status='ROLLED_BACK'; evidence='Reverificação falhou; dispositivos alterados foram desabilitados novamente.' }
          }
        }
      }
      $checks = @()
      foreach ($item in @(@{name='camera';classes=@('Camera','Image')}, @{name='microphone';classes=@('AudioEndpoint')}, @{name='audio';classes=@('MEDIA')})) {
        $devices = @(Get-PnpDevice -PresentOnly | Where-Object { $item.classes -contains $_.Class })
        $disabled = @($devices | Where-Object { (Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName 'DEVPKEY_Device_ProblemCode' -ErrorAction SilentlyContinue).Data -eq 22 })
        $status = 'UNVERIFIABLE'; $evidence = 'Inventário não encontrou dispositivo; não comprova ausência física.'
        if ($devices.Count -gt 0) { $status='DETECTED'; $evidence='PnP detectou dispositivo. Captura e qualidade funcional não verificadas.' }
        if ($disabled.Count -gt 0) { $status='FAIL'; $evidence='DISABLED_CODE_22: dispositivo de áudio/câmera desabilitado no PnP.' }
        $checks += @{ name=$item.name; status=$status; evidence=$evidence }
      }
      if ($task.target) {
        # Fixed four ICMP probes to an administrator-configured IP; ICMP failure
        # may mean filtering. It is not by itself evidence of a station outage.
        $ping = New-Object System.Net.NetworkInformation.Ping
        $samples = @()
        for ($n=0; $n -lt 4; $n++) { try { $reply=$ping.Send([string]$task.target,1000); if ($reply.Status -eq 'Success') { $samples += $reply.RoundtripTime } } catch {} }
        $ping.Dispose()
        $loss = 100 * (4-$samples.Count)/4
        $latency = if ($samples.Count) { ($samples | Measure-Object -Average).Average } else { $null }
        $checks += @{ name='connectivity'; status=$(if ($samples.Count) { 'PASS' } else { 'UNVERIFIABLE' }); evidence='Quatro sondas ICMP locais; ausência de resposta pode indicar filtragem.'; metrics=@{ latencyMs=$latency; packetLossPct=$loss } }
      } else { $checks += @{name='connectivity';status='UNVERIFIABLE';evidence='Nenhum alvo autorizado de conectividade.'} }
      $payload = @{ jobId=$task.jobId; nonce=$task.nonce; checks=$checks; actionResult=$actionResult } | ConvertTo-Json -Depth 10
      $null = Invoke-RestMethod -Uri ($apiRoot + '/report' + $query) -Headers $headers -Method Post -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($payload)) -TimeoutSec 15
    }
  } catch { Write-Warning 'Falha no ciclo do agente. Nova tentativa no próximo ciclo; credenciais não registradas.' }
  if (-not $Once) { Start-Sleep -Seconds 10 }
} while (-not $Once)
