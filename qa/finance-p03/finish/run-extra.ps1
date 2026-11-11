$ErrorActionPreference='Stop'
$finishCommands=@();$finishManifest='docs/migration-evidence/finance-p03/finish/extra-commands.json'
if(Test-Path -LiteralPath $finishManifest){throw 'Preserve every attempt'}
foreach($finishCase in @(
 @('device-reconciliation','qa/finance-p03/phase-a/reconciliation.mjs'),
 @('device-correction-migration','qa/finance-p03/final/correction-migration.mjs'),
 @('device-resolution','qa/finance-p03/final/resolution.mjs'),
 @('device-controls','qa/finance-p03/final/controls.mjs'),
 @('device-d1-migration','qa/finance-p03/final/migration.mjs'),
 @('device-projections','qa/finance-p03/finish/projections.mjs'),
 @('device-local-sandbox','qa/finance-p03/final/local-sandbox.mjs')
)){
 $finishAt=[DateTime]::UtcNow.ToString('o')
 & ./docs/migration-evidence/finance-p03/finish/regression-runners/run-one.ps1 -Name $finishCase[0] -Script $finishCase[1]
 $finishCommands+=@{command='run-one.ps1';name=$finishCase[0];script=$finishCase[1];exit_code=$LASTEXITCODE;started_utc=$finishAt;finished_utc=[DateTime]::UtcNow.ToString('o')}
 $finishCommands|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $finishManifest -Encoding UTF8
}
if($finishCommands|Where-Object{$_.exit_code -ne 0}){exit 1}
