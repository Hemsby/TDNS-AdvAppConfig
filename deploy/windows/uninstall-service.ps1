<#
.SYNOPSIS
    Uninstalls the TdnsAdvAppConfig Windows Service.

.DESCRIPTION
    Stops (if running) and removes the Windows Service created by
    install-service.ps1. Does not delete any files - config.json and the
    installed binaries are left in place.

    Must be run from an elevated (Administrator) PowerShell prompt.
#>
param(
    [string]$ServiceName = "TdnsAdvAppConfig"
)

$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "This script must be run from an elevated (Administrator) PowerShell prompt."
    exit 1
}

$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $service) {
    Write-Warning "No service named '$ServiceName' found - nothing to do."
    exit 0
}

if ($service.Status -ne "Stopped") {
    Stop-Service -Name $ServiceName -Force
}

sc.exe delete $ServiceName | Out-Null
Write-Host "Service '$ServiceName' removed."
