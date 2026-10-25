$ErrorActionPreference = 'Stop'
$financeRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../../../docs/migration-evidence/finance-p04/non-device-closeout')).Path
$financeOutput = Join-Path $financeRoot 'chrome-cleanup.json'
if (Test-Path -LiteralPath $financeOutput) { throw 'Preserve cleanup evidence' }
$financeResults = @()
foreach ($financeRelative in @('e2e-r1/owned-chrome-profile', 'e2e-r2/owned-chrome-profile')) {
    $financeTarget = [IO.Path]::GetFullPath((Join-Path $financeRoot $financeRelative))
    if (!$financeTarget.StartsWith($financeRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Target escaped new evidence root' }
    $financeItem = Get-Item -LiteralPath $financeTarget -Force
    if (($financeItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse target rejected' }
    $financeProcesses = @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($financeTarget) })
    if ($financeProcesses.Count -ne 0) { throw 'Owned profile still has an active Chrome process; preserve it' }
    $financeItems = @(Get-ChildItem -LiteralPath $financeTarget -Recurse -Force)
    if (@($financeItems | Where-Object { ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 }).Count -ne 0) { throw 'Reparse child rejected' }
    $financeFiles = @($financeItems | Where-Object { !$_.PSIsContainer })
    $financeBytes = ($financeFiles | Measure-Object -Property Length -Sum).Sum
    $financeManifest = @($financeFiles | ForEach-Object { @{ path = $_.FullName.Substring($financeTarget.Length + 1); bytes = $_.Length } })
    # One shell performs the checked recursive removal. No user/default Chrome
    # profile, Downloads, games, another task, or prior evidence root is selected.
    Remove-Item -LiteralPath $financeTarget -Recurse -Force
    $financeResults += @{ target = $financeTarget; status = $(if (Test-Path -LiteralPath $financeTarget) { 'FAIL' } else { 'PASS' }); files = $financeFiles.Count; logical_bytes = $financeBytes; inventory = $financeManifest }
}
@{ checked_utc = [DateTime]::UtcNow.ToString('o'); targets = $financeResults; user_profiles_modified = $false; screenshots_dom_and_logs_retained = $true } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $financeOutput -Encoding utf8
$financeResults | Select-Object target,status,files,logical_bytes | ConvertTo-Json
