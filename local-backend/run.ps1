$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$DataRoot = Join-Path $Root "data"
$SettingsPath = Join-Path $DataRoot "settings.json"
$FailureLogPath = if (-not [string]::IsNullOrWhiteSpace($env:VOCAB_BACKEND_FAILURE_LOG)) {
    [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($env:VOCAB_BACKEND_FAILURE_LOG).Trim().Trim('"'))
} else {
    Join-Path $DataRoot "后台启动错误.txt"
}
$CapturedOutput = New-Object "System.Collections.Generic.Queue[string]"
$CapturedOutputLimit = 120

function Write-AtomicUtf8Text {
    param([string]$Path, [string]$Content, [bool]$Bom = $false)
    $temporary = $Path + ".tmp-" + [Guid]::NewGuid().ToString("N")
    try {
        [IO.File]::WriteAllText($temporary, $Content, (New-Object System.Text.UTF8Encoding($Bom)))
        if ([IO.File]::Exists($Path)) {
            [IO.File]::Replace($temporary, $Path, [NullString]::Value)
        } else {
            [IO.File]::Move($temporary, $Path)
        }
    } finally {
        [IO.File]::Delete($temporary)
    }
}

function Add-CapturedOutputLine {
    param($Value)
    $line = ([string]$Value -replace "`0", "").TrimEnd()
    if ($line.Length -gt 2000) {
        $line = $line.Substring(0, 2000) + " [已截断]"
    }
    $CapturedOutput.Enqueue($line)
    while ($CapturedOutput.Count -gt $CapturedOutputLimit) {
        $null = $CapturedOutput.Dequeue()
    }
}

function Write-BackendFailureLog {
    param(
        [Parameter(Mandatory = $true)][string]$Summary,
        [string[]]$Lines = @()
    )
    try {
        $directory = Split-Path -Parent $FailureLogPath
        $null = [IO.Directory]::CreateDirectory($directory)
        $content = New-Object System.Collections.Generic.List[string]
        $content.Add("WYJ 本地后端启动错误")
        $content.Add(("生成时间: " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz")))
        $content.Add(("摘要: " + $Summary))
        $content.Add("")
        foreach ($line in $Lines) {
            $content.Add([string]$line)
        }
        Write-AtomicUtf8Text -Path $FailureLogPath -Content (($content -join [Environment]::NewLine) + [Environment]::NewLine) -Bom $true
    } catch {
        # A secondary logging failure must not hide the original process exit.
    }
}

trap {
    $message = $_.Exception.Message
    Add-CapturedOutputLine -Value $_
    Write-BackendFailureLog -Summary ("PowerShell 启动阶段失败: " + $message) -Lines @($CapturedOutput)
    [Console]::Error.WriteLine($message)
    exit 1
}

$null = [IO.Directory]::CreateDirectory($DataRoot)

$settings = [pscustomobject]@{}
if ([IO.File]::Exists($SettingsPath)) {
    try {
        $rawSettings = Get-Content -Raw -Encoding UTF8 -LiteralPath $SettingsPath
        if ($rawSettings.Trim()) {
            $settings = $rawSettings | ConvertFrom-Json
        }
    } catch {
        throw "Cannot read data\settings.json: $($_.Exception.Message)"
    }
}

$settingsChanged = $false
$generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try {
    foreach ($property in @("share_hmac_key", "legacy_identity_bridge_key")) {
        if ($settings.PSObject.Properties[$property] -and [string]$settings.$property) { continue }
        $bytes = New-Object byte[] 32
        $generator.GetBytes($bytes)
        $key = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
        $settings | Add-Member -NotePropertyName $property -NotePropertyValue $key -Force
        $settingsChanged = $true
    }
} finally {
    $generator.Dispose()
}
if ($settingsChanged) {
    # Generate both missing keys once and commit one complete settings image.
    # Existing values and unrelated fields are retained, including old accounts.
    Write-AtomicUtf8Text -Path $SettingsPath -Content ($settings | ConvertTo-Json -Depth 8)
}

$env:VOCAB_SHARE_HMAC_KEY = [string]$settings.share_hmac_key
$env:VOCAB_LEGACY_IDENTITY_BRIDGE_SECRET = [string]$settings.legacy_identity_bridge_key
$env:VOCAB_CLOUD_ACCOUNT_PRIMARY = if (
    $settings.PSObject.Properties["cloud_account_primary"] -and [bool]$settings.cloud_account_primary
) { "true" } else { "false" }
if (-not $env:VOCAB_ADMIN_SECRET -and $settings.PSObject.Properties["access_token"] -and [string]$settings.access_token) {
    # Existing databases keep their administrator password. This fallback is
    # used only for a new database without an explicit bootstrap secret.
    $env:VOCAB_ADMIN_SECRET = [string]$settings.access_token
}

$python = ""
if ($env:VOCAB_PYTHON_EXE -and [IO.File]::Exists($env:VOCAB_PYTHON_EXE)) {
    $python = [IO.Path]::GetFullPath($env:VOCAB_PYTHON_EXE)
}
if (-not $python) {
    $python = (Get-Command python.exe -ErrorAction SilentlyContinue).Source
}
if (-not $python) {
    $python = (Get-Command python -ErrorAction SilentlyContinue).Source
}
if (-not $python) {
    throw "Python 3 was not found. Set VOCAB_PYTHON_EXE or add Python to PATH."
}

Set-Location -LiteralPath $Root
$serverPath = Join-Path $Root "server.py"
$previousErrorActionPreference = $ErrorActionPreference
try {
    # Windows PowerShell 5 represents native stderr as non-terminating
    # ErrorRecord objects. Continue keeps them in the bounded capture pipeline.
    $ErrorActionPreference = "Continue"
    & $python $serverPath --host 0.0.0.0 --port 8765 2>&1 |
        ForEach-Object { Add-CapturedOutputLine -Value $_ }
    $pythonExitCode = $LASTEXITCODE
} finally {
    $ErrorActionPreference = $previousErrorActionPreference
}
if ($pythonExitCode -ne 0) {
    Write-BackendFailureLog -Summary ("Python 后端退出，退出码 " + $pythonExitCode) -Lines @($CapturedOutput)
    $lastLine = if ($CapturedOutput.Count) { [string]$CapturedOutput.ToArray()[-1] } else { "没有捕获到 Python 输出。" }
    [Console]::Error.WriteLine($lastLine)
}
exit $pythonExitCode
