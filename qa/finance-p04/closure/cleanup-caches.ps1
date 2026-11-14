param([Parameter(Mandatory=$true)][string]$Workspace)
$ErrorActionPreference = 'Stop'
$workspacePath = (Resolve-Path -LiteralPath $Workspace).Path.TrimEnd('\')
$evidencePath = Join-Path $workspacePath 'docs\migration-evidence\finance-p04\closure-current'
$manifestPath = Join-Path $evidencePath 'cleanup-inventory-final-r1.json'
$reportPath = Join-Path $evidencePath 'windows-cache-cleanup-r1.json'
if (Test-Path -LiteralPath $reportPath) { throw 'Preserve prior cleanup report' }
$inventory = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($inventory.root -ne $workspacePath -or $inventory.errors.Count -ne 0) { throw 'Wrong or incomplete inventory' }
function Assert-NoReparse([string]$targetPath) {
    $cursor = Get-Item -LiteralPath $targetPath -Force
    while ($null -ne $cursor) {
        if (($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse path rejected' }
        if ($cursor -is [IO.DirectoryInfo]) { $cursor=$cursor.Parent } else { $cursor=$cursor.Directory }
    }
}
$ownedProcesses = @(Get-CimInstance Win32_Process | Where-Object {
    $_.Name -in @('node.exe','java.exe','chrome.exe') -and $_.CommandLine -and (
        $_.CommandLine.Contains($evidencePath) -or $_.CommandLine.Contains('finance-p04-chromium-') -or $_.CommandLine.Contains('finance-p04-cf-meta-'))
})
if ($ownedProcesses.Count -ne 0) { throw 'An owned test process remains active' }
$retained = @($inventory.retained | Where-Object { $_.type -eq 'file' -and (Test-Path -LiteralPath $_.path -PathType Leaf) })
$retainedDigests = @{}
foreach ($item in $retained) { $retainedDigests[$item.path]=(Get-FileHash -LiteralPath $item.path -Algorithm SHA256).Hash }
$results = [Collections.Generic.List[object]]::new()
foreach ($entry in $inventory.candidates) {
    # Previously blocked Temp profiles receive one separately logged whole-root attempt.
    if ($entry.kind -eq 'owned_temp_browser_profile') { continue }
    $record=[ordered]@{path=$entry.path;status='NOT_TESTED';files=$entry.files;bytes=$entry.bytes}
    try {
        if (!$entry.eligible_at_snapshot -or $entry.active_own_process -or $entry.ownership_review_required) { throw 'Not eligible' }
        $target=(Resolve-Path -LiteralPath $entry.path).Path.TrimEnd('\')
        $parent=(Resolve-Path -LiteralPath $entry.inventory_root).Path.TrimEnd('\')
        if ($target -ne $parent -and !$target.StartsWith($parent+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Outside inventoried root' }
        $insideEvidence=$target.StartsWith($evidencePath+'\',[StringComparison]::OrdinalIgnoreCase)
        $ownedMeta=$entry.kind -eq 'owned_cf_metadata_temp' -and $target -match '^C:\\Users\\78252\\AppData\\Local\\Temp\\finance-p04-cf-meta-(coypt3yx|lngb9k_8|ehrvv3rg)$'
        if (!$insideEvidence -and !$ownedMeta) { throw 'Outside explicit workspace or exact owned Temp root' }
        Assert-NoReparse $target
        $all=@(Get-Item -LiteralPath $target -Force)
        if ($all[0].PSIsContainer) { $all += @(Get-ChildItem -LiteralPath $target -Recurse -Force) }
        if (@($all | Where-Object { ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 }).Count -ne 0) { throw 'Descendant reparse rejected' }
        $files=@($all | Where-Object { !$_.PSIsContainer })
        $size=($files | Measure-Object -Property Length -Sum).Sum
        if ($null -eq $size) { $size=0 }
        if ($files.Count -ne $entry.files -or $size -ne $entry.bytes) { throw 'Inventory changed; preserve' }
        # Native PowerShell end-to-end; final absolute target checked immediately above.
        Remove-Item -LiteralPath $target -Recurse -Force
        if (Test-Path -LiteralPath $target) { throw 'Deletion incomplete' }
        $record.status='REMOVED'
    } catch { $record.status='PRESERVED';$record.reason=$_.Exception.Message }
    $results.Add([pscustomobject]$record)
}
foreach ($name in $retainedDigests.Keys) {
    if (!(Test-Path -LiteralPath $name -PathType Leaf) -or (Get-FileHash -LiteralPath $name -Algorithm SHA256).Hash -ne $retainedDigests[$name]) { throw 'Retained evidence changed' }
}
$removed=@($results | Where-Object status -eq 'REMOVED')
$report=[ordered]@{finished_utc=[DateTime]::UtcNow.ToString('o');status='COMPLETED';inventory_sha256=(Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash;entries=$results;removed_entries=$removed.Count;removed_files=($removed | Measure-Object -Property files -Sum).Sum;removed_logical_bytes=($removed | Measure-Object -Property bytes -Sum).Sum;preserved_entries=@($results | Where-Object status -eq 'PRESERVED').Count;retained_files_sha256_checked=$retainedDigests.Count;temp_browser_profiles='Excluded entirely; separate fresh whole-root attempts only';physical_disk_space_claimed=$false}
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding utf8
@{removed_entries=$report.removed_entries;removed_files=$report.removed_files;removed_logical_bytes=$report.removed_logical_bytes;preserved_entries=$report.preserved_entries;retained_files_sha256_checked=$report.retained_files_sha256_checked} | ConvertTo-Json
