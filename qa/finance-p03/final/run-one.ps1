param([ValidatePattern('^[a-z0-9-]+$')][string]$Name,[string]$Script)
$ErrorActionPreference='Stop'
$phaseABase=Join-Path (Get-Location) 'docs/migration-evidence/finance-p03/final'
$phaseAOut=Join-Path $phaseABase $Name
$phaseALog=Join-Path $phaseABase ($Name+'.log')
if((Test-Path -LiteralPath $phaseAOut) -or (Test-Path -LiteralPath $phaseALog)){throw 'Preserve prior execution'}
$env:FINANCE_P03_OUTPUT=$phaseAOut
$phaseAStarted=[DateTime]::UtcNow
$ErrorActionPreference='Continue'
& node $Script *> $phaseALog
$phaseACode=$LASTEXITCODE
$ErrorActionPreference='Stop'
@{command='node';arguments=@($Script);exit_code=$phaseACode;output=$phaseAOut;started_utc=$phaseAStarted.ToString('o');finished_utc=[DateTime]::UtcNow.ToString('o');log=$phaseALog}|ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $phaseABase ($Name+'-run.json')) -Encoding utf8
Get-Content -LiteralPath $phaseALog -Tail 12
exit $phaseACode
