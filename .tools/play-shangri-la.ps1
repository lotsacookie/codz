param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$shangriRoot = Split-Path -Parent $PSScriptRoot
foreach ($shangriFile in @('index.html','launcher.js','map-assets.js','shangri-la.js','shangri-la/shangri-la.gltf','shangri-la/shangri-la.bin','shangri-la/collision.json','shangri-la/collision.bin','shangri-la/map-data.json')) {
    if (-not (Test-Path -LiteralPath (Join-Path $shangriRoot "export/web/$shangriFile"))) {
        throw "Missing Shangri-La asset: $shangriFile. Run npm run build:shangri-la."
    }
}
$shangriLogs = Join-Path $shangriRoot 'artifacts'
New-Item -ItemType Directory -Path $shangriLogs -Force | Out-Null
$shangriWebRoot = Join-Path $shangriRoot 'export\web'
$shangriPorts = 5173..5183
$shangriListening = @([System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() | ForEach-Object Port)
$shangriPort = $null
foreach ($shangriCandidate in $shangriPorts) {
    if ($shangriListening -contains $shangriCandidate) {
        try {
            $shangriHealth = Invoke-RestMethod "http://127.0.0.1:$shangriCandidate/__health" -TimeoutSec 2
            if ($shangriHealth.app -eq 'kino-browser-zombies' -and $shangriHealth.root -eq $shangriWebRoot) { $shangriPort = $shangriCandidate; break }
        } catch { }
    }
}
if ($null -eq $shangriPort) {
    $shangriPort = $shangriPorts | Where-Object { $shangriListening -notcontains $_ } | Select-Object -First 1
    if ($null -eq $shangriPort) { throw 'No free local port in 5173-5183.' }
    $shangriNode = (Get-Command node -ErrorAction Stop).Source
    $shangriProcess = Start-Process -FilePath $shangriNode -ArgumentList @('"'+(Join-Path $PSScriptRoot 'serve.mjs')+'"', "$shangriPort") -WorkingDirectory $shangriRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $shangriLogs 'shangri-la-server.log') -RedirectStandardError (Join-Path $shangriLogs 'shangri-la-server-error.log') -PassThru
    Set-Content -LiteralPath (Join-Path $shangriLogs 'shangri-la-server.pid') -Value $shangriProcess.Id
    $shangriStarted = $false
    for ($shangriAttempt = 0; $shangriAttempt -lt 40; $shangriAttempt++) {
        try {
            $shangriHealth = Invoke-RestMethod "http://127.0.0.1:$shangriPort/__health" -TimeoutSec 1
            if ($shangriHealth.app -eq 'kino-browser-zombies' -and $shangriHealth.root -eq $shangriWebRoot) { $shangriStarted = $true; break }
        } catch { }
        Start-Sleep -Milliseconds 200
    }
    if (-not $shangriStarted) { throw 'Server failed to start. See artifacts\shangri-la-server-error.log.' }
}
$shangriUrl = "http://127.0.0.1:$shangriPort/?map=shangri-la"
Set-Content -LiteralPath (Join-Path $shangriLogs 'shangri-la-url.txt') -Value $shangriUrl
Write-Host "Shangri-La map is ready at $shangriUrl"
if (-not $NoBrowser) { Start-Process $shangriUrl }
