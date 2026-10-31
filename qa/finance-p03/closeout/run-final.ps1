$ErrorActionPreference='Stop'
$p03Base=Join-Path (Get-Location) 'docs/migration-evidence/finance-p03/closeout'
$p03Log=Join-Path $p03Base 'completion-full.log'
if(Test-Path -LiteralPath $p03Log){throw 'Preserve previous final campaign'}
$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME=Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$env:ANDROID_SDK_ROOT=$env:ANDROID_HOME
Get-ChildItem Env: | Where-Object Name -Match '(?i)(SIGNING|KEYSTORE|STORE_PASSWORD|KEY_PASSWORD|KEY_ALIAS)' | ForEach-Object { Remove-Item -LiteralPath ('Env:'+$_.Name) }
[string[]]$p03Args=@('-p','./android',':app:testDebugUnitTest',':app:lintDebug',':app:assembleDebug','--rerun','--no-daemon','--console=plain')
$p03Start=[DateTime]::UtcNow
$ErrorActionPreference='Continue'
& ./android/gradlew.bat @p03Args *> $p03Log
$p03Code=$LASTEXITCODE
$ErrorActionPreference='Stop'
$p03Xml=@(Get-ChildItem -LiteralPath android/app/build/test-results/testDebugUnitTest -Filter 'TEST-*.xml' | Where-Object {$_.LastWriteTimeUtc -ge $p03Start})
$p03Archive=Join-Path $p03Base 'completion-full-junit'
New-Item -ItemType Directory -Path $p03Archive | Out-Null
$p03Xml | ForEach-Object {Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $p03Archive $_.Name)}
Copy-Item -LiteralPath android/app/build/reports/lint-results-debug.xml -Destination (Join-Path $p03Base 'completion-full-lint.xml')
@{command='./android/gradlew.bat';arguments=@($p03Args);started_utc=$p03Start.ToString('o');finished_utc=[DateTime]::UtcNow.ToString('o');exit_code=$p03Code;fresh_junit_files=$p03Xml.Count} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $p03Base 'completion-full-run.json') -Encoding UTF8
Get-Content -LiteralPath $p03Log -Tail 10
if($p03Code -ne 0){exit $p03Code}
$p03Checks=@(@{phase='full-android';exit_code=$p03Code})
& ./qa/finance-p03/closeout/run-gradle.ps1 -Flavor P02 -Name p02-completion-matrix -OutputName p02-completion-native -Tests @('*FinanceP02MatrixTest','*FinanceP02TimingTest')
$p03Checks+=@{phase='frozen-matrix';exit_code=$LASTEXITCODE}
& ./qa/finance-p03/closeout/run-gradle.ps1 -Flavor P02 -Name p02-completion-seed -OutputName p02-completion-process -Tests @('*FinanceP02SeedTest')
$p03Seed=$LASTEXITCODE
$p03Checks+=@{phase='frozen-process-seed';exit_code=$p03Seed}
if($p03Seed -eq 0){
    & ./qa/finance-p03/closeout/run-gradle.ps1 -Flavor P02 -Name p02-completion-restore -OutputName p02-completion-process -Tests @('*FinanceP02RestoreTest')
    $p03Checks+=@{phase='frozen-process-restore';exit_code=$LASTEXITCODE}
}
& ./qa/finance-p03/closeout/run-bridge.ps1 -Profile legacy -Name legacy-completion
$p03Checks+=@{phase='original-p03-bridge';exit_code=$LASTEXITCODE}
& ./qa/finance-p03/closeout/run-bridge.ps1 -Profile closeout -Name clearing-completion
$p03Checks+=@{phase='expanded-clearing-bridge';exit_code=$LASTEXITCODE}
$p03Checks | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $p03Base 'completion-sequence.json') -Encoding UTF8
if($p03Checks | Where-Object {$_.phase -ne 'frozen-matrix' -and $_.exit_code -ne 0}){exit 1}
