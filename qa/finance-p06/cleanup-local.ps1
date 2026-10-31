param([switch]$Execute)
$ErrorActionPreference='Stop'
$cleanupWorkspace=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$cleanupEvidence=[IO.Path]::GetFullPath((Join-Path $cleanupWorkspace 'docs/migration-evidence/finance-p06'))
$cleanupExtra=[IO.Path]::GetFullPath((Join-Path $cleanupWorkspace 'docs/migration-evidence/finance-p04/p06-validation'))
$cleanupSourceCache=[IO.Path]::GetFullPath((Join-Path $cleanupWorkspace 'qa/finance-p06/__pycache__'))
$cleanupOutput=Join-Path $cleanupEvidence 'local-cleanup'
if(-not(Test-Path -LiteralPath $cleanupOutput)){New-Item -ItemType Directory -Path $cleanupOutput|Out-Null}
$cleanupPlan=Join-Path $cleanupOutput 'plan.json';$cleanupResult=Join-Path $cleanupOutput 'result.json'
if($Execute -and (Test-Path -LiteralPath (Join-Path $cleanupExtra 'android-validation.lock'))){throw 'Current regression still owns its resources'}
function Assert-OwnedPath([string]$candidate){
    $absolute=[IO.Path]::GetFullPath($candidate)
    if(-not($absolute.StartsWith($cleanupEvidence+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or $absolute.StartsWith($cleanupExtra+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or $absolute -eq $cleanupSourceCache)){throw 'Cleanup target outside explicitly owned locations'}
    $item=Get-Item -LiteralPath $absolute -Force
    if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Reparse target rejected'}
    return $absolute
}
function Directory-Inventory([string]$target){
    $children=@(Get-ChildItem -LiteralPath $target -Recurse -Force)
    if(@($children|Where-Object {($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0}).Count){throw 'Reparse child rejected'}
    return @($children|Where-Object {-not $_.PSIsContainer}|ForEach-Object {[pscustomobject]@{path=$_.FullName.Substring($target.Length+1);bytes=[long]$_.Length}})
}
if(-not $Execute){
    if(Test-Path -LiteralPath $cleanupPlan){throw 'Preserve prior cleanup plan'}
    $rows=@();$seen=@{}
    foreach($base in @($cleanupEvidence,$cleanupExtra)){
        foreach($marker in @(Get-ChildItem -LiteralPath $base -Recurse -Force -File -Filter DevToolsActivePort)){
            $target=Assert-OwnedPath $marker.Directory.FullName
            if($seen.ContainsKey($target)){continue};$seen[$target]=$true
            $active=@(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'"|Where-Object {$_.CommandLine -and $_.CommandLine.Replace('/','\').Contains($target)})
            if($active.Count){throw 'An owned Chrome profile is still active; wait for tests'}
            $inventory=Directory-Inventory $target
            $rows+=[pscustomobject]@{kind='OwnedChromeProfile';target=$target;inventory=$inventory;files=$inventory.Count;logical_bytes=($inventory|Measure-Object bytes -Sum).Sum}
        }
    }
    $stopped=Get-Content -Raw -LiteralPath (Join-Path $cleanupEvidence 'emulator-cleanup-r2.json')|ConvertFrom-Json
    if($stopped.status -ne 'PASS' -or $stopped.private_adb_port -ne 5043){throw 'Owned virtual device is not stopped'}
    $cleanupAvdHome=Assert-OwnedPath $stopped.owned_avd_home
    if($cleanupAvdHome -ne (Join-Path $cleanupEvidence 'avd/home')){throw 'Unexpected AVD home'}
    if(@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object {$_.LocalPort -in @(5043,5588,5589)}).Count){throw 'Owned AVD/server port is still listening'}
    $inventory=Directory-Inventory $cleanupAvdHome
    $rows+=[pscustomobject]@{kind='OwnedStoppedAvdHome';target=$cleanupAvdHome;inventory=$inventory;files=$inventory.Count;logical_bytes=($inventory|Measure-Object bytes -Sum).Sum}
    if(Test-Path -LiteralPath $cleanupSourceCache){
        $cache=Assert-OwnedPath $cleanupSourceCache;$inventory=Directory-Inventory $cache
        if(@($inventory|Where-Object {$_.path -notmatch '^[A-Za-z0-9_-]+[.]cpython-[0-9]+[.]pyc$'}).Count){throw 'Unexpected content in the new QA bytecode cache'}
        $rows+=[pscustomobject]@{kind='OwnedQaPythonCache';target=$cache;inventory=$inventory;files=$inventory.Count;logical_bytes=($inventory|Measure-Object bytes -Sum).Sum}
    }
    $canonical=@{}
    foreach($apk in @(Get-ChildItem -LiteralPath $cleanupEvidence -Recurse -File -Filter app-debug.apk|Where-Object {$_.FullName -notmatch '[\\/]private[\\/]'})){
        $digest=(Get-FileHash -Algorithm SHA256 -LiteralPath $apk.FullName).Hash.ToLowerInvariant();if(-not $canonical.ContainsKey($digest)){$canonical[$digest]=$apk.FullName}
    }
    foreach($apk in @(Get-ChildItem -LiteralPath $cleanupEvidence -Recurse -File|Where-Object {$_.Name -in @('previous-owned.apk','owned-previous-base.apk')})){
        $target=Assert-OwnedPath $apk.FullName;$digest=(Get-FileHash -Algorithm SHA256 -LiteralPath $target).Hash.ToLowerInvariant()
        if($canonical.ContainsKey($digest)){$rows+=[pscustomobject]@{kind='RedundantPreviousQaApk';target=$target;canonical=$canonical[$digest];sha256=$digest;files=1;logical_bytes=[long]$apk.Length}}
    }
    [ordered]@{utc=[datetime]::UtcNow.ToString('o');status='PLANNED';scope='This task owned browser profiles, stopped AVD and byte-identical previous-APK copies only';targets=$rows;formal_data=$false;prior_evidence_roots_selected=$false}|ConvertTo-Json -Depth 10|Set-Content -LiteralPath $cleanupPlan -Encoding utf8
    $rows|Select-Object kind,target,files,logical_bytes|ConvertTo-Json -Depth 4
    exit
}
if(Test-Path -LiteralPath $cleanupResult){throw 'Preserve previous execution'}
$plan=Get-Content -Raw -LiteralPath $cleanupPlan|ConvertFrom-Json;$results=@()
foreach($row in $plan.targets){
    $target=Assert-OwnedPath $row.target
    if($row.kind -eq 'RedundantPreviousQaApk'){
        $canonical=Assert-OwnedPath $row.canonical
        if((Get-FileHash -Algorithm SHA256 -LiteralPath $target).Hash.ToLowerInvariant() -ne $row.sha256 -or (Get-FileHash -Algorithm SHA256 -LiteralPath $canonical).Hash.ToLowerInvariant() -ne $row.sha256){throw 'Duplicate APK identity changed'}
        Remove-Item -LiteralPath $target -Force
    }else{
        if($row.kind -eq 'OwnedChromeProfile'){
            $active=@(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'"|Where-Object {$_.CommandLine -and $_.CommandLine.Replace('/','\').Contains($target)})
            if($active.Count){throw 'Profile became active after plan'}
        }elseif($row.kind -notin @('OwnedStoppedAvdHome','OwnedQaPythonCache')){throw 'Unrecognized recursive target'}
        $inventory=Directory-Inventory $target
        if($inventory.Count -ne @($row.inventory).Count -or (Compare-Object ($inventory|ForEach-Object {"$($_.path)|$($_.bytes)"}) ($row.inventory|ForEach-Object {"$($_.path)|$($_.bytes)"}))){throw 'Owned directory changed after plan'}
        Remove-Item -LiteralPath $target -Recurse -Force
    }
    if(Test-Path -LiteralPath $target){throw 'Owned target remains'}
    $results+=[pscustomobject]@{kind=$row.kind;target=$target;status='PASS';files=$row.files;logical_bytes=$row.logical_bytes}
    [ordered]@{status='IN_PROGRESS';targets=$results}|ConvertTo-Json -Depth 6|Set-Content -LiteralPath $cleanupResult
}
[ordered]@{utc=[datetime]::UtcNow.ToString('o');status='PASS';targets=$results;formal_or_other_workspaces_modified=$false;source_evidence_backups_retained=$true;default_adb_server_5037_touched=$false;physical_bytes_reclaimed='NOT_MEASURED'}|ConvertTo-Json -Depth 6|Set-Content -LiteralPath $cleanupResult
$results|Select-Object kind,status,files,logical_bytes|ConvertTo-Json -Depth 4
