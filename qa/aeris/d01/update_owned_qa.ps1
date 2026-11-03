param([ValidateSet('current','control')][string]$Build,
      [ValidateSet('fixed','reversal')][string]$Variant='fixed')
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$evidence=Join-Path $root 'docs/migration-evidence/d01'
$sdk=Join-Path $env:LOCALAPPDATA 'Android/Sdk/build-tools/36.0.0'
$adbPath=Join-Path $env:LOCALAPPDATA 'Android/Sdk/platform-tools/adb.exe'
$env:JAVA_HOME='C:/Program Files/Android/Android Studio/jbr'
$owned=@(Get-Content -Raw -LiteralPath (Join-Path $evidence 'owned-installed.json') | ConvertFrom-Json)
$updates=@()
if($Variant -eq 'reversal' -and $Build -ne 'current'){throw 'Reversal is scoped to the owned current QA package'}
foreach($kind in @('target','test')) {
    $suffix=if($Build -eq 'control'){'d01control'}else{'d01'}
    $package='uk.thewyj.app.qa.'+$suffix+$(if($kind -eq 'test'){'.test'}else{''})
    if($package -notin $owned.package){throw 'Package was not created by this investigation'}
    $relative=if($kind -eq 'target'){'app/outputs/apk/debug/app-debug.apk'}else{'app/outputs/apk/androidTest/debug/app-debug-androidTest.apk'}
    $directory=if($Variant -eq 'reversal'){'build-current-reversal'}else{'build-'+$Build}
    $archive=Join-Path $evidence ('apks/'+$Variant+'-final/current-'+$kind+'.apk')
    $inputPath=if($Build -eq 'current' -and (Test-Path -LiteralPath $archive)){$archive}else{Join-Path $evidence ($directory+'/'+$relative)}
    $apk=(Resolve-Path -LiteralPath $inputPath).Path
    $badging=@(& (Join-Path $sdk 'aapt2.exe') dump badging $apk)
    if($LASTEXITCODE -ne 0 -or $badging[0] -notmatch [regex]::Escape("name='$package'")){throw 'QA APK identity mismatch'}
    $certificate=@(& (Join-Path $sdk 'apksigner.bat') verify --print-certs $apk | Select-String 'certificate SHA-256 digest:')
    if($LASTEXITCODE -ne 0 -or [string]$certificate -notmatch '9ea45db6e2c398de90ce61affd145e432d63d0d1724dd6447ba4ba24193f4fac'){throw 'QA certificate mismatch'}
    $row=[ordered]@{utc=[DateTime]::UtcNow.ToString('o');build=$Build;variant=$Variant;kind=$kind;package=$package;sha256=(Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLowerInvariant();path=$apk}
    & $adbPath -s R5CY22MEHJN install --user 0 -t -r $apk 2>&1 | Tee-Object -FilePath (Join-Path $evidence ('update-'+$Build+'-'+$kind+'-'+[DateTime]::UtcNow.ToString('HHmmss')+'.log'))
    if($LASTEXITCODE -ne 0){throw 'Owned QA update failed; retain data'}
    $updates+=$row
}
$updates | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $evidence ('apk-updated-'+$Build+'-'+$Variant+'-'+[DateTime]::UtcNow.ToString('HHmmss')+'.json')) -Encoding utf8
