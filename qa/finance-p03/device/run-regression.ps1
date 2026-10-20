# All Gradle invocations stay serial. Preserve real frozen nonzero exits.
$ErrorActionPreference='Stop'
$freshRunner='./docs/migration-evidence/finance-p03/device/regression-runners'
$freshResults=@();$freshLog='docs/migration-evidence/finance-p03/device/regression-commands.json'
if(Test-Path -LiteralPath $freshLog){throw 'Never overwrite a run'}
function Run-Fresh([string]$Name,[scriptblock]$Action,[bool]$ExpectedRed=$false){
 $freshStarted=[DateTime]::UtcNow.ToString('o');& $Action;$freshExit=$LASTEXITCODE
 $script:freshResults+=@{name=$Name;exit_code=$freshExit;expected_red=$ExpectedRed;started_utc=$freshStarted;finished_utc=[DateTime]::UtcNow.ToString('o')}
 $script:freshResults|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $freshLog -Encoding UTF8
}
Run-Fresh 'frozen-native' {& "$freshRunner/run-gradle.ps1" -Flavor P02 -Name device-frozen -OutputName frozen-native -Tests @('*FinanceP02MatrixTest','*FinanceP02TimingTest')} $true
Run-Fresh 'frozen-process-seed' {& "$freshRunner/run-gradle.ps1" -Flavor P02 -Name device-process-seed -OutputName frozen-process -Tests @('*FinanceP02SeedTest')}
Run-Fresh 'frozen-process-restore' {& "$freshRunner/run-gradle.ps1" -Flavor P02 -Name device-process-restore -OutputName frozen-process -Tests @('*FinanceP02RestoreTest')}
Run-Fresh 'legacy-bridge' {& "$freshRunner/run-bridge.ps1" -Profile legacy -Name legacy-bridge-device}
Run-Fresh 'clearing-bridge' {& "$freshRunner/run-bridge.ps1" -Profile closeout -Name clearing-bridge-device}
Run-Fresh 'correction-bridge' {& "$freshRunner/run-reconciliation-bridge.ps1" -Name correction-bridge-device}
Run-Fresh 'unified-bridge' {& "$freshRunner/run-unified-bridge.ps1" -Name unified-bridge-device}
Run-Fresh 'native-persist' {& "$freshRunner/run-native-persist.ps1" -Name native-persist}
if($freshResults|Where-Object{$_.exit_code -ne 0 -and !$_.expected_red}){exit 1}
