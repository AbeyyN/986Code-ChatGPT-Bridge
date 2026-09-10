param([switch]$KeepProfiles)
$ErrorActionPreference = 'Stop'
$Root = Join-Path $env:LOCALAPPDATA '986Code\Bridge'
$Keys = @(
  'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.abeyytechxy.986code_bridge',
  'HKCU:\Software\Opera Software\NativeMessagingHosts\com.abeyytechxy.986code_bridge'
)
foreach ($Key in $Keys) {
  Remove-Item $Key -Recurse -Force -ErrorAction SilentlyContinue
}

$Bin = Join-Path $Root 'bin'
$UserPath = [Environment]::GetEnvironmentVariable('Path','User')
if ($UserPath) {
  $Parts = @($UserPath -split ';' | Where-Object { $_ -and $_ -ne $Bin })
  [Environment]::SetEnvironmentVariable('Path', ($Parts -join ';'), 'User')
}

if ($KeepProfiles -and (Test-Path (Join-Path $Root 'profiles.json'))) {
  $Backup = Join-Path $env:USERPROFILE ('986Code-profiles-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')
  Copy-Item (Join-Path $Root 'profiles.json') $Backup -Force
  Write-Host "Profile backup: $Backup"
}
Remove-Item $Root -Recurse -Force -ErrorAction SilentlyContinue
Write-Host '986Code Bridge Native Control Plane uninstalled.'
