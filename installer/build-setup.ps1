param([string]$OutputDir = '')
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
if (-not $OutputDir) { $OutputDir = Join-Path $Repo 'dist\installer' }
$NativeDir = Join-Path $Repo 'dist\native'
$HostExe = Join-Path $NativeDir '986code-native-host.exe'
$CliExe = Join-Path $NativeDir '986code.exe'
$McpExe = Join-Path $NativeDir '986code-mcp.exe'
if (!(Test-Path $HostExe) -or !(Test-Path $CliExe) -or !(Test-Path $McpExe)) { throw 'Run installer\build-native.ps1 first.' }
$Node = (Get-Command node.exe -ErrorAction Stop).Source
$Npx = (Get-Command npx.cmd -ErrorAction Stop).Source
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$Work = Join-Path $env:TEMP ('986code-setup-sea-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $Work | Out-Null
try {
  Copy-Item (Join-Path $Repo 'installer\setup.cjs') (Join-Path $Work 'setup.cjs')
  $Assets = [ordered]@{}
  foreach ($Pair in @(@($HostExe,'986code-native-host.exe.gz'),@($CliExe,'986code.exe.gz'),@($McpExe,'986code-mcp.exe.gz'))) {
    $Source = $Pair[0]
    $Name = $Pair[1]
    $Gz = Join-Path $Work $Name
    & $Node -e "const fs=require('fs'),z=require('zlib'); fs.writeFileSync(process.argv[2],z.gzipSync(fs.readFileSync(process.argv[1]),{level:9}));" $Source $Gz
    if ($LASTEXITCODE -ne 0) { throw "Asset compression failed: $Source" }
    $Assets[$Name] = $Gz
  }
  $Cfg = [ordered]@{ main='setup.cjs'; output='sea-prep.blob'; disableExperimentalSEAWarning=$true; useCodeCache=$false; assets=$Assets }
  $Cfg | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $Work 'sea-config.json') -Encoding UTF8
  Push-Location $Work
  & $Node --experimental-sea-config sea-config.json
  if ($LASTEXITCODE -ne 0) { throw 'SEA blob generation failed.' }
  $Out = Join-Path $OutputDir '986CodeBridge-Setup.exe'
  Copy-Item $Node $Out -Force
  & $Npx -y postject $Out NODE_SEA_BLOB (Join-Path $Work 'sea-prep.blob') --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
  if ($LASTEXITCODE -ne 0) { throw 'Setup postject failed.' }
  Write-Host "BUILT=$Out"
} finally {
  Pop-Location -ErrorAction SilentlyContinue
  Remove-Item $Work -Recurse -Force -ErrorAction SilentlyContinue
}
