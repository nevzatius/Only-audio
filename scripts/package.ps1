# extension/ klasörünü dist/audio-only-v<sürüm>.zip olarak paketler (sürüm manifest.json'dan okunur).
# _metadata/ tarayıcının ürettiği dizindir, pakete girmez. Girdi yolları '/' ile yazılır.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$repo = Split-Path -Parent $PSScriptRoot
$root = (Resolve-Path (Join-Path $repo 'extension')).Path
$version = (Get-Content (Join-Path $root 'manifest.json') -Raw | ConvertFrom-Json).version
$dist = Join-Path $repo 'dist'
New-Item -ItemType Directory -Force $dist | Out-Null
$zip = Join-Path $dist ("audio-only-v$version.zip")
if (Test-Path $zip) { Remove-Item $zip -Force }
$fs = [System.IO.File]::Open($zip, 'Create')
$arc = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
Get-ChildItem $root -Recurse -File | Where-Object { $_.FullName -notlike '*\_metadata\*' } | Sort-Object FullName | ForEach-Object {
  $rel = $_.FullName.Substring($root.Length + 1).Replace('\', '/')
  [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($arc, $_.FullName, $rel, [System.IO.Compression.CompressionLevel]::Optimal)
}
$arc.Dispose(); $fs.Dispose()
"$zip  $((Get-Item $zip).Length) bayt  sha256=$((Get-FileHash $zip -Algorithm SHA256).Hash)"
