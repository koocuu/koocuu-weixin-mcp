param(
  [int]$Port = 3000,
  [string]$TaskName = "Koocuu Weixin MCP Local"
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..")
$StartScript = Join-Path $RepoRoot "scripts\start-local.ps1"

if (-not (Test-Path $StartScript)) {
  throw "start-local.ps1 not found at $StartScript"
}

$Action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$StartScript`" -Mode start -Port $Port -SkipBuild" `
  -WorkingDirectory $RepoRoot

$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$Settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Days 30) `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $Action `
  -Trigger $Trigger `
  -Settings $Settings `
  -Description "Run Koocuu Weixin MCP locally for Cloudflare Tunnel." `
  -Force | Out-Null

Write-Host "Installed scheduled task: $TaskName"
Write-Host "The task starts at Windows logon. Run scripts\start-local.ps1 once manually after changing code or env."
