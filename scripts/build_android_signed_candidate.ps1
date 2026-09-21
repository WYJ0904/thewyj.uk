param(
    [string]$VersionName = "1.3.11",
    [int]$VersionCode = 24,
    [string]$BaseUrl = "https://codex-task24-candidate-histo.thewyj-uk.pages.dev",
    [string]$KeystorePath = "$env:USERPROFILE\.thewyj\thewyj-android-release.jks",
    [string]$CredentialPath = "$env:USERPROFILE\.thewyj\android-release-credentials.txt",
    [string]$KeyAlias = "thewyj-release",
    [switch]$PromptKeyPassword
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ExpectedCertificateSha256 = "2b322029a9b84de6f2d1ef603778b5079997a3f8df21d01ca8cb30c76b4f7d03"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$GradleFile = Join-Path $RepoRoot "android\app\build.gradle.kts"
$GradleWrapper = Join-Path $RepoRoot "android\gradlew.bat"

function Resolve-KeyTool {
    $studio = "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe"
    if (Test-Path $studio) { return $studio }
    $command = Get-Command keytool -ErrorAction SilentlyContinue
    if ($null -ne $command) { return $command.Source }
    throw "keytool not found. Install Android Studio/JDK first."
}

function Resolve-AndroidSdk {
    $candidates = @(
        $env:ANDROID_SDK_ROOT,
        $env:ANDROID_HOME,
        (Join-Path $env:LOCALAPPDATA "Android\Sdk"),
        (Join-Path $env:USERPROFILE "AppData\Local\Android\Sdk")
    ) | Where-Object { $_ } | Select-Object -Unique

    foreach ($candidate in $candidates) {
        if (-not (Test-Path $candidate)) { continue }
        $platforms = Join-Path $candidate "platforms"
        $buildTools = Join-Path $candidate "build-tools"
        if ((Test-Path $platforms) -and (Test-Path $buildTools)) {
            return (Resolve-Path $candidate).Path
        }
    }
    throw "Android SDK not found. Open Android Studio once and install Android SDK Platform 36 / Build Tools 36, or set ANDROID_SDK_ROOT."
}

function Resolve-ApkSigner {
    $roots = @($env:ANDROID_SDK_ROOT, $env:ANDROID_HOME) | Where-Object { $_ -and (Test-Path $_) }
    foreach ($root in $roots) {
        $candidate = Get-ChildItem -Path (Join-Path $root "build-tools") -Filter "apksigner.bat" -Recurse -File -ErrorAction SilentlyContinue |
            Sort-Object FullName -Descending |
            Select-Object -First 1
        if ($null -ne $candidate) { return $candidate.FullName }
    }
    $command = Get-Command apksigner -ErrorAction SilentlyContinue
    if ($null -ne $command) { return $command.Source }
    throw "apksigner not found. Set ANDROID_SDK_ROOT/ANDROID_HOME or install Android build-tools."
}

function SecureString-ToPlainText([Security.SecureString]$Value) {
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

if (-not (Test-Path $KeystorePath)) { throw "Release keystore not found: $KeystorePath" }
if (-not (Test-Path $CredentialPath)) { throw "Release credential file not found: $CredentialPath" }
if (-not (Test-Path $GradleFile)) { throw "Gradle file not found: $GradleFile" }
if (-not (Test-Path $GradleWrapper)) { throw "Gradle wrapper not found: $GradleWrapper" }
if ($VersionCode -lt 1) { throw "VersionCode must be positive." }
if ($VersionName -notmatch '^\d+(?:\.\d+){2,3}$') { throw "VersionName format is invalid: $VersionName" }
if ($BaseUrl -notmatch '^https://') { throw "BaseUrl must use HTTPS." }

$StorePassword = (Get-Content -Raw $CredentialPath).Trim()
if ([string]::IsNullOrWhiteSpace($StorePassword)) { throw "Release credential file is empty." }

$KeyTool = Resolve-KeyTool
if ([string]::IsNullOrWhiteSpace($KeyAlias)) { throw "KeyAlias must not be empty." }
# The formal release alias is fixed and documented as "thewyj-release".
# Do not force keytool's UI language here: some Windows JDK builds reject
# PowerShell-forwarded -J-Duser.* arguments. Validation only needs the exit code.
$null = & $KeyTool -list -v -alias $KeyAlias -keystore $KeystorePath -storepass $StorePassword 2>&1
if ($LASTEXITCODE -ne 0) {
    throw "Unable to read release alias '$KeyAlias' from the formal keystore."
}
$Alias = $KeyAlias

$KeyPassword = $StorePassword
if ($PromptKeyPassword) {
    $secure = Read-Host "Private-key password (input hidden)" -AsSecureString
    $KeyPassword = SecureString-ToPlainText $secure
    if ([string]::IsNullOrWhiteSpace($KeyPassword)) { throw "Private-key password is empty." }
}

$AndroidSdk = Resolve-AndroidSdk
$OriginalGradle = [IO.File]::ReadAllText($GradleFile)
$oldEnv = @{
    ANDROID_HOME = $env:ANDROID_HOME
    ANDROID_SDK_ROOT = $env:ANDROID_SDK_ROOT
    THEWYJ_ANDROID_KEYSTORE_FILE = $env:THEWYJ_ANDROID_KEYSTORE_FILE
    THEWYJ_ANDROID_KEYSTORE_PASSWORD = $env:THEWYJ_ANDROID_KEYSTORE_PASSWORD
    THEWYJ_ANDROID_KEY_ALIAS = $env:THEWYJ_ANDROID_KEY_ALIAS
    THEWYJ_ANDROID_KEY_PASSWORD = $env:THEWYJ_ANDROID_KEY_PASSWORD
}

try {
    $patched = [regex]::Replace($OriginalGradle, 'versionCode\s*=\s*\d+', "versionCode = $VersionCode", 1)
    $quotedVersion = '"' + $VersionName + '"'
    $patched = [regex]::Replace($patched, 'versionName\s*=\s*"[^"]+"', "versionName = $quotedVersion", 1)
    [IO.File]::WriteAllText($GradleFile, $patched, [Text.UTF8Encoding]::new($false))

    $env:ANDROID_HOME = $AndroidSdk
    $env:ANDROID_SDK_ROOT = $AndroidSdk
    $env:THEWYJ_ANDROID_KEYSTORE_FILE = (Resolve-Path $KeystorePath).Path
    $env:THEWYJ_ANDROID_KEYSTORE_PASSWORD = $StorePassword
    $env:THEWYJ_ANDROID_KEY_ALIAS = $Alias
    $env:THEWYJ_ANDROID_KEY_PASSWORD = $KeyPassword
    Write-Host "Android SDK: $AndroidSdk"

    Push-Location (Join-Path $RepoRoot "android")
    try {
        & $GradleWrapper clean assembleRelease --no-daemon --stacktrace "-PTHEWYJ_BASE_URL=$BaseUrl"
        if ($LASTEXITCODE -ne 0) {
            throw "Release build failed. Read the Gradle error above; the candidate was not published or installed."
        }
    } finally {
        Pop-Location
    }

    $Apk = Join-Path $RepoRoot "android\app\build\outputs\apk\release\app-release.apk"
    if (-not (Test-Path $Apk)) { throw "Signed release APK was not produced." }

    $ApkSigner = Resolve-ApkSigner
    $verify = & $ApkSigner verify --verbose --print-certs $Apk 2>&1
    if ($LASTEXITCODE -ne 0) { throw "apksigner rejected the candidate APK." }
    $verifyText = ($verify -join [Environment]::NewLine)
    $match = [regex]::Match($verifyText, '(?im)certificate SHA-256 digest:\s*([0-9a-f:]+)')
    if (-not $match.Success) { throw "Could not read APK signing certificate SHA-256." }
    $actualCert = $match.Groups[1].Value.Replace(":", "").ToLowerInvariant()
    if ($actualCert -ne $ExpectedCertificateSha256) {
        throw "Signing certificate mismatch. Candidate will NOT be published or installed."
    }

    $OutputDir = Join-Path $RepoRoot "artifacts"
    New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
    $OutputApk = Join-Path $OutputDir "thewyj-android-$VersionName-task24-preview.apk"
    Copy-Item -Force $Apk $OutputApk

    $hash = (Get-FileHash -Algorithm SHA256 $OutputApk).Hash.ToLowerInvariant()
    $size = (Get-Item $OutputApk).Length
    $info = [ordered]@{
        applicationId = "uk.thewyj.app"
        versionName = $VersionName
        versionCode = $VersionCode
        baseUrl = $BaseUrl
        certificateSha256 = $actualCert
        apkSha256 = $hash
        apkSizeBytes = $size
        apkPath = $OutputApk
    }
    $info | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $OutputDir "thewyj-android-$VersionName-task24-preview.json")

    Write-Host ""
    Write-Host "SIGNED CANDIDATE READY" -ForegroundColor Green
    Write-Host "APK:  $OutputApk"
    Write-Host "SHA:  $hash"
    Write-Host "Size: $size bytes"
    Write-Host "Cert: $actualCert"
    Write-Host "Base: $BaseUrl"
} finally {
    [IO.File]::WriteAllText($GradleFile, $OriginalGradle, [Text.UTF8Encoding]::new($false))
    $env:ANDROID_HOME = $oldEnv.ANDROID_HOME
    $env:ANDROID_SDK_ROOT = $oldEnv.ANDROID_SDK_ROOT
    $env:THEWYJ_ANDROID_KEYSTORE_FILE = $oldEnv.THEWYJ_ANDROID_KEYSTORE_FILE
    $env:THEWYJ_ANDROID_KEYSTORE_PASSWORD = $oldEnv.THEWYJ_ANDROID_KEYSTORE_PASSWORD
    $env:THEWYJ_ANDROID_KEY_ALIAS = $oldEnv.THEWYJ_ANDROID_KEY_ALIAS
    $env:THEWYJ_ANDROID_KEY_PASSWORD = $oldEnv.THEWYJ_ANDROID_KEY_PASSWORD
    $StorePassword = $null
    $KeyPassword = $null
}
