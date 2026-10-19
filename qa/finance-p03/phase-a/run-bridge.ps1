param([ValidateSet('legacy','closeout')][string]$Profile,[ValidatePattern('^[a-z0-9-]+$')][string]$Name)
$ErrorActionPreference='Stop'
$p03Root=(Get-Location).Path
$p03Base=Join-Path $p03Root 'docs/migration-evidence/finance-p03/phase-a'
$p03Output=Join-Path $p03Base $Name
if(Test-Path -LiteralPath $p03Output){throw 'Preserve previous bridge'}
$p03Class=if($Profile -eq 'closeout'){'P03CloseoutBridge'}else{'P03Bridge'}
& ./qa/finance-p03/phase-a/run-gradle.ps1 -Flavor P03 -Name ($Name+'-seed') -OutputName $Name -Tests @('*'+$p03Class+'SeedTest')
$p03SeedCode=$LASTEXITCODE
if($p03SeedCode -ne 0){exit $p03SeedCode}
$env:FINANCE_P03_OUTPUT=$p03Output
$env:FINANCE_P03_BRIDGE_PROFILE=$Profile
$p03Node=(Get-Command node).Source
$p03Server=Start-Process -FilePath $p03Node -ArgumentList @('qa/finance-p03/bridge-server.mjs') -WorkingDirectory $p03Root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $p03Base ($Name+'-server.log')) -RedirectStandardError (Join-Path $p03Base ($Name+'-server-stderr.log'))
$p03RestoreCode=-1
$p03Stop='NOT_ATTEMPTED'
try {
    $p03PortFile=Join-Path $p03Output 'port.json'
    $p03Deadline=[DateTime]::UtcNow.AddSeconds(30)
    while(!(Test-Path -LiteralPath $p03PortFile)){
        if($p03Server.HasExited -or [DateTime]::UtcNow -gt $p03Deadline){throw 'Owned bridge did not become ready'}
        Start-Sleep -Milliseconds 500
    }
    $p03Port=Get-Content -LiteralPath $p03PortFile -Raw | ConvertFrom-Json
    if($p03Port.pid -ne $p03Server.Id){throw 'Unexpected bridge identity'}
    & ./qa/finance-p03/phase-a/run-gradle.ps1 -Flavor P03 -Name ($Name+'-restore') -OutputName $Name -Tests @('*'+$p03Class+'RestoreTest')
    $p03RestoreCode=$LASTEXITCODE
} finally {
    if($p03Port -and $p03Port.pid -eq $p03Server.Id){
        try {Invoke-WebRequest -Uri ('http://127.0.0.1:'+$p03Port.port+'/_p03_shutdown') -Method Post -TimeoutSec 10 -UseBasicParsing | Out-Null;$p03Stop='OWN_QA_HTTP_SHUTDOWN'}
        catch {$p03Stop='SHUTDOWN_REQUEST_FAILED_WATCHDOG_REMAINS'}
    }
    $p03Exited=$p03Server.WaitForExit(10000)
    @{profile=$Profile;seed_exit=$p03SeedCode;restore_exit=$p03RestoreCode;server_pid=$p03Server.Id;server_exited=$p03Exited;shutdown=$p03Stop} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $p03Base ($Name+'-run.json')) -Encoding UTF8
}
Get-Content -LiteralPath (Join-Path $p03Output 'server-final.json')
exit $p03RestoreCode
