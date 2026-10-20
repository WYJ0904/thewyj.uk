param(
    [ValidateSet('P02','P03','Standard')][string]$Flavor,
    [ValidatePattern('^[a-z0-9-]+$')][string]$Name,
    [ValidatePattern('^[a-z0-9-]+$')][string]$OutputName,
    [string[]]$Tests,
    [switch]$Full
)
$ErrorActionPreference='Stop'
$p03Root=(Get-Location).Path
$p03Base=Join-Path $p03Root 'docs/migration-evidence/finance-p03/final'
$p03Log=Join-Path $p03Base ($Name+'.log')
$p03Info=Join-Path $p03Base ($Name+'-run.json')
if((Test-Path -LiteralPath $p03Log) -or (Test-Path -LiteralPath $p03Info)){throw 'Preserve every prior run'}
$p03Out=Join-Path $p03Base $OutputName
$p03Qa=if($Flavor -eq 'P03'){Join-Path $p03Base 'compat-p03'}else{Join-Path $p03Root ('qa/finance-'+$Flavor.ToLowerInvariant())}
$p03Property='finance.'+$Flavor.ToLowerInvariant()
$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME=Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$env:ANDROID_SDK_ROOT=$env:ANDROID_HOME
Get-ChildItem Env: | Where-Object Name -Match '(?i)(SIGNING|KEYSTORE|STORE_PASSWORD|KEY_PASSWORD|KEY_ALIAS)' | ForEach-Object { Remove-Item -LiteralPath ('Env:'+$_.Name) }
[string[]]$p03Args=@('-p','./android')
if($Flavor -ne 'Standard'){$p03Args+=@('-I',(Join-Path $p03Qa 'test.init.gradle'),('-D'+$p03Property+'.root='+$p03Qa),('-D'+$p03Property+'.output='+$p03Out))}
$p03Args+=@(':app:testDebugUnitTest')
foreach($p03Test in $Tests){$p03Args+=@('--tests',$p03Test)}
$p03Args+=@('--rerun','--no-daemon','--console=plain')
if($Full){$p03Args+=@(':app:lintDebug','--rerun',':app:assembleDebug','--rerun')}
$p03Started=[DateTime]::UtcNow
$ErrorActionPreference='Continue'
& ./android/gradlew.bat @p03Args *> $p03Log
$p03Code=$LASTEXITCODE
$ErrorActionPreference='Stop'
$p03Fresh=@(Get-ChildItem -LiteralPath android/app/build/test-results/testDebugUnitTest -Filter 'TEST-*.xml' | Where-Object {$_.LastWriteTimeUtc -ge $p03Started})
if($p03Fresh.Count -gt 0){
    $p03Archive=Join-Path $p03Base ($Name+'-junit')
    New-Item -ItemType Directory -Path $p03Archive | Out-Null
    $p03Fresh | ForEach-Object {Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $p03Archive $_.Name)}
}
if($Full -and (Test-Path -LiteralPath android/app/build/reports/lint-results-debug.xml)){
    Copy-Item -LiteralPath android/app/build/reports/lint-results-debug.xml -Destination (Join-Path $p03Base ($Name+'-lint.xml'))
}
@{command='./android/gradlew.bat';arguments=@($p03Args);exit_code=$p03Code;started_utc=$p03Started.ToString('o');finished_utc=[DateTime]::UtcNow.ToString('o');fresh_junit_files=$p03Fresh.Count;output=$p03Out;log=$p03Log} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $p03Info -Encoding UTF8
Get-Content -LiteralPath $p03Log -Tail 18
exit $p03Code
