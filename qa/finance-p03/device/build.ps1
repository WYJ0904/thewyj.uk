param([ValidatePattern('^[a-z0-9-]+$')][string]$Name,[switch]$Full)
$ErrorActionPreference='Stop'
$deviceRoot=(Get-Location).Path
$deviceOut=Join-Path $deviceRoot 'docs/migration-evidence/finance-p03/device'
$deviceSource=Join-Path $deviceRoot 'qa/finance-p03/device'
$deviceLog=Join-Path $deviceOut ($Name+'.log')
if(Test-Path -LiteralPath $deviceLog){throw 'Preserve every build attempt'}
$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME=Join-Path $env:LOCALAPPDATA 'Android/Sdk'
$env:ANDROID_SDK_ROOT=$env:ANDROID_HOME
Get-ChildItem Env: | Where-Object Name -Match '(?i)(SIGNING|KEYSTORE|STORE_PASSWORD|KEY_PASSWORD|KEY_ALIAS)' | ForEach-Object {Remove-Item -LiteralPath ('Env:'+$_.Name)}
$deviceArgs=@('-p','./android','-I',(Join-Path $deviceSource 'qa.init.gradle'),('-Dfinance.device.source='+$deviceSource),('-Dfinance.device.output='+$deviceOut),'-PTHEWYJ_BASE_URL=https://localhost:19443',':app:assembleDebug',':app:assembleDebugAndroidTest','--no-daemon','--console=plain')
if($Full){$deviceArgs+=@(':app:lintDebug')}
$deviceStart=[DateTime]::UtcNow
$ErrorActionPreference='Continue'
& ./android/gradlew.bat @deviceArgs *> $deviceLog
$deviceCode=$LASTEXITCODE
$ErrorActionPreference='Stop'
@{command='./android/gradlew.bat';arguments=$deviceArgs;exit_code=$deviceCode;started_utc=$deviceStart.ToString('o');finished_utc=[DateTime]::UtcNow.ToString('o');qa_base_url='https://localhost:19443';release_signing=$false} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $deviceOut ($Name+'-run.json')) -Encoding UTF8
Get-Content -LiteralPath $deviceLog -Tail 25
exit $deviceCode
