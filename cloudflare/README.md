# Cloudflare backend

The live backend uses Pages Functions (`pages/functions`), a Queue consumer Worker (`worker/index.js`), D1, and Workers AI. Receipt bytes are sent to Workers AI in memory and discarded; no receipt images are stored.

Workers AI uses `@cf/google/gemma-4-26b-a4b-it` for both short expense messages and receipt photos. It supports vision on the Workers Free plan, so one model handles both inputs. Cloudflare's free Workers AI allowance is 10,000 Neurons per day; requests fail after the allowance is exhausted until the daily reset. See [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) and [Gemma 4 model details](https://developers.cloudflare.com/ai/models/%40cf/google/gemma-4-26b-a4b-it/).

The Cloudflare account already has the `telebudget` Pages project, `telebudget-db` D1 database, and `telebudget-updates` Queue. If recreating the project in another account, create those resources and replace the D1 ID in both Wrangler files.

1. Run `npm install` from the repository root.
2. Copy `.env.example` to `.env` and set `TELEGRAM_BOT_TOKEN`. Keep `.env` private.
3. Run `powershell -ExecutionPolicy Bypass -File cloudflare/deploy.ps1` from the repository root. The script applies migrations, deploys Pages and the Worker, sets secrets, checks health, and registers the Telegram webhook.
4. Send `/start` to the bot, then `6.50 at macs`. Send `/link` to connect the Flutter app.

The bot automatically saves entries only when validated confidence is greater than 0.60. If it is lower, the bot asks for confirmation or a corrected message. On Workers AI quota or service failure, it does not save an expense.

For local Pages development, run `npm run cf:pages:dev`. Run `npm run test:cloudflare` on Node 22.12+ for extraction and analytics checks (including real SQLite queries, with no AI or Telegram calls). Wrangler's local AI binding still calls Cloudflare and uses the daily allocation.

## Telegram spending analytics

Send `/stats` for this month to date, `/stats week` for Monday through now,
`/stats lastmonth` for the previous full month, or `/stats 2026-09` for a specific
month. Period buttons make switching easy; tap a category to see its merchants
and largest purchases, then Back to overview to return.

Send `/categories` for a focused category breakdown: every category's amount,
share of that currency's spending, and expense count, including categories with
zero recorded spending. It supports `/categories week`, `/categories month`,
`/categories lastmonth`, and `/categories YYYY-MM`. Its buttons stay in the
category view; tap a category with spending for detail, then Back to categories.
The overview uses one aggregate query and does not fetch merchants or purchases.

`/help` and `/start` provide a full guide to recording text expenses and receipts,
confirmation, cancellation, editing, undo, report periods, and app pairing.

Reports include totals, expense counts, average expense, recorded spending per
calendar day, category amounts and shares, top merchants, largest purchases,
and payment method totals. Each currency has its own report, without conversion.
Dates use Singapore time. Current periods compare against the matching date and
time in the preceding month/week; completed months compare against the full
preceding month. Both ranges are shown. Only saved expenses count, so unconfirmed
entries are excluded and missing history is not treated as evidence of savings.

Categories use the labels saved with each expense. Tap Edit on its original
saved message to correct a merchant, category or amount; include its original
date when it should stay the same. `/recent` lists the latest 10 expenses.
See [the design and calculation rules](ANALYTICS.md)
for details. Deploy the updated Queue consumer to enable this feature in the live
bot; no database migration is needed.
