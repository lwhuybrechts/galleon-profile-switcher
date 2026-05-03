# Registers focus-switcher.js to run silently on Windows startup
# via Task Scheduler. Run this script once as Administrator.
#
# To remove the task later:
#   Unregister-ScheduledTask -TaskName "GalleonProfileSwitcher" -Confirm:$false

$taskName   = "GalleonProfileSwitcher"
$scriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$vbsPath    = Join-Path $scriptDir "start-hidden.vbs"

if (-not (Test-Path $vbsPath)) {
    Write-Error "start-hidden.vbs not found in $scriptDir"
    exit 1
}

$action  = New-ScheduledTaskAction `
    -Execute "wscript.exe" `
    -Argument "`"$vbsPath`""

$trigger = New-ScheduledTaskTrigger -AtLogon

$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)

$principal = New-ScheduledTaskPrincipal `
    -UserId $env:USERNAME `
    -LogonType Interactive `
    -RunLevel Highest

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Force | Out-Null

Write-Host "Task '$taskName' registered. It will run automatically at next login."
Write-Host "To start it now without rebooting, run:"
Write-Host "  Start-ScheduledTask -TaskName '$taskName'"
