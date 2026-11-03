$ErrorActionPreference='Stop'
$phaseAResults=@()
function Run-PhaseAGradle([string]$Flavor,[string]$Name,[string]$OutputName,[string[]]$Tests,[switch]$Full){
    & ./qa/finance-p03/phase-a/run-gradle.ps1 -Flavor $Flavor -Name $Name -OutputName $OutputName -Tests $Tests -Full:$Full
    $script:phaseAResults+=@{name=$Name;exit_code=$LASTEXITCODE}
    $script:phaseAResults | ConvertTo-Json | Set-Content -LiteralPath docs/migration-evidence/finance-p03/phase-a/complete-sequence.json -Encoding utf8
}
Run-PhaseAGradle Standard complete-full complete-standard @() -Full
# Frozen expected failures retain their nonzero exit; continue independent runs.
Run-PhaseAGradle P02 complete-p02 complete-p02-native @('*FinanceP02MatrixTest','*FinanceP02TimingTest')
Run-PhaseAGradle P02 complete-p02-seed complete-p02-process @('*FinanceP02SeedTest')
Run-PhaseAGradle P02 complete-p02-restore complete-p02-process @('*FinanceP02RestoreTest')
foreach($phaseAProfile in @('legacy','closeout')){
    & ./qa/finance-p03/phase-a/run-bridge.ps1 -Profile $phaseAProfile -Name ('complete-'+$phaseAProfile)
    $phaseAResults+=@{name=('complete-'+$phaseAProfile);exit_code=$LASTEXITCODE}
    $phaseAResults | ConvertTo-Json | Set-Content -LiteralPath docs/migration-evidence/finance-p03/phase-a/complete-sequence.json -Encoding utf8
}
& ./qa/finance-p03/phase-a/run-reconciliation-bridge.ps1 -Name complete-a-bridge
$phaseAResults+=@{name='complete-a-bridge';exit_code=$LASTEXITCODE}
$phaseAResults | ConvertTo-Json | Set-Content -LiteralPath docs/migration-evidence/finance-p03/phase-a/complete-sequence.json -Encoding utf8
if($phaseAResults|Where-Object{$_.exit_code -ne 0 -and $_.name -ne 'complete-p02'}){exit 1}
