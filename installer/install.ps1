param(
  [string]$ExtensionId = 'ffkffhcdadjmiobkeldaappibooafodb',
  [string]$SourceDir = '',
  [switch]$AddCliToPath
)
$ErrorActionPreference = 'Stop'
if ($ExtensionId -notmatch '^[a-p]{32}$') { throw 'ExtensionId must be a 32-character Chromium extension ID.' }
$Repo = Split-Path -Parent $PSScriptRoot
if (-not $SourceDir) { $SourceDir = Join-Path $Repo 'dist\native' }
$HostSource = Join-Path $SourceDir '986code-native-host.exe'
$CliSource = Join-Path $SourceDir '986code.exe'
if (-not (Test-Path $HostSource)) { throw "Native host executable not found: $HostSource" }
if (-not (Test-Path $CliSource)) { throw "CLI executable not found: $CliSource" }

$Root = Join-Path $env:LOCALAPPDATA '986Code\Bridge'
$Bin = Join-Path $Root 'bin'
New-Item -ItemType Directory -Force -Path $Bin,(Join-Path $Root 'instances') | Out-Null
Copy-Item $HostSource (Join-Path $Bin '986code-native-host.exe') -Force
Copy-Item $CliSource (Join-Path $Bin '986code.exe') -Force
$HostExe = Join-Path $Bin '986code-native-host.exe'
$Manifest = Join-Path $Root 'native-host.json'
$ManifestObj = [ordered]@{
  name = 'com.abeyytechxy.986code_bridge'
  description = '986Code Bridge Native Control Plane'
  path = $HostExe
  type = 'stdio'
  allowed_origins = @("chrome-extension://$ExtensionId/")
}
$ManifestObj | ConvertTo-Json -Depth 4 | Set-Content $Manifest -Encoding UTF8

$Keys = @(
  'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.abeyytechxy.986code_bridge',
  'HKCU:\Software\Opera Software\NativeMessagingHosts\com.abeyytechxy.986code_bridge'
)
foreach ($Key in $Keys) {
  New-Item -Path $Key -Force | Out-Null
  Set-Item -Path $Key -Value $Manifest
}

try {
  $Identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  & icacls.exe $Root /inheritance:r /grant:r "${Identity}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' | Out-Null
} catch {
  Write-Warning "Could not harden ACL automatically: $($_.Exception.Message)"
}
if ($AddCliToPath) {
  $UserPath = [Environment]::GetEnvironmentVariable('Path','User')
  $Parts = @($UserPath -split ';' | Where-Object { $_ })
  if ($Parts -notcontains $Bin) {
    [Environment]::SetEnvironmentVariable('Path', (($Parts + $Bin) -join ';'), 'User')
  }
}

$InstallInfo = [ordered]@{
  installedAt = (Get-Date).ToString('o')
  extensionId = $ExtensionId
  hostExe = $HostExe
  cliExe = (Join-Path $Bin '986code.exe')
  manifest = $Manifest
  version = '0.1.0-alpha.4'
}
$InstallInfo | ConvertTo-Json | Set-Content (Join-Path $Root 'install.json') -Encoding UTF8
Write-Host "986Code Bridge Native Control Plane installed."
Write-Host "ROOT=$Root"
Write-Host "EXTENSION_ID=$ExtensionId"
Write-Host "CLI=$(Join-Path $Bin '986code.exe')"
Write-Host 'Reload the extension, grant Native Messaging, then open Options -> Connect control plane.'

