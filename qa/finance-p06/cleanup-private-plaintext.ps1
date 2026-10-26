param([switch]$Execute)
$ErrorActionPreference='Stop'
$workspace=[System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$evidence=[System.IO.Path]::GetFullPath((Join-Path $workspace 'docs/migration-evidence/finance-p06'))
$sealPath=Join-Path $evidence 'privacy-seal-r1/manifest.json'
$seal=Get-Content -Raw -LiteralPath $sealPath|ConvertFrom-Json
if($seal.status -ne 'PASS'){throw 'Private evidence seal is incomplete'}
$planPath=Join-Path $evidence 'privacy-seal-r1/plaintext-cleanup-plan.json'
$rows=@();[long]$logicalBytes=0
foreach($entry in $seal.files){
    $target=[System.IO.Path]::GetFullPath((Join-Path $workspace $entry.source))
    $cipher=[System.IO.Path]::GetFullPath((Join-Path $workspace $entry.cipher))
    if(-not $target.StartsWith($evidence+[System.IO.Path]::DirectorySeparatorChar,[System.StringComparison]::OrdinalIgnoreCase)){throw 'Plaintext target outside owned evidence'}
    if(-not $cipher.StartsWith((Join-Path $evidence 'privacy-seal-r1/blobs')+[System.IO.Path]::DirectorySeparatorChar,[System.StringComparison]::OrdinalIgnoreCase)){throw 'Cipher outside owned seal'}
    $item=Get-Item -LiteralPath $target
    if($item.PSIsContainer -or ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)){throw 'Expected an ordinary owned file'}
    if($item.Length -ne $entry.source_bytes -or (Get-FileHash -Algorithm SHA256 -LiteralPath $target).Hash.ToLowerInvariant() -ne $entry.source_sha256){throw 'Plaintext changed since encryption'}
    if((Get-FileHash -Algorithm SHA256 -LiteralPath $cipher).Hash.ToLowerInvariant() -ne $entry.cipher_sha256 -or -not $entry.round_trip_verified){throw 'Encrypted backup is not verified'}
    $rows+=[ordered]@{source=$entry.source;target=$target;bytes=$item.Length;sha256=$entry.source_sha256;cipher=$entry.cipher}
    $logicalBytes += [long]$entry.source_bytes
}
if(-not $Execute){
    if(Test-Path -LiteralPath $planPath){throw 'Preserve existing plan'}
    [ordered]@{utc=(Get-Date).ToUniversalTime().ToString('o');scope='Exact current-task plaintext files with verified owner-DPAPI backups';files=$rows}|ConvertTo-Json -Depth 7|Set-Content -LiteralPath $planPath
    [ordered]@{status='PLANNED';files=$rows.Count;logical_bytes=$logicalBytes}|ConvertTo-Json
    exit
}
$plan=Get-Content -Raw -LiteralPath $planPath|ConvertFrom-Json
if(@($plan.files).Count -ne $rows.Count){throw 'Plan count changed'}
$resultPath=Join-Path $evidence 'privacy-seal-r1/plaintext-cleanup-result.json'
if(Test-Path -LiteralPath $resultPath){throw 'Preserve previous result'}
foreach($row in $rows){
    $approved=@($plan.files|Where-Object {$_.target -eq $row.target -and $_.sha256 -eq $row.sha256})
    if($approved.Count -ne 1){throw 'Exact plan mismatch'}
}
$done=@()
foreach($row in $rows){
    Remove-Item -LiteralPath $row.target -Force
    if(Test-Path -LiteralPath $row.target){throw 'Plaintext still present'}
    $done+=$row.source
    [ordered]@{utc=(Get-Date).ToUniversalTime().ToString('o');status='IN_PROGRESS';deleted_sources=$done;encrypted_evidence_retained=$true}|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $resultPath
}
[ordered]@{utc=(Get-Date).ToUniversalTime().ToString('o');status='PASS';deleted_sources=$done;files=$done.Count;logical_bytes=$logicalBytes;encrypted_evidence_retained=$true;formal_data_deleted=$false;recursive_deletion=$false}|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $resultPath
[ordered]@{status='PASS';plaintext_files_removed=$done.Count;owner_encrypted_sources_retained=$rows.Count}|ConvertTo-Json
