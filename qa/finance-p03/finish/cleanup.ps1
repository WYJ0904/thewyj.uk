$ErrorActionPreference='Stop'
$finishRoot=(Get-Location).Path
$finishOut=[IO.Path]::GetFullPath((Join-Path $finishRoot 'docs/migration-evidence/finance-p03/finish'))
$finishResult=Join-Path $finishOut 'cleanup.json'
if(Test-Path -LiteralPath $finishResult){throw 'Preserve every cleanup record'}
$finishPlan=Get-Content -LiteralPath (Join-Path $finishOut 'pc-cleanup-plan.json') -Raw|ConvertFrom-Json
$finishStopped=Get-Content -LiteralPath (Join-Path $finishOut 'server-runtime7/stopped.json') -Raw|ConvertFrom-Json
if(!$finishStopped.stopped){throw 'Stop the owned backend before cleanup'}
if(Get-NetTCPConnection -LocalPort 19443 -State Listen -ErrorAction SilentlyContinue){throw 'Owned port must be closed'}
$finishFinance=Get-Content -LiteralPath (Join-Path $finishOut 'server7-public-finance.json') -Raw|ConvertFrom-Json
if(!$finishFinance.finance_matches_last_live_state -or $finishFinance.credentials_retained){throw 'Keep filtered synthetic finance before deleting ephemeral auth'}
$finishArchive=Get-Content -LiteralPath (Join-Path $finishOut 'qa-generation-final.json') -Raw|ConvertFrom-Json
foreach($finishProperty in $finishArchive.archive_sha256.PSObject.Properties){
 $finishFile=Join-Path $finishOut ('artifacts/exact-qa-inputs/'+$finishProperty.Name)
 if((Get-FileHash -LiteralPath $finishFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $finishProperty.Value){throw 'Exact input archive must match'}
}
$finishDeleted=@()
foreach($finishTarget in $finishPlan.targets){
 $finishPath=[IO.Path]::GetFullPath($finishTarget.path)
 if(!$finishPath.StartsWith($finishOut+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Refuse path outside owned evidence root'}
 $finishItem=Get-Item -LiteralPath $finishPath
 if($finishItem.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Refuse reparse point'}
 $finishFiles=@(Get-ChildItem -LiteralPath $finishPath -File -Recurse -Force)
 $finishLinks=@(Get-ChildItem -LiteralPath $finishPath -Recurse -Force|Where-Object {$_.Attributes -band [IO.FileAttributes]::ReparsePoint})
 if($finishLinks.Count){throw 'Refuse nested reparse point'}
 $finishBytes=($finishFiles|Measure-Object -Property Length -Sum).Sum
 if($finishFiles.Count -ne $finishTarget.files -or $finishBytes -ne $finishTarget.bytes){throw 'Inventory changed; investigate before deletion'}
 Remove-Item -LiteralPath $finishPath -Recurse -Force
 $finishDeleted+=@{path=$finishPath;files=$finishFiles.Count;bytes=$finishBytes;removed=!(Test-Path -LiteralPath $finishPath)}
}
$finishCache=[IO.Path]::GetFullPath((Join-Path $finishRoot 'qa/finance-p03/finish/__pycache__'))
if(Test-Path -LiteralPath $finishCache){
 if($finishCache -ne (Join-Path ([IO.Path]::GetFullPath((Join-Path $finishRoot 'qa/finance-p03/finish'))) '__pycache__')){throw 'Invalid owned cache path'}
 $finishFiles=@(Get-ChildItem -LiteralPath $finishCache -File -Force)
 if(@(Get-ChildItem -LiteralPath $finishCache -Directory -Force).Count){throw 'Unexpected nested Python cache'}
 Remove-Item -LiteralPath $finishCache -Recurse -Force
 $finishDeleted+=@{path=$finishCache;files=$finishFiles.Count;bytes=($finishFiles|Measure-Object Length -Sum).Sum;removed=!(Test-Path -LiteralPath $finishCache)}
}
@{status='CLEANED_REBUILDABLE_ONLY';targets=$finishDeleted;bytes=($finishDeleted|Measure-Object -Property bytes -Sum).Sum;raw_failure_evidence_deleted=$false;canonical_apks_retained=$true;source_archives_retained=$true;private_auth_and_tls_key_removed=$true;backend_stopped=$true}|ConvertTo-Json -Depth 7|Set-Content -LiteralPath $finishResult -Encoding UTF8
Get-Content -LiteralPath $finishResult -Raw
