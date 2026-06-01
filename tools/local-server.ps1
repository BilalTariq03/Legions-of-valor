param(
    [string]$Root = "",
    [int]$Port = 5173
)

# Legions of Valor local static server
# No Python, no Node, no npm. This version uses a raw .NET TcpListener instead
# of HttpListener so it can listen on your Wi-Fi network address for LAN testing.
# Keep this window open while playing. Close it to stop the local server.

$ErrorActionPreference = "Stop"

function Get-MimeType([string]$Path) {
    $ext = [System.IO.Path]::GetExtension($Path).ToLowerInvariant()
    switch ($ext) {
        ".html" { "text/html; charset=utf-8"; break }
        ".css"  { "text/css; charset=utf-8"; break }
        ".js"   { "application/javascript; charset=utf-8"; break }
        ".mjs"  { "application/javascript; charset=utf-8"; break }
        ".json" { "application/json; charset=utf-8"; break }
        ".svg"  { "image/svg+xml"; break }
        ".png"  { "image/png"; break }
        ".jpg"  { "image/jpeg"; break }
        ".jpeg" { "image/jpeg"; break }
        ".webp" { "image/webp"; break }
        ".gif"  { "image/gif"; break }
        ".ico"  { "image/x-icon"; break }
        ".woff" { "font/woff"; break }
        ".woff2" { "font/woff2"; break }
        default  { "application/octet-stream"; break }
    }
}

function Get-LanIPv4() {
    try {
        $addresses = [System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) |
            Where-Object {
                $_.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork -and
                -not $_.IPAddressToString.StartsWith("127.") -and
                -not $_.IPAddressToString.StartsWith("169.254.")
            }
        if ($addresses.Count -gt 0) { return $addresses[0].IPAddressToString }
    } catch {}
    return "localhost"
}

function Send-Response($stream, [int]$StatusCode, [string]$StatusText, [string]$ContentType, [byte[]]$Body) {
    $headers = "HTTP/1.1 $StatusCode $StatusText`r`n" +
               "Content-Type: $ContentType`r`n" +
               "Content-Length: $($Body.Length)`r`n" +
               "Access-Control-Allow-Origin: *`r`n" +
               "Cache-Control: no-store, no-cache, must-revalidate, max-age=0`r`n" +
               "Pragma: no-cache`r`n" +
               "Expires: 0`r`n" +
               "Connection: close`r`n`r`n"
    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headers)
    $stream.Write($headerBytes, 0, $headerBytes.Length)
    if ($Body.Length -gt 0) { $stream.Write($Body, 0, $Body.Length) }
}

try {
    if ([string]::IsNullOrWhiteSpace($Root)) {
        $Root = Split-Path -Parent $PSScriptRoot
    }
    $Root = $Root.Trim().Trim('"').TrimEnd('\', '/')
    $Root = [System.IO.Path]::GetFullPath($Root)
} catch {
    Write-Host "Could not understand the project folder path." -ForegroundColor Red
    Write-Host "Raw path received: [$Root]"
    Write-Host "Error: $($_.Exception.Message)"
    Read-Host "Press Enter to close"
    exit 1
}

if (-not (Test-Path $Root)) {
    Write-Host "Project folder not found: $Root" -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
}

$listener = $null
$chosenPort = $Port
for ($p = $Port; $p -le ($Port + 20); $p++) {
    try {
        $candidate = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $p)
        $candidate.Start()
        $listener = $candidate
        $chosenPort = $p
        break
    } catch {}
}

if ($null -eq $listener) {
    Write-Host "Could not start a local server on ports $Port to $($Port + 20)." -ForegroundColor Red
    Write-Host "Try closing old server windows, then run this file again."
    Read-Host "Press Enter to close"
    exit 1
}

$lanIp = Get-LanIPv4
$localUrl = "http://localhost:$chosenPort/"
$lanUrl = if ($lanIp -ne "localhost") { "http://$lanIp`:$chosenPort/" } else { $localUrl }

Clear-Host
Write-Host "LEGIONS OF VALOR - LOCAL + LAN BROWSER SERVER" -ForegroundColor Yellow
Write-Host "============================================================"
Write-Host "Project folder: $Root"
Write-Host "This PC URL:      $localUrl" -ForegroundColor Green
Write-Host "Same Wi-Fi URL:   $lanUrl" -ForegroundColor Green
Write-Host ""
Write-Host "IMPORTANT:" -ForegroundColor Cyan
Write-Host "- Keep this PowerShell window open while playing."
Write-Host "- Player 2 on another laptop should use the Same Wi-Fi URL/invite link."
Write-Host "- If Windows Firewall asks, click Allow access for Private networks."
Write-Host "- Worldwide play still needs deployment to Firebase Hosting/Netlify."
Write-Host ""
Write-Host "Opening Microsoft Edge using the Same Wi-Fi URL so Copy Invite Link uses it..."

try { Start-Process "msedge.exe" $lanUrl } catch { Start-Process $lanUrl }

Write-Host ""
Write-Host "Request log:"

try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        try {
            $stream = $client.GetStream()
            $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII, $false, 4096, $true)
            $requestLine = $reader.ReadLine()
            if ([string]::IsNullOrWhiteSpace($requestLine)) { $client.Close(); continue }

            # Drain request headers.
            while ($true) {
                $line = $reader.ReadLine()
                if ($line -eq $null -or $line -eq "") { break }
            }

            $parts = $requestLine.Split(' ')
            $method = if ($parts.Length -gt 0) { $parts[0] } else { "GET" }
            $rawPath = if ($parts.Length -gt 1) { $parts[1] } else { "/" }
            $pathOnly = $rawPath.Split('?')[0]
            $relativePath = [System.Uri]::UnescapeDataString($pathOnly.TrimStart('/'))
            if ([string]::IsNullOrWhiteSpace($relativePath)) { $relativePath = "index.html" }

            $requestedFile = [System.IO.Path]::GetFullPath((Join-Path $Root $relativePath))
            if (-not $requestedFile.StartsWith($Root, [System.StringComparison]::OrdinalIgnoreCase)) {
                $body = [System.Text.Encoding]::UTF8.GetBytes("403 Forbidden")
                Send-Response $stream 403 "Forbidden" "text/plain; charset=utf-8" $body
                Write-Host "403 $method $pathOnly" -ForegroundColor DarkYellow
                continue
            }

            if ((Test-Path $requestedFile -PathType Container)) { $requestedFile = Join-Path $requestedFile "index.html" }

            if (Test-Path $requestedFile -PathType Leaf) {
                $bytes = [System.IO.File]::ReadAllBytes($requestedFile)
                Send-Response $stream 200 "OK" (Get-MimeType $requestedFile) $bytes
                Write-Host "200 $method $pathOnly"
            } else {
                $body = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $relativePath")
                Send-Response $stream 404 "Not Found" "text/plain; charset=utf-8" $body
                Write-Host "404 $method $pathOnly" -ForegroundColor DarkYellow
            }
        } catch {
            try {
                $body = [System.Text.Encoding]::UTF8.GetBytes("500 Server Error: $($_.Exception.Message)")
                Send-Response $stream 500 "Server Error" "text/plain; charset=utf-8" $body
            } catch {}
            Write-Host "500 $($_.Exception.Message)" -ForegroundColor Red
        } finally {
            if ($stream) { $stream.Close() }
            $client.Close()
        }
    }
} finally {
    if ($listener -ne $null) { $listener.Stop() }
}
