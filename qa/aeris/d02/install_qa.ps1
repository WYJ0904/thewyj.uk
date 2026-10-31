$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$evidence=Join-Path $root 'docs/migration-evidence/d02'
$sdk=Join-Path $env:LOCALAPPDATA 'Android/Sdk/build-tools/36.0.0'
$adbPath=Join-Path $env:LOCALAPPDATA 'Android/Sdk/platform-tools/adb.exe'
$env:JAVA_HOME='C:/Program Files/Android/Android Studio/jbr'
$deviceLines=@(& $adbPath devices -l | Select-String '^\S+\s+device\s+')
if($deviceLines.Count -ne 1 -or [string]$deviceLines[0] -notmatch '^R5CY22MEHJN\s+device\s+'){throw 'Unique Samsung required'}
$before=Get-Content -Raw -LiteralPath (Join-Path $evidence 'device-before.json') | ConvertFrom-Json
$ledgerPath=Join-Path $evidence 'owned-installed.json'
[string[]]$owned=@()
if(Test-Path -LiteralPath $ledgerPath){$owned=@(Get-Content -Raw -LiteralPath $ledgerPath | ConvertFrom-Json)}
foreach($kind in @('target','test')) {
    $package='uk.thewyj.app.qa.d02'+$(if($kind -eq 'test'){'.test'}else{''})
    if($before.packages.$package.metadata.Count -ne 0){throw 'D-02 identity was not absent at baseline'}
    $relative=if($kind -eq 'target'){'debug/app-debug.apk'}else{'androidTest/debug/app-debug-androidTest.apk'}
    $apk=(Resolve-Path -LiteralPath (Join-Path $evidence ('build-qa/app/outputs/apk/'+$relative))).Path
    $badging=@(& (Join-Path $sdk 'aapt2.exe') dump badging $apk)
    if($LASTEXITCODE -ne 0 -or $badging[0] -notmatch [regex]::Escape("name='$package'")){throw 'QA APK identity mismatch'}
    $certificate=@(& (Join-Path $sdk 'apksigner.bat') verify --print-certs $apk | Select-String 'certificate SHA-256 digest:')
    if($LASTEXITCODE -ne 0 -or [string]$certificate -notmatch '9ea45db6e2c398de90ce61affd145e432d63d0d1724dd6447ba4ba24193f4fac'){throw 'Unexpected QA certificate'}
    $existing=@(& $adbPath -s R5CY22MEHJN shell pm path --user 0 $package)
    if($existing.Count -gt 0 -and $package -notin $owned){throw 'Refuse to update an unowned package'}
    & $adbPath -s R5CY22MEHJN install --user 0 -t -r $apk
    if($LASTEXITCODE -ne 0){throw 'QA install failed; retain all data'}
    if($package -notin $owned){$owned+=$package}
    ConvertTo-Json -InputObject @($owned) | Set-Content -LiteralPath $ledgerPath -Encoding utf8
    [pscustomobject]@{package=$package;sha256=(Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLowerInvariant()}
}
