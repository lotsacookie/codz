param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$ascensionRoot = Split-Path -Parent $PSScriptRoot
foreach ($ascensionFile in @('index.html','map-assets.js','shell.js','shell.css','maps/ascension.js','themes/viewer.css','ascension/ascension.gltf','ascension/ascension.bin','ascension/collision.json','ascension/collision.bin','ascension/map-data.json')) {
    if (-not (Test-Path -LiteralPath (Join-Path $ascensionRoot "export/web/$ascensionFile"))) {
        throw "Missing Ascension asset: $ascensionFile. Run npm run build:ascension."
    }
}
$ascensionLogs = Join-Path $ascensionRoot 'artifacts'
New-Item -ItemType Directory -Path $ascensionLogs -Force | Out-Null
$ascensionWebRoot = Join-Path $ascensionRoot 'export\web'
$ascensionPorts = 5173..5183
$ascensionListening = @([System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() | ForEach-Object Port)
$ascensionPort = $null
foreach ($ascensionCandidate in $ascensionPorts) {
    if ($ascensionListening -contains $ascensionCandidate) {
        try {
            $ascensionHealth = Invoke-RestMethod "http://127.0.0.1:$ascensionCandidate/__health" -TimeoutSec 2
            if ($ascensionHealth.app -eq 'kino-browser-zombies' -and $ascensionHealth.root -eq $ascensionWebRoot) { $ascensionPort = $ascensionCandidate; break }
        } catch { }
    }
}
if ($null -eq $ascensionPort) {
    $ascensionPort = $ascensionPorts | Where-Object { $ascensionListening -notcontains $_ } | Select-Object -First 1
    if ($null -eq $ascensionPort) { throw 'No free local port in 5173-5183.' }
    $ascensionNode = (Get-Command node -ErrorAction Stop).Source
    $ascensionProcess = Start-Process -FilePath $ascensionNode -ArgumentList @('"'+(Join-Path $PSScriptRoot 'serve.mjs')+'"', "$ascensionPort") -WorkingDirectory $ascensionRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $ascensionLogs 'ascension-server.log') -RedirectStandardError (Join-Path $ascensionLogs 'ascension-server-error.log') -PassThru
    Set-Content -LiteralPath (Join-Path $ascensionLogs 'ascension-server.pid') -Value $ascensionProcess.Id
    $ascensionStarted = $false
    for ($ascensionAttempt = 0; $ascensionAttempt -lt 40; $ascensionAttempt++) {
        try {
            $ascensionHealth = Invoke-RestMethod "http://127.0.0.1:$ascensionPort/__health" -TimeoutSec 1
            if ($ascensionHealth.app -eq 'kino-browser-zombies' -and $ascensionHealth.root -eq $ascensionWebRoot) { $ascensionStarted = $true; break }
        } catch { }
        Start-Sleep -Milliseconds 200
    }
    if (-not $ascensionStarted) { throw 'Server failed to start. See artifacts\ascension-server-error.log.' }
}
$ascensionUrl = "http://127.0.0.1:$ascensionPort/?map=ascension"
Set-Content -LiteralPath (Join-Path $ascensionLogs 'ascension-url.txt') -Value $ascensionUrl
Write-Host "Ascension map is ready at $ascensionUrl"
if (-not $NoBrowser) { Start-Process $ascensionUrl }
