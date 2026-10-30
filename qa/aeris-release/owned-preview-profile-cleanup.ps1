$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$allowedRoot = [IO.Path]::GetFullPath((Join-Path $taskRoot '.wrangler'))
$names = @('aeris-private-ui-zoom-2026-10-29T08-14-00-591Z', 'aeris-private-ui-zoom-2026-10-29T08-24-51-192Z', 'v62-owned-preview-browser-r1', 'v62-owned-preview-browser-r2')
$out = Join-Path $taskRoot 'docs/migration-evidence/aeris-p03-p07/v62-owned-profile-cleanup-r1'
if (Test-Path -LiteralPath $out) { throw 'Fresh evidence path required' }
New-Item -ItemType Directory -Path $out | Out-Null
$plan = @()
foreach ($name in $names) {
    $target = [IO.Path]::GetFullPath((Join-Path $allowedRoot $name))
    if ([IO.Path]::GetDirectoryName($target) -cne $allowedRoot) { throw 'Target outside owned runtime root' }
    $item = Get-Item -LiteralPath $target -Force
    $children = @(Get-ChildItem -LiteralPath $target -Force -Recurse)
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or @($children | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count) { throw 'Reparse target refused' }
    $processes = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($target) })
    if ($processes.Count) { throw 'Owned browser still running; no process or files removed' }
    $files = @($children | Where-Object { -not $_.PSIsContainer })
    $plan += [ordered]@{target=$target; files=$files.Count; logical_bytes=($files | Measure-Object -Property Length -Sum).Sum; closed_process_check=$true}
}
$plan | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $out 'plan.json') -Encoding utf8
$executed = @()
foreach ($entry in $plan) {
    Remove-Item -LiteralPath $entry.target -Recurse -Force
    if (Test-Path -LiteralPath $entry.target) { throw 'Removal incomplete; retain failure' }
    $executed += $entry
    [ordered]@{status='IN_PROGRESS'; removed=$executed} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $out 'progress.json') -Encoding utf8
}
[ordered]@{status='PASS'; removed=$executed; source_files_removed=0; evidence_files_removed=0; production_operations=0; unrelated_profiles_touched=0; prior_denied_paths_touched=0} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $out 'result.json') -Encoding utf8
Write-Output ('PASS: removed '+$executed.Count+' explicitly owned closed browser runtimes')
