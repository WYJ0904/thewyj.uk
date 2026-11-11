param([ValidatePattern('^node-[a-z0-9-]+$')][string]$OutputName='node-verified')
$ErrorActionPreference='Stop'
$p03Base=Join-Path (Get-Location) ('docs/migration-evidence/finance-p03/phase-a/'+$OutputName)
if(Test-Path Env:P03_FROZEN_OUTPUT_PREFIX){Remove-Item Env:P03_FROZEN_OUTPUT_PREFIX}
if(Test-Path -LiteralPath $p03Base){throw 'Preserve previous executions'}
New-Item -ItemType Directory -Path $p03Base | Out-Null
$p03Results=@()
$p03Runs=@(
    @('aeris-node','local-backend/test_aeris_state_consistency.mjs'),
    @('aeris-dom','qa/aeris/state-consistency-browser.mjs'),
    @('task21','local-backend/test_task21_notification_js.mjs'),
    @('task16','local-backend/test_task16_d1_js.mjs'),
    @('task17','local-backend/test_task17_d1_js.mjs'),
    @('p03-server','qa/finance-p03/server.mjs'),
    @('p03-legacy','qa/finance-p03/legacy-raw.mjs'),
    @('p03-migration','qa/finance-p03/migration.mjs'),
    @('closeout-server','qa/finance-p03/closeout/clearing.mjs'),
    @('closeout-d1','qa/finance-p03/closeout/migration.mjs'),
    @('p02-web','qa/finance-p02/web-contracts.mjs'),
    @('p02-dom','qa/finance-p02/web-dom.mjs'),
    @('p02-d1','qa/finance-p02/ledger-d1.mjs')
)
foreach($p03Run in $p03Runs){
    $p03Name=$p03Run[0]
    $p03Script=$p03Run[1]
    $p03Log=Join-Path $p03Base ($p03Name+'.log')
    $env:FINANCE_P03_OUTPUT=if($p03Name.StartsWith('p02-')){Join-Path $p03Base 'p02-web'}else{Join-Path $p03Base $p03Name}
    [string[]]$p03Args=if($p03Name.StartsWith('p02-')){@('--import','./qa/finance-p03/phase-a/output-redirect.mjs',$p03Script)}else{@($p03Script)}
    $p03Started=[DateTime]::UtcNow.ToString('o')
    $ErrorActionPreference='Continue'
    & node @p03Args *> $p03Log
    $p03Code=$LASTEXITCODE
    $ErrorActionPreference='Stop'
    $p03Results+=@{name=$p03Name;arguments=@($p03Args);command=('node '+($p03Args -join ' '));exit_code=$p03Code;started_utc=$p03Started;finished_utc=[DateTime]::UtcNow.ToString('o');output=$env:FINANCE_P03_OUTPUT;log=$p03Log}
    $p03Results | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $p03Base 'exits.json') -Encoding UTF8
    Write-Output ($p03Name+' exit '+$p03Code)
}
# The frozen P02 red rows must retain their real nonzero exits.
if($p03Results | Where-Object { $_.exit_code -ne 0 -and $_.name -notin @('p02-web','p02-dom') }){exit 1}
