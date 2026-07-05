<#
.SYNOPSIS
    Installs TdnsAdvAppConfig as a Windows Service.

.DESCRIPTION
    Registers TdnsAdvAppConfig.exe (found in this script's own folder unless
    -InstallDir is given) as a Windows Service named TdnsAdvAppConfig, set to
    start automatically and restart itself on failure - the closest Windows
    equivalent to the Linux deployment's systemd Restart=always.

    Must be run from an elevated (Administrator) PowerShell prompt.

.PARAMETER InstallDir
    Folder containing TdnsAdvAppConfig.exe and config.json. Defaults to this
    script's own folder.

.PARAMETER ServiceName
    Windows Service name. Defaults to "TdnsAdvAppConfig". If you change this,
    the self-update feature's post-update restart (see UpdateApplier.cs) needs
    to match - it looks for a service literally named "TdnsAdvAppConfig".
#>
param(
    [string]$InstallDir = $PSScriptRoot,
    [string]$ServiceName = "TdnsAdvAppConfig"
)

$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "This script must be run from an elevated (Administrator) PowerShell prompt."
    exit 1
}

$exePath = Join-Path $InstallDir "TdnsAdvAppConfig.exe"
if (-not (Test-Path $exePath)) {
    Write-Error "TdnsAdvAppConfig.exe not found at $exePath - pass -InstallDir if it's elsewhere."
    exit 1
}

$configPath = Join-Path $InstallDir "config.json"
if (-not (Test-Path $configPath)) {
    Write-Warning "config.json not found at $configPath - the service will fail to start until you copy config.example.json to config.json there and fill it in."
}

if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    Write-Error "A service named '$ServiceName' already exists. Run uninstall-service.ps1 first if you want to reinstall it."
    exit 1
}

sc.exe create $ServiceName binPath= "`"$exePath`"" start= auto DisplayName= "TDNS Advanced Blocking Config" | Out-Null
sc.exe description $ServiceName "Pause/resume and config editor addon for Technitium DNS Server's Advanced Blocking app" | Out-Null

# Restart on failure (crash), up to 3 times with a 5s delay, resetting the
# failure count after a day of stable running. This is the closest Windows
# equivalent to the Linux unit's Restart=always - required for the self-update
# feature (see README) since it deliberately exits the process to relaunch on
# the new version.
sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/5000/restart/5000 | Out-Null

Write-Host "Service '$ServiceName' installed (start type: automatic)."
Write-Host "Start it now with:   Start-Service $ServiceName"
Write-Host "Stop it with:        Stop-Service $ServiceName"
Write-Host "Restart it with:     Restart-Service $ServiceName"
Write-Host "Check its status:    Get-Service $ServiceName"
Write-Host "View its logs:       Get-EventLog -LogName Application -Source $ServiceName -Newest 20"
