# Continue only missing jobs; the already executed full/Node/frozen runs remain.
$ErrorActionPreference='Stop'
$npBase=Join-Path (Get-Location) 'docs/migration-evidence/finance-p03/nonphone-entry'
$npRunner=Join-Path $npBase 'regression-runners'
$npManifest=Join-Path $npBase 'continuation-commands.json'
if(Test-Path -LiteralPath $npManifest){throw 'Preserve every attempt'}
$npResults=@()
function Invoke-Np([string]$Name,[scriptblock]$Run){
 $npStarted=[DateTime]::UtcNow.ToString('o'); & $Run; $npExit=$LASTEXITCODE
 $script:npResults+=@{name=$Name;exit_code=$npExit;started_utc=$npStarted;finished_utc=[DateTime]::UtcNow.ToString('o')}
 $script:npResults|ConvertTo-Json -Depth 6|Set-Content -LiteralPath $npManifest -Encoding UTF8
}
Invoke-Np 'trace-five-corrected' {& "$npRunner/run-traces.ps1" -Flavor P02 -Name finish-traces5 -OutputName traces-final -Tests @('*FinanceP03FinishTraceTest','*FinanceP03FinishMigrationTest')}
Invoke-Np 'legacy-bridge' {& "$npRunner/run-bridge.ps1" -Profile legacy -Name legacy-bridge-device}
Invoke-Np 'clearing-bridge' {& "$npRunner/run-bridge.ps1" -Profile closeout -Name clearing-bridge-device}
Invoke-Np 'correction-bridge' {& "$npRunner/run-reconciliation-bridge.ps1" -Name correction-bridge-device}
Invoke-Np 'unified-bridge' {& "$npRunner/run-unified-bridge.ps1" -Name unified-bridge-device}
Invoke-Np 'native-persist' {& "$npRunner/run-native-persist.ps1" -Name native-persist}
foreach($npCase in @(
 @('device-reconciliation','qa/finance-p03/phase-a/reconciliation.mjs'),@('device-correction-migration','qa/finance-p03/final/correction-migration.mjs'),
 @('device-resolution','qa/finance-p03/final/resolution.mjs'),@('device-controls','qa/finance-p03/final/controls.mjs'),
 @('device-providers','qa/finance-p03/final/providers.mjs'),@('device-d1-migration','qa/finance-p03/final/migration.mjs'),
 @('device-projections','qa/finance-p03/finish/projections.mjs'),@('device-local-sandbox','qa/finance-p03/final/local-sandbox.mjs'),
 @('legacy-projection-release','qa/finance-p03/finish/legacy-controls.mjs'),@('legacy-browser-release','qa/finance-p03/finish/legacy-browser.mjs'),
 @('provider-identity-final','qa/finance-p03/finish/provider-identity.mjs')
)) {Invoke-Np $npCase[0] {& "$npRunner/run-one.ps1" -Name $npCase[0] -Script $npCase[1]}}
if($npResults|Where-Object {$_.exit_code -ne 0}){exit 1}
