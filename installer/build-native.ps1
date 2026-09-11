param(
  [string]$OutputDir = ""
)
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
if (-not $OutputDir) { $OutputDir = Join-Path $Repo 'dist\native' }
$Node = (Get-Command node.exe -ErrorAction Stop).Source
$Npx = (Get-Command npx.cmd -ErrorAction Stop).Source
$Npm = (Get-Command npm.cmd -ErrorAction Stop).Source
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

function Build-Sea([string]$Source, [string]$Name) {
  $Work = Join-Path $env:TEMP ("986code-sea-" + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force -Path $Work | Out-Null
  try {
    Copy-Item $Source (Join-Path $Work 'app.cjs')
    $Cfg = @{ main='app.cjs'; output='sea-prep.blob'; disableExperimentalSEAWarning=$true; useCodeCache=$false } | ConvertTo-Json
    Set-Content (Join-Path $Work 'sea-config.json') $Cfg -Encoding UTF8
    Push-Location $Work
    try {
      & $Node --experimental-sea-config sea-config.json
      if ($LASTEXITCODE -ne 0) { throw "SEA blob failed for $Name" }
      $Exe = Join-Path $OutputDir $Name
      Copy-Item $Node $Exe -Force
      & $Npx -y postject $Exe NODE_SEA_BLOB (Join-Path $Work 'sea-prep.blob') --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
      if ($LASTEXITCODE -ne 0) { throw "postject failed for $Name" }
      Write-Host "BUILT=$Exe"
    } finally { Pop-Location }
  } finally { Remove-Item $Work -Recurse -Force -ErrorAction SilentlyContinue }
}
Push-Location $Repo
try {
  & $Npm run build:mcp
  if ($LASTEXITCODE -ne 0) { throw 'MCP bundle build failed.' }
} finally { Pop-Location }

Build-Sea (Join-Path $Repo 'native\native-host.cjs') '986code-native-host.exe'
Build-Sea (Join-Path $Repo 'native\cli.cjs') '986code.exe'
Build-Sea (Join-Path $Repo 'dist\mcp\986code-mcp.bundle.cjs') '986code-mcp.exe'
