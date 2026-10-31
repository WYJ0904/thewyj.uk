# One serial Gradle stream. Frozen failures never prevent independent checks.
$ErrorActionPreference='Stop'
$acceptBase=Join-Path (Get-Location).Path 'docs/migration-evidence/finance-p03/final'
$acceptResults=@()
function Record-Step([string]$Name,[scriptblock]$Action,[bool]$ExpectedRed=$false){
    $started=[DateTime]::UtcNow.ToString('o')
    & $Action
    $stepCode=$LASTEXITCODE
    $script:acceptResults+=@{name=$Name;exit_code=$stepCode;expected_red=$ExpectedRed;started_utc=$started;finished_utc=[DateTime]::UtcNow.ToString('o')}
    $script:acceptResults | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $acceptBase 'acceptance-commands.json') -Encoding UTF8
}
if(Test-Path -LiteralPath (Join-Path $acceptBase 'acceptance-commands.json')){throw 'Never overwrite acceptance'}
Record-Step 'frozen608-native' { & ./qa/finance-p03/final/run-gradle.ps1 -Flavor P02 -Name frozen-matrix -OutputName frozen-native -Tests @('*FinanceP02MatrixTest','*FinanceP02TimingTest') } $true
Record-Step 'frozen-process-seed' { & ./qa/finance-p03/final/run-gradle.ps1 -Flavor P02 -Name frozen-process-seed -OutputName frozen-process -Tests @('*FinanceP02SeedTest') }
Record-Step 'frozen-process-restore' { & ./qa/finance-p03/final/run-gradle.ps1 -Flavor P02 -Name frozen-process-restore -OutputName frozen-process -Tests @('*FinanceP02RestoreTest') }
Record-Step 'legacy-bridge' { & ./qa/finance-p03/final/run-bridge.ps1 -Profile legacy -Name legacy-bridge-final }
Record-Step 'clearing-bridge' { & ./qa/finance-p03/final/run-bridge.ps1 -Profile closeout -Name clearing-bridge-final }
Record-Step 'correction-bridge' { & ./qa/finance-p03/final/run-reconciliation-bridge.ps1 -Name correction-bridge-final }
Record-Step 'unified-bridge' { & ./qa/finance-p03/final/run-unified-bridge.ps1 -Name unified-bridge-final }
if($acceptResults | Where-Object {$_.exit_code -ne 0 -and !$_.expected_red}){exit 1}
