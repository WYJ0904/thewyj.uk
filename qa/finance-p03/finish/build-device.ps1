param([ValidatePattern('^[a-z0-9-]+$')][string]$Name)
$ErrorActionPreference='Stop'
$finishRoot=(Get-Location).Path
$finishOut=Join-Path $finishRoot 'docs/migration-evidence/finance-p03/finish'
$finishLog=Join-Path $finishOut ($Name+'.log')
if(Test-Path -LiteralPath $finishLog){throw 'Preserve every attempt'}
$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME=Join-Path $env:LOCALAPPDATA 'Android/Sdk';$env:ANDROID_SDK_ROOT=$env:ANDROID_HOME
Get-ChildItem Env: | Where-Object Name -Match '(?i)(SIGNING|KEYSTORE|STORE_PASSWORD|KEY_PASSWORD|KEY_ALIAS)' | ForEach-Object {Remove-Item -LiteralPath ('Env:'+$_.Name)}
$finishArgs=@('-p','./android','-I',(Join-Path $finishRoot 'qa/finance-p03/finish/phone.init.gradle'),('-Dfinance.device.source='+(Join-Path $finishOut 'qa-generated')),('-Dfinance.device.output='+$finishOut),'-PTHEWYJ_BASE_URL=https://localhost:19443',':app:assembleDebug',':app:assembleDebugAndroidTest',':app:lintDebug','--no-daemon','--console=plain')
$finishStart=[DateTime]::UtcNow
$ErrorActionPreference='Continue'
& ./android/gradlew.bat @finishArgs *> $finishLog
$finishExit=$LASTEXITCODE
$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath (Join-Path $finishOut 'build/app/reports/lint-results-debug.xml')){Copy-Item -LiteralPath (Join-Path $finishOut 'build/app/reports/lint-results-debug.xml') -Destination (Join-Path $finishOut ($Name+'-lint.xml'))}
@{command='./android/gradlew.bat';arguments=$finishArgs;exit_code=$finishExit;started_utc=$finishStart.ToString('o');finished_utc=[DateTime]::UtcNow.ToString('o');qa_base_url='https://localhost:19443';release_signing=$false}|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $finishOut ($Name+'-run.json')) -Encoding UTF8
Get-Content -LiteralPath $finishLog -Tail 18
exit $finishExit
