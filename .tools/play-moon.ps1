param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$moonRoot = Split-Path -Parent $PSScriptRoot
foreach ($moonFile in @('index.html','assets/js/shell.js','assets/shell.css','assets/js/orientation.js','assets/js/maps/moon.js','assets/hud.css','assets/js/map-assets.js','assets/moon/moon.gltf','assets/moon/moon.bin','assets/moon/collision.bin','assets/moon/map-data.json','assets/moon/combat-data.json','assets/moon/navigation-earth.bin','assets/moon/navigation-moon.bin','assets/moon/navigation.json')) {
    if (-not (Test-Path -LiteralPath (Join-Path $moonRoot "export/web/$moonFile"))) {
        throw "Missing Moon asset: $moonFile. Run .tools/rebuild-moon.ps1."
    }
}
$moonPorts = 5173..5183
$moonListening = @([System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() | ForEach-Object Port)
$moonPort = $null
foreach ($moonCandidate in $moonPorts) {
    if ($moonListening -contains $moonCandidate) {
        try {
            $moonHealth = Invoke-RestMethod "http://127.0.0.1:$moonCandidate/__health" -TimeoutSec 2
            if ($moonHealth.app -eq 'kino-browser-zombies' -and $moonHealth.root -eq (Join-Path $moonRoot 'export\web')) { $moonPort = $moonCandidate; break }
        } catch { }
    }
}
if ($null -eq $moonPort) {
    $moonPort = $moonPorts | Where-Object { $moonListening -notcontains $_ } | Select-Object -First 1
    if ($null -eq $moonPort) { throw 'No free local port in 5173-5183.' }
    $moonLogs = Join-Path $moonRoot 'artifacts'
    New-Item -ItemType Directory -Path $moonLogs -Force | Out-Null
    $moonNode = (Get-Command node -ErrorAction Stop).Source
    $moonProcess = Start-Process -FilePath $moonNode -ArgumentList @('assets/"','assets/serve.mjs')+'"', "$moonPort") -WorkingDirectory $moonRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $moonLogs 'moon-server.log') -RedirectStandardError (Join-Path $moonLogs 'moon-server-error.log') -PassThru
    Set-Content -LiteralPath (Join-Path $moonLogs 'moon-server.pid') -Value $moonProcess.Id
    for ($moonAttempt = 0; $moonAttempt -lt 40; $moonAttempt++) {
        try {
            $moonHealth = Invoke-RestMethod "http://127.0.0.1:$moonPort/__health" -TimeoutSec 1
            if ($moonHealth.root -eq (Join-Path $moonRoot 'export\web')) { break }
        } catch { }
        Start-Sleep -Milliseconds 200
    }
    if ($moonHealth.root -ne (Join-Path $moonRoot 'export\web')) { throw 'Moon server failed to start. See artifacts\moon-server-error.log.' }
}
$moonUrl = "http://127.0.0.1:$moonPort/?map=moon"
Set-Content -LiteralPath (Join-Path $moonRoot 'artifacts/moon-url.txt') -Value $moonUrl
Write-Host "Moon Zombies is ready at $moonUrl"
if (-not $NoBrowser) { Start-Process $moonUrl }
