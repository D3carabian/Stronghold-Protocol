param(
  [Parameter(Mandatory=$true)][string]$GameDirectory,
  [Parameter(Mandatory=$true)][string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
  # Run from the matching fork version, after npm ci. Keep the client updated separately.
  & node tools/setup.mjs --local --game $GameDirectory
  if ($LASTEXITCODE -ne 0) { throw 'Asset setup failed' }
  & python ops/asset_bundle.py validate .
  if ($LASTEXITCODE -ne 0) { throw 'Asset validation failed' }
  $version = (Get-Content package.json -Raw | ConvertFrom-Json).version
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $out = [System.IO.Path]::GetFullPath($OutputDirectory)
  New-Item -ItemType Directory -Force -Path $out | Out-Null
  $stage = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString())
  $bundleRoot = Join-Path $stage 'Stronghold-Protocol'
  New-Item -ItemType Directory -Force -Path (Join-Path $bundleRoot 'public'),(Join-Path $bundleRoot 'data') | Out-Null
  try {
    Copy-Item public/assets (Join-Path $bundleRoot 'public/assets') -Recurse
    Copy-Item public/fonts (Join-Path $bundleRoot 'public/fonts') -Recurse
    Copy-Item data/assets.json,data/local-assets.json (Join-Path $bundleRoot 'data')
    Copy-Item package.json,LICENSE,NOTICE.md,THIRD-PARTY-NOTICES.md $bundleRoot
    $archive = Join-Path $out "Stronghold-Protocol-v$version-custom-$stamp.zip"
    Compress-Archive -Path $bundleRoot -DestinationPath $archive
    $digest = (Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    @{tag="v$version";sha256=$digest;asset=(Split-Path -Leaf $archive);source='windows-client'} |
      ConvertTo-Json | Set-Content -Encoding utf8 "$archive.lock.json"
    Write-Host "Created $archive and its .lock.json. Transfer privately; do not commit game assets."
  } finally { if (Test-Path $stage) { Remove-Item -LiteralPath $stage -Recurse -Force } }
} finally { Pop-Location }
