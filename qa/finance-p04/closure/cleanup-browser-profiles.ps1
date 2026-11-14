param([Parameter(Mandatory=$true)][string]$Workspace)
$ErrorActionPreference='Stop'
$workspacePath=(Resolve-Path -LiteralPath $Workspace).Path.TrimEnd('\')
$evidencePath=Join-Path $workspacePath 'docs\migration-evidence\finance-p04\closure-current'
$reportPath=Join-Path $evidencePath 'windows-browser-cleanup-r1.json'
if (Test-Path -LiteralPath $reportPath) { throw 'Preserve earlier report' }
$inventory=Get-Content -LiteralPath (Join-Path $evidencePath 'cleanup-inventory-final-r1.json') -Raw | ConvertFrom-Json
$tempPath=(Resolve-Path -LiteralPath $env:TEMP).Path.TrimEnd('\')
$names=@('finance-p04-chromium-CWWpBZ','finance-p04-chromium-FvFynn','finance-p04-chromium-I6xPhx','finance-p04-chromium-GNWimJ','finance-p04-chromium-nvmDQ2')
$roots=@($inventory.roots | Where-Object { $_.kind -eq 'owned_temp_browser_profile' })
if ($roots.Count -ne 5) { throw 'Unexpected inventory' }
$processes=@(Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('node.exe','chrome.exe') -and $_.CommandLine -match 'finance-p04-chromium-' })
if ($processes.Count) { throw 'Owned browser still active' }
Add-Type -AssemblyName System.IO.Compression
$zipPath=Join-Path $evidencePath 'private\synthetic-browser-retained.zip'
if (Test-Path -LiteralPath $zipPath) { throw 'Preserve prior backup' }
$backupRows=[Collections.Generic.List[object]]::new()
$stream=[IO.File]::Open($zipPath,[IO.FileMode]::CreateNew)
$zip=[IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($root in $roots) {
        $resolved=(Resolve-Path -LiteralPath $root.path).Path.TrimEnd('\')
        $name=Split-Path -Leaf $resolved
        if ($name -notin $names -or (Split-Path -Parent $resolved) -ne $tempPath) { throw 'Unexpected absolute deletion target' }
        $cursor=Get-Item -LiteralPath $resolved -Force
        while ($null -ne $cursor) {
            if (($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse ancestor' }
            $cursor=$cursor.Parent
        }
        $all=@(Get-ChildItem -LiteralPath $resolved -Recurse -Force)
        if (@($all | Where-Object { ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 }).Count) { throw 'Reparse descendant' }
        $files=@($all | Where-Object { !$_.PSIsContainer })
        if ($files.Count -ne $root.files -or ($files | Measure-Object Length -Sum).Sum -ne $root.bytes) { throw 'Inventory changed' }
        foreach ($kept in @($inventory.retained | Where-Object { $_.type -eq 'file' -and $_.path.StartsWith($resolved+'\',[StringComparison]::OrdinalIgnoreCase) })) {
            $relative=$name+'/'+$kept.path.Substring($resolved.Length+1).Replace('\','/')
            $entry=$zip.CreateEntry($relative,[IO.Compression.CompressionLevel]::Optimal)
            $entryStream=$entry.Open();$input=[IO.File]::OpenRead($kept.path)
            try { $input.CopyTo($entryStream) } finally { $input.Dispose();$entryStream.Dispose() }
            $backupRows.Add([pscustomobject]@{entry=$relative;sha256=(Get-FileHash -LiteralPath $kept.path -Algorithm SHA256).Hash})
        }
    }
} finally { $zip.Dispose();$stream.Dispose() }
$readStream=[IO.File]::OpenRead($zipPath);$check=[IO.Compression.ZipArchive]::new($readStream,[IO.Compression.ZipArchiveMode]::Read)
try {
    foreach ($row in $backupRows) {
        $input=$check.GetEntry($row.entry).Open();$sha=[Security.Cryptography.SHA256]::Create()
        try { $actual=[Convert]::ToHexString($sha.ComputeHash($input));if ($actual -ne $row.sha256) { throw 'Backup verification failed' } }
        finally { $input.Dispose();$sha.Dispose() }
    }
} finally { $check.Dispose();$readStream.Dispose() }
$backupRows | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $evidencePath 'synthetic-browser-retained-manifest.json') -Encoding utf8
$results=[Collections.Generic.List[object]]::new()
foreach ($root in $roots) {
    # This is the fresh owner-authorized whole-root attempt, including the three previously rejected roots.
    # If it fails or approval review rejects it, never retry its children through a different deletion route.
    $absolute=(Resolve-Path -LiteralPath $root.path).Path.TrimEnd('\')
    if ((Split-Path -Parent $absolute) -ne $tempPath -or (Split-Path -Leaf $absolute) -notin $names) { throw 'Target escaped exact allowlist' }
    try { Remove-Item -LiteralPath $absolute -Recurse -Force; if (Test-Path -LiteralPath $absolute) { throw 'Incomplete deletion' };$status='REMOVED';$reason=$null }
    catch { $status='PRESERVED';$reason=$_.Exception.Message }
    $results.Add([pscustomobject]@{path=$absolute;status=$status;reason=$reason;files=$root.files;bytes=$root.bytes})
}
$removed=@($results | Where-Object status -eq 'REMOVED')
$report=[ordered]@{finished_utc=[DateTime]::UtcNow.ToString('o');results=$results;backup_sha256=(Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash;backup_verified_files=$backupRows.Count;removed_files=($removed | Measure-Object files -Sum).Sum;removed_logical_bytes=($removed | Measure-Object bytes -Sum).Sum;only_owned_synthetic_profiles=$true;normal_chrome_profiles_touched=$false;prior_failures_preserved=$true}
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding utf8
@{removed_roots=$removed.Count;removed_files=$report.removed_files;removed_logical_bytes=$report.removed_logical_bytes;backup_verified_files=$backupRows.Count} | ConvertTo-Json
