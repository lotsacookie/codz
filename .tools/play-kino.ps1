param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$kinoRoot = Split-Path -Parent $PSScriptRoot
foreach ($kinoFile in @('index.html','kino.gltf','kino.bin','collision.bin','game-data.json','navigation.bin','kino-features.js','shell.js','shell.css','maps/kino.js','hud.css')) {
    if (-not (Test-Path -LiteralPath (Join-Path $kinoRoot "export/web/$kinoFile"))) {
        throw "Missing Kino asset: $kinoFile. Run .tools/rebuild-kino.ps1."
    }
}
$kinoPorts = 5173..5183
$kinoListening = @([System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() | ForEach-Object Port)
$kinoPort = $null
foreach ($kinoCandidate in $kinoPorts) {
    if ($kinoListening -contains $kinoCandidate) {
        try {
            $kinoHealth = Invoke-RestMethod "http://127.0.0.1:$kinoCandidate/__health" -TimeoutSec 2
            if ($kinoHealth.app -eq 'kino-browser-zombies' -and $kinoHealth.root -eq (Join-Path $kinoRoot 'export\web')) { $kinoPort = $kinoCandidate; break }
        } catch { }
    }
}
if ($null -eq $kinoPort) {
    $kinoPort = $kinoPorts | Where-Object { $kinoListening -notcontains $_ } | Select-Object -First 1
    if ($null -eq $kinoPort) { throw 'No free local port in 5173-5183.' }
    $kinoLogs = Join-Path $kinoRoot 'artifacts'
    New-Item -ItemType Directory -Path $kinoLogs -Force | Out-Null
    $kinoNode = (Get-Command node -ErrorAction Stop).Source
    $kinoProcess = Start-Process -FilePath $kinoNode -ArgumentList @('"'+(Join-Path $PSScriptRoot 'serve.mjs')+'"', "$kinoPort") -WorkingDirectory $kinoRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $kinoLogs 'server.log') -RedirectStandardError (Join-Path $kinoLogs 'server-error.log') -PassThru
    Set-Content -LiteralPath (Join-Path $kinoLogs 'server.pid') -Value $kinoProcess.Id
    for ($kinoAttempt = 0; $kinoAttempt -lt 40; $kinoAttempt++) {
        try {
            $kinoHealth = Invoke-RestMethod "http://127.0.0.1:$kinoPort/__health" -TimeoutSec 1
            if ($kinoHealth.root -eq (Join-Path $kinoRoot 'export\web')) { break }
        } catch { }
        Start-Sleep -Milliseconds 200
    }
    if ($kinoHealth.root -ne (Join-Path $kinoRoot 'export\web')) { throw 'Kino server failed to start. See artifacts\server-error.log.' }
}
$kinoUrl = "http://127.0.0.1:$kinoPort/"
Set-Content -LiteralPath (Join-Path $kinoRoot 'artifacts/kino-url.txt') -Value $kinoUrl
Write-Host "Kino Zombies is ready at $kinoUrl"
if (-not $NoBrowser) { Start-Process $kinoUrl }
