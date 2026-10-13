# Sets Fly secrets from local .env without printing values.
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

$fly = Join-Path $env:USERPROFILE ".fly\bin\flyctl.exe"
if (-not (Test-Path $fly)) { $fly = Join-Path $env:USERPROFILE ".fly\bin\fly.exe" }

$required = @(
  "BOT_TOKEN",
  "BOT_USERNAME",
  "MINIAPP_SHORT_NAME",
  "STARTAPP_SECRET",
  "WEBHOOK_SECRET",
  "DATABASE_URL",
  "REDIS_URL",
  "PUBLIC_API_URL",
  "PUBLIC_MINIAPP_URL"
)

$map = @{}
Get-Content (Join-Path $root ".env") | ForEach-Object {
  if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
  $parts = $_ -split "=", 2
  if ($parts.Length -lt 2) { return }
  $key = $parts[0].Trim()
  $val = $parts[1].Trim().Trim('"').Trim("'")
  $map[$key] = $val
}

foreach ($k in $required) {
  if (-not $map.ContainsKey($k) -or [string]::IsNullOrWhiteSpace($map[$k])) {
    throw "Missing $k in .env"
  }
}

if ($map["REDIS_URL"] -notmatch '^rediss?://') {
  throw "REDIS_URL must start with rediss:// (or redis://). You currently have an HTTP URL. In Upstash console open the Redis database → Connect → copy Redis URL (not REST URL)."
}

$args = @(
  "secrets", "set",
  "BOT_TOKEN=$($map['BOT_TOKEN'])",
  "BOT_USERNAME=$($map['BOT_USERNAME'])",
  "MINIAPP_SHORT_NAME=$($map['MINIAPP_SHORT_NAME'])",
  "STARTAPP_SECRET=$($map['STARTAPP_SECRET'])",
  "WEBHOOK_SECRET=$($map['WEBHOOK_SECRET'])",
  "DATABASE_URL=$($map['DATABASE_URL'])",
  "REDIS_URL=$($map['REDIS_URL'])",
  "PUBLIC_API_URL=$($map['PUBLIC_API_URL'])",
  "PUBLIC_MINIAPP_URL=$($map['PUBLIC_MINIAPP_URL'])",
  "BOT_MODE=webhook",
  "API_HOST=0.0.0.0",
  "API_PORT=3000",
  "WEBHOOK_PATH=/telegram/webhook"
)

Write-Host "Setting Fly secrets (values hidden)..."
& $fly @args
Write-Host "Done."
