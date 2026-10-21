# Phase D staging bring-up: isolated production-mode environment.
# Creates .staging/ with fresh secrets (NEVER printed) + a VACUUM INTO copy
# of the dev database. Start the server separately with .staging/staging.env
# loaded into the process environment.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$stag = Join-Path $root ".staging"
New-Item -ItemType Directory -Force -Path $stag | Out-Null

$sess = (node -e "console.log(require('crypto').randomBytes(32).toString('hex'))").Trim()
$cron = (node -e "console.log(require('crypto').randomBytes(32).toString('hex'))").Trim()
$dbPath = Join-Path $stag "staging.db"
$dbUrl = "file:" + $dbPath.Replace('\', '/')

@(
  "NODE_ENV=production",
  "DATABASE_URL=`"$dbUrl`"",
  "SESSION_SECRET=$sess",
  "CRON_SECRET=$cron",
  "SITE_URL=http://localhost:3100",
  "ALLOW_SEED_LOGIN=",
  "BROKER_DRIVER=mock",
  "SMTP_HOST=",
  "SMTP_PORT=587",
  "SMTP_SECURE=false",
  "SMTP_USER=",
  "SMTP_PASS=",
  "EMAIL_FROM=",
  "TELEGRAM_BOT_TOKEN=",
  "TELEGRAM_CHAT_ID=",
  "LOG_LEVEL=info"
) | Set-Content -Path (Join-Path $stag "staging.env") -Encoding utf8

# Fresh DB copy via VACUUM INTO (consistent snapshot, integrity-checked later).
if (Test-Path $dbPath) { Remove-Item $dbPath -Force }
Push-Location $root
try {
  & npx tsx scripts/backup-db.ts $dbPath
  if ($LASTEXITCODE -ne 0) { throw "staging db copy failed" }
} finally { Pop-Location }

Write-Output "staging ready: $dbPath (secrets written to .staging/staging.env, not shown)"
