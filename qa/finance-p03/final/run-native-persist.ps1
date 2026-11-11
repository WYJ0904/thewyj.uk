param([ValidatePattern('^native-persist(?:-[0-9]+)?$')][string]$Name='native-persist')
$ErrorActionPreference='Stop'
$probeBase=Join-Path (Get-Location).Path 'docs/migration-evidence/finance-p03/final'
if(Test-Path -LiteralPath (Join-Path $probeBase $Name)){throw 'Preserve prior probe'}
$env:FINANCE_P03_PERSIST_NAME=$Name
$probeNode=(Get-Command node).Source
$probe=Start-Process -FilePath $probeNode -ArgumentList @('qa/finance-p03/final/native-persist-worker.mjs') -WorkingDirectory (Get-Location).Path -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $probeBase ($Name+'.log')) -RedirectStandardError (Join-Path $probeBase ($Name+'-stderr.log'))
$probeStart=[DateTime]::UtcNow
while(!$probe.HasExited -and ([DateTime]::UtcNow-$probeStart).TotalSeconds -lt 75){Start-Sleep -Milliseconds 500}
$probeStopped=@()
if(!$probe.HasExited){
    $probeChildren=@(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($probe.Id)" | Where-Object Name -In @('workerd.exe','node.exe'))
    foreach($child in $probeChildren){$probeStopped+=@{pid=$child.ProcessId;parent=$child.ParentProcessId;name=$child.Name};Stop-Process -Id $child.ProcessId -Force -ErrorAction SilentlyContinue}
    if((Get-Process -Id $probe.Id -ErrorAction SilentlyContinue).Path -eq $probeNode){Stop-Process -Id $probe.Id -Force -ErrorAction SilentlyContinue}
    @{case_id='FM09-NATIVE-MINIFLARE-BINARY-COPY';status='NOT_TESTED';reason='Owned persistent runtime exceeded 75-second diagnostic watchdog; no acceptance assertion was extended';pid=$probe.Id;stopped_owned_children=$probeStopped} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $probeBase ($Name+'/result.json')) -Encoding UTF8
}
@{command='node';arguments=@('qa/finance-p03/final/native-persist-worker.mjs');pid=$probe.Id;finished_utc=[DateTime]::UtcNow.ToString('o');seconds=([DateTime]::UtcNow-$probeStart).TotalSeconds;stopped_owned_children=$probeStopped} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $probeBase ($Name+'-run.json')) -Encoding UTF8
Get-Content -LiteralPath (Join-Path $probeBase ($Name+'/result.json'))

$result=Get-Content -Raw -LiteralPath (Join-Path $probeBase ($Name+'/result.json')) | ConvertFrom-Json
if($result.status -ne 'PASS'){exit 1}
