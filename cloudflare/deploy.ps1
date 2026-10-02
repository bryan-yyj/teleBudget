param([switch]$SkipWebhook)

$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $repo '.env'
$wrangler = Join-Path $repo 'node_modules\.bin\wrangler.cmd'
if (-not (Test-Path -LiteralPath $envFile)) { throw 'Create .env from .env.example and set TELEGRAM_BOT_TOKEN first.' }
if (-not (Test-Path -LiteralPath $wrangler)) { throw 'Run npm install first.' }

$settings = @{}
foreach ($line in [IO.File]::ReadAllLines($envFile)) {
  if ($line -match '^\s*([A-Z_]+)=(.*)$') { $settings[$matches[1]] = $matches[2].Trim().Trim('"', "'") }
}
$token = $settings['TELEGRAM_BOT_TOKEN']
if (-not $token -or $token -like 'replace_*' -or $token -like 'your_*') { throw 'TELEGRAM_BOT_TOKEN is missing from .env.' }
$secret = $settings['TELEGRAM_WEBHOOK_SECRET']
if (-not $secret) {
  $bytes = New-Object byte[] 32
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
  $secret = [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
  [IO.File]::AppendAllText($envFile, "`nTELEGRAM_WEBHOOK_SECRET=$secret`n")
}
if ($secret -notmatch '^[A-Za-z0-9_-]{1,256}$') { throw 'TELEGRAM_WEBHOOK_SECRET contains unsupported characters.' }

Push-Location $repo
try {
  & $wrangler d1 migrations apply telebudget-db --remote --config cloudflare/worker/wrangler.jsonc
  if ($LASTEXITCODE -ne 0) { throw 'D1 migration failed.' }
  & $wrangler deploy --config cloudflare/worker/wrangler.jsonc
  if ($LASTEXITCODE -ne 0) { throw 'Queue consumer deployment failed.' }
  $token | & $wrangler secret put TELEGRAM_BOT_TOKEN --config cloudflare/worker/wrangler.jsonc
  if ($LASTEXITCODE -ne 0) { throw 'Could not set Worker bot token.' }
  $secret | & $wrangler secret put TELEGRAM_WEBHOOK_SECRET --config cloudflare/worker/wrangler.jsonc
  if ($LASTEXITCODE -ne 0) { throw 'Could not set Worker webhook secret.' }
  $secret | & $wrangler pages secret put TELEGRAM_WEBHOOK_SECRET --project-name telebudget
  if ($LASTEXITCODE -ne 0) { throw 'Could not set Pages webhook secret.' }
  & $wrangler pages deploy public --cwd cloudflare/pages --project-name telebudget --branch main
  if ($LASTEXITCODE -ne 0) { throw 'Pages deployment failed.' }

  $health = Invoke-RestMethod -Uri 'https://telebudget.pages.dev/api/health' -Method Get
  if ($health.status -ne 'ok') { throw 'Pages health check failed.' }
  if (-not $SkipWebhook) {
    try { $response = Invoke-RestMethod -Uri 'https://telebudget-consumer.bryanyyjie.workers.dev/internal/webhook/setup' -Method Post -Headers @{ 'X-TeleBudget-Admin' = $secret } }
    catch {
      $details = $null
      try { $details = $_.ErrorDetails.Message | ConvertFrom-Json } catch {}
      if ($details.method -eq 'getMe' -and $details.upstream_status -eq 401) {
        throw 'Telegram rejected TELEGRAM_BOT_TOKEN (HTTP 401). Replace the token in .env with the current BotFather token.'
      }
      throw 'Telegram webhook registration failed.'
    }
    if (-not $response.ok) { throw 'Telegram rejected webhook registration.' }
  }
  Write-Output 'TeleBudget Cloudflare deployment is ready at https://telebudget.pages.dev/'
} finally {
  Pop-Location
}
