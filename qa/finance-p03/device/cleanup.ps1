param([switch]$Perform)
$ErrorActionPreference='Stop'
$cleanupWorkspace=(Get-Location).Path
$cleanupOutput=(Resolve-Path -LiteralPath 'docs/migration-evidence/finance-p03/device').ProviderPath
$cleanupSource=(Resolve-Path -LiteralPath 'qa/finance-p03/device').ProviderPath
if(!(Test-Path -LiteralPath (Join-Path $cleanupOutput 'artifacts-final/finance-p03-device-debug.apk'))){throw 'Canonical final APK must exist first'}
if(!(Test-Path -LiteralPath (Join-Path $cleanupOutput 'server-runtime7/stopped.json'))){throw 'Owned backend must close before private runtime cleanup'}
if(!(Test-Path -LiteralPath (Join-Path $cleanupOutput 'server7-public-finance.json'))){throw 'Retain sanitized synthetic financial state first'}
$cleanupCandidates=@('build','build-sources','prepare-attempt1-build-sources','generated-schemas','private','public-apk-schema/classes.dex') | ForEach-Object {Join-Path $cleanupOutput $_}
Get-ChildItem -LiteralPath $cleanupOutput -Directory | Where-Object {$_.Name -match '^server(?:-attempt\d+)?-runtime\d*$'} | ForEach-Object {$cleanupCandidates+=Join-Path $_.FullName 'persist'}
$cleanupCandidates+=Join-Path $cleanupSource '__pycache__'
$cleanupRows=@()
foreach($cleanupPath in $cleanupCandidates){
 if(!(Test-Path -LiteralPath $cleanupPath)){continue}
 $cleanupResolved=(Resolve-Path -LiteralPath $cleanupPath).ProviderPath
 $cleanupAllowed=$cleanupResolved.StartsWith($cleanupOutput+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or $cleanupResolved.Equals((Join-Path $cleanupSource '__pycache__'),[StringComparison]::OrdinalIgnoreCase)
 if(!$cleanupAllowed){throw ('Cleanup target outside exact allowlist: '+$cleanupResolved)}
 $cleanupItem=Get-Item -LiteralPath $cleanupResolved -Force
 if($cleanupItem.Attributes -band [IO.FileAttributes]::ReparsePoint){throw ('Do not traverse a reparse point: '+$cleanupResolved)}
 $cleanupFiles=if($cleanupItem.PSIsContainer){@(Get-ChildItem -LiteralPath $cleanupResolved -Recurse -File -Force)}else{@($cleanupItem)}
 if($cleanupItem.PSIsContainer -and @(Get-ChildItem -LiteralPath $cleanupResolved -Recurse -Directory -Force | Where-Object {$_.Attributes -band [IO.FileAttributes]::ReparsePoint}).Count){throw 'Unexpected nested link; preserve target'}
 $cleanupBytes=($cleanupFiles|Measure-Object -Property Length -Sum).Sum
 $cleanupRows+=@{resolved=$cleanupResolved;files=$cleanupFiles.Count;bytes=[long]$cleanupBytes;verified_within_owned_root=$true;deleted=$false}
}
$cleanupInventory=Join-Path $cleanupOutput $(if($Perform){'cleanup.json'}else{'cleanup-inventory.json'})
if(Test-Path -LiteralPath $cleanupInventory){throw 'Preserve prior cleanup record'}
if($Perform){foreach($cleanupRow in $cleanupRows){Remove-Item -LiteralPath $cleanupRow.resolved -Recurse -Force;$cleanupRow.deleted=!(Test-Path -LiteralPath $cleanupRow.resolved)}}
@{status=$(if($Perform){'CLEANED_REBUILDABLE_ONLY'}else{'INVENTORIED_ONLY'});utc=[DateTime]::UtcNow.ToString('o');targets=$cleanupRows;bytes=([long](($cleanupRows|Measure-Object -Property bytes -Sum).Sum));preserved=@('all prior evidence','all failed logs and JUnit','public CA','canonical current QA APK pair','public installed APK and compiled schema evidence','source and fixtures','phone app data','shared Gradle cache','fixed checkout','Task26','Hotfix')} | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath $cleanupInventory -Encoding UTF8
Get-Content -LiteralPath $cleanupInventory -Raw
