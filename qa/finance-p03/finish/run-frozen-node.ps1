$ErrorActionPreference='Stop'
$frozenBase=Join-Path (Get-Location) 'docs/migration-evidence/finance-p03/finish'
$frozenOut=Join-Path $frozenBase 'frozen-web'
if(Test-Path -LiteralPath $frozenOut){throw 'Preserve every attempt'}
New-Item -ItemType Directory -Path $frozenOut | Out-Null
$env:FINANCE_P03_OUTPUT=$frozenOut
if(Test-Path Env:P03_FROZEN_OUTPUT_PREFIX){Remove-Item Env:P03_FROZEN_OUTPUT_PREFIX}
$frozenResults=@()
foreach($frozenScript in @('web-contracts','web-dom','ledger-d1')){
 $frozenStarted=[DateTime]::UtcNow.ToString('o')
 $frozenArgs=@('--import','./qa/finance-p03/finish/output-redirect.mjs',('qa/finance-p02/'+$frozenScript+'.mjs'))
 $ErrorActionPreference='Continue'
 & node @frozenArgs *> (Join-Path $frozenBase ($frozenScript+'-fresh.log'))
 $frozenCode=$LASTEXITCODE
 $ErrorActionPreference='Stop'
 $frozenResults+=@{command='node';arguments=$frozenArgs;exit_code=$frozenCode;started_utc=$frozenStarted;finished_utc=[DateTime]::UtcNow.ToString('o')}
 $frozenResults|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $frozenBase 'frozen-node-commands.json') -Encoding UTF8
 Write-Output ($frozenScript+' '+$frozenCode)
}
if($frozenResults[-1].exit_code -ne 0){exit 1}
