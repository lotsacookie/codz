param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$coastRoot = Split-Path -Parent $PSScriptRoot
$coastWeb = Join-Path $coastRoot 'export\web'
foreach ($coastFile in @('index.html','map-assets.js','call-of-the-dead.js','coast/coast.gltf','coast/coast.bin','coast/collision.json','coast/collision.bin','coast/map-data.json','coast/sky/0.png')) {
    if (-not (Test-Path -LiteralPath (Join-Path $coastWeb $coastFile))) { throw "Missing Call of the Dead asset: $coastFile. Run .tools/rebuild-coast.ps1." }
}
$coastPorts = 5173..5183
$coastListening = @([System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() | ForEach-Object Port)
$coastPort = $null
foreach ($coastCandidate in $coastPorts) {
    if ($coastListening -contains $coastCandidate) {
        try {
            $coastHealth = Invoke-RestMethod "http://127.0.0.1:$coastCandidate/__health" -TimeoutSec 2
            if ($coastHealth.app -eq 'kino-browser-zombies' -and $coastHealth.root -eq $coastWeb) { $coastPort = $coastCandidate; break }
        } catch { }
    }
}
$coastLogs = Join-Path $coastRoot 'artifacts\call-of-the-dead'
New-Item -ItemType Directory -Path $coastLogs -Force | Out-Null
if ($null -eq $coastPort) {
    $coastPort = $coastPorts | Where-Object { $coastListening -notcontains $_ } | Select-Object -First 1
    if ($null -eq $coastPort) { throw 'No free local port in 5173-5183.' }
    $coastNode = (Get-Command node -ErrorAction Stop).Source
    $coastProcess = Start-Process -FilePath $coastNode -ArgumentList @('"'+(Join-Path $PSScriptRoot 'serve.mjs')+'"', "$coastPort") -WorkingDirectory $coastRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $coastLogs 'server.log') -RedirectStandardError (Join-Path $coastLogs 'server-error.log') -PassThru
    Set-Content -LiteralPath (Join-Path $coastLogs 'server.pid') -Value $coastProcess.Id
    $coastReady = $false
    for ($coastAttempt = 0; $coastAttempt -lt 40; $coastAttempt++) {
        try {
            $coastHealth = Invoke-RestMethod "http://127.0.0.1:$coastPort/__health" -TimeoutSec 1
            if ($coastHealth.app -eq 'kino-browser-zombies' -and $coastHealth.root -eq $coastWeb) { $coastReady = $true; break }
        } catch { }
        Start-Sleep -Milliseconds 200
    }
    if (-not $coastReady) { throw 'Call of the Dead server failed to start. See artifacts\call-of-the-dead\server-error.log.' }
}
$coastUrl = "http://127.0.0.1:$coastPort/?map=call-of-the-dead"
Set-Content -LiteralPath (Join-Path $coastLogs 'url.txt') -Value $coastUrl
Write-Host "Call of the Dead map: $coastUrl"
if (-not $NoBrowser) { Start-Process $coastUrl }
