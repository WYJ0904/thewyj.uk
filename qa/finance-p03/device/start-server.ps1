param([ValidateRange(6,20)][int]$Generation)
$ErrorActionPreference='Stop'
$backendOut=Join-Path (Get-Location) 'docs/migration-evidence/finance-p03/device'
$prior='server-runtime'+($Generation-1)+'/stopped.json'
$backendDeadline=[DateTime]::UtcNow.AddSeconds(20)
while(!(Test-Path -LiteralPath (Join-Path $backendOut $prior))){if([DateTime]::UtcNow -gt $backendDeadline){throw 'Prior owned backend must close'};Start-Sleep -Milliseconds 200}
if(Test-Path -LiteralPath (Join-Path $backendOut ('server-runtime'+$Generation))){throw 'Preserve prior attempt'}
$env:P03_DEVICE_BACKEND_RUN=[string]$Generation
$backendProcess=Start-Process -FilePath (Get-Command node).Source -ArgumentList @('qa/finance-p03/device/server.mjs') -WorkingDirectory (Get-Location).Path -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $backendOut ('server'+$Generation+'.log')) -RedirectStandardError (Join-Path $backendOut ('server'+$Generation+'-stderr.log'))
@{owned_pid=$backendProcess.Id;generation=$Generation;synthetic_only=$true}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $backendOut ('server'+$Generation+'-process.json')) -Encoding UTF8
$backendReady=Join-Path $backendOut ('server'+$Generation+'-ready.json');$backendDeadline=[DateTime]::UtcNow.AddSeconds(25)
while(!(Test-Path -LiteralPath $backendReady)){if($backendProcess.HasExited -or [DateTime]::UtcNow -gt $backendDeadline){throw 'Owned backend readiness failed'};Start-Sleep -Milliseconds 200}
Get-Content -LiteralPath $backendReady -Raw
