param(
  [ValidateSet("dev", "start")]
  [string]$Mode = "start",
  [int]$Port = 3000,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..")
Set-Location $RepoRoot

if (-not (Test-Path ".env.local")) {
  Write-Host "Missing .env.local. Copy .env.local.example to .env.local and fill secrets first." -ForegroundColor Yellow
  exit 1
}

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Write-Host "pnpm is not installed or not on PATH." -ForegroundColor Red
  exit 1
}

if (-not (Test-Path "node_modules")) {
  pnpm install --frozen-lockfile
}

if ($Mode -eq "dev") {
  Write-Host "Starting Koocuu Weixin MCP in dev mode on http://127.0.0.1:$Port"
  pnpm exec next dev -p $Port -H 127.0.0.1
  exit $LASTEXITCODE
}

if (-not $SkipBuild) {
  pnpm build
}

Write-Host "Starting Koocuu Weixin MCP on http://127.0.0.1:$Port"
pnpm exec next start -p $Port -H 127.0.0.1
exit $LASTEXITCODE
