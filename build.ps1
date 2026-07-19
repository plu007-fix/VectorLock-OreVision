# build.ps1 — package this add-on into <folder-name>.mcaddon (a .zip with BP/RP at root)
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$name = Split-Path -Leaf $root
$out  = Join-Path $root "$name.mcaddon"
if (Test-Path $out) { Remove-Item $out -Force }

$tops = @()
foreach ($d in @("BP","RP")) { if (Test-Path (Join-Path $root $d)) { $tops += $d } }

$tar = Join-Path $env:SystemRoot "System32\tar.exe"
Push-Location $root
try {
    if (Test-Path $tar) {
        $a = @("-c","--format","zip","-f",$out) + $tops
        & $tar @a
    } else {
        $zip = Join-Path $root "$name.zip"
        if (Test-Path $zip) { Remove-Item $zip -Force }
        Compress-Archive -Path $tops -DestinationPath $zip
        Rename-Item $zip $out
    }
} finally { Pop-Location }
Write-Host "built $out"
