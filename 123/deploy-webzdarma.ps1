param(
    [string]$LocalRoot = "$PSScriptRoot\www",
    [string]$RemoteRoot = "/www"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$meta = Get-Content -LiteralPath "$PSScriptRoot\ftp-meta.json" -Raw | ConvertFrom-Json
$secretLines = Get-Content -LiteralPath "C:\Users\huquf\OneDrive\Plocha\pass sqp.txt"
$ftpPass = ($secretLines | Where-Object { $_ -match '^Heslo:' } | Select-Object -First 1).Split(':')[-1].Trim()
$ftpHost = $meta.host
$ftpUser = $meta.user
$siteUrl = "http://$ftpUser"

function ConvertTo-FtpPath([string]$path) {
    $parts = $path -replace '\\','/' -split '/' | Where-Object { $_ -ne '' }
    return '/' + (($parts | ForEach-Object { [Uri]::EscapeDataString($_) }) -join '/')
}

function New-FtpRequest([string]$remotePath, [string]$method) {
    $uri = "ftp://$ftpHost$(ConvertTo-FtpPath $remotePath)"
    $request = [System.Net.FtpWebRequest]::Create($uri)
    $request.Method = $method
    $request.Credentials = New-Object System.Net.NetworkCredential($ftpUser, $ftpPass)
    $request.UseBinary = $true
    $request.UsePassive = $true
    $request.KeepAlive = $false
    $request.Timeout = 30000
    $request.ReadWriteTimeout = 30000
    return $request
}

function Invoke-FtpDirectory([string]$remoteDir) {
    $segments = ($remoteDir -replace '\\','/' -split '/') | Where-Object { $_ -ne '' }
    $current = ''
    foreach ($segment in $segments) {
        $current = "$current/$segment"
        try {
            $request = New-FtpRequest $current ([System.Net.WebRequestMethods+Ftp]::MakeDirectory)
            $response = $request.GetResponse()
            $response.Close()
        } catch [System.Net.WebException] {
            if ($_.Exception.Response) { $_.Exception.Response.Close() }
        }
    }
}

function Send-FtpFile([string]$localFile, [string]$remoteFile) {
    $bytes = [System.IO.File]::ReadAllBytes($localFile)
    $attempt = 0
    while ($attempt -lt 3) {
        $attempt++
        try {
            $request = New-FtpRequest $remoteFile ([System.Net.WebRequestMethods+Ftp]::UploadFile)
            $request.ContentLength = $bytes.Length
            $stream = $request.GetRequestStream()
            $stream.Write($bytes, 0, $bytes.Length)
            $stream.Close()
            $response = $request.GetResponse()
            $response.Close()
            return
        } catch {
            if ($attempt -ge 3) { throw }
            Start-Sleep -Seconds (2 * $attempt)
        }
    }
}

Invoke-FtpDirectory $RemoteRoot
Get-ChildItem -LiteralPath $LocalRoot -Recurse -Directory | ForEach-Object {
    $relative = $_.FullName.Substring((Resolve-Path $LocalRoot).Path.Length).TrimStart('\','/')
    Invoke-FtpDirectory "$RemoteRoot/$relative"
}

$files = Get-ChildItem -LiteralPath $LocalRoot -Recurse -File
$uploaded = 0
foreach ($file in $files) {
    $relative = $file.FullName.Substring((Resolve-Path $LocalRoot).Path.Length).TrimStart('\','/')
    Write-Host "Uploading $relative"
    Send-FtpFile $file.FullName "$RemoteRoot/$relative"
    $uploaded++
}

function Invoke-Json([string]$url, [string]$method = "GET", $body = $null, $session = $null, $headers = @{}) {
    $params = @{
        Uri = $url
        Method = $method
        UseBasicParsing = $true
        Headers = $headers
        TimeoutSec = 30
    }
    if ($session) { $params.WebSession = $session }
    if ($body -ne $null) {
        $params.Body = $body
        $params.ContentType = "application/json"
    }
    $response = Invoke-WebRequest @params
    return $response.Content | ConvertFrom-Json
}

$installUrls = @(
    "$siteUrl/api/install?key=$($meta.install_key)",
    "$siteUrl/api/index.php?route=install&key=$($meta.install_key)"
)
$installed = $false
$installError = $null
foreach ($url in $installUrls) {
    try {
        $install = Invoke-Json $url
        if ($install.ok) { $installed = $true; break }
    } catch {
        $installError = $_.Exception.Message
    }
}
if (-not $installed) {
    throw "Schema install failed: $installError"
}

$web = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$me = Invoke-Json "$siteUrl/api/auth/me" "GET" $null $web
$csrf = $me.csrf
$loginBody = @{ email = "admin@pokladna.cz"; password = "Pokladna2026!" } | ConvertTo-Json
$login = Invoke-Json "$siteUrl/api/auth/login" "POST" $loginBody $web @{ "X-CSRF-Token" = $csrf; "Accept" = "application/json" }
if (-not $login.ok) { throw "Login verification failed" }
$dash = Invoke-Json "$siteUrl/api/dashboard?month=$((Get-Date).Month)&year=$((Get-Date).Year)" "GET" $null $web
if (-not $dash.ok) { throw "Dashboard verification failed" }

$result = [ordered]@{
    ok = $true
    site = $siteUrl
    uploaded_files = $uploaded
    install = $installed
    login = $true
    dashboard = $true
}
$result | ConvertTo-Json | Set-Content -LiteralPath "$PSScriptRoot\deploy-result.json" -Encoding UTF8
$result | ConvertTo-Json
