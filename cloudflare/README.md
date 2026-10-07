# Cloudflare backend

The live backend uses Pages Functions (`pages/functions`), a Queue consumer Worker (`worker/index.js`), D1, and Workers AI. Receipt bytes are sent to Workers AI in memory and discarded; no receipt images are stored.

Workers AI uses `@cf/google/gemma-4-26b-a4b-it` for both short expense messages and receipt photos. It supports vision on the Workers Free plan, so one model handles both inputs. Cloudflare's free Workers AI allowance is 10,000 Neurons per day; requests fail after the allowance is exhausted until the daily reset. See [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) and [Gemma 4 model details](https://developers.cloudflare.com/ai/models/%40cf/google/gemma-4-26b-a4b-it/).

The Cloudflare account already has the `telebudget` Pages project, `telebudget-db` D1 database, and `telebudget-updates` Queue. If recreating the project in another account, create those resources and replace the D1 ID in both Wrangler files.

1. Run `npm install` from the repository root.
2. Copy `.env.example` to `.env` and set `TELEGRAM_BOT_TOKEN`. Keep `.env` private.
3. Run `powershell -ExecutionPolicy Bypass -File cloudflare/deploy.ps1` from the repository root. The script applies migrations, deploys Pages and the Worker, sets secrets, checks health, and registers the Telegram webhook.
4. Send `6.50 at macs for breakfast` directly to the bot. `/help` shows a short guide; `/link` connects the Flutter app.

The bot automatically saves entries only when validated confidence is greater than 0.60. If it is lower, the bot asks for confirmation or a corrected message. On Workers AI quota or service failure, it does not save an expense.

For local Pages development, run `npm run cf:pages:dev`. Run `npm run test:cloudflare` on Node 22.12+ for extraction and analytics checks (including real SQLite queries, with no AI or Telegram calls). Wrangler's local AI binding still calls Cloudflare and uses the daily allocation.

## Telegram spending analytics

Send `/stats` for this month to date, `/stats week` for Monday through now,
`/stats lastmonth` for the previous full month, or `/stats 2026-09` for a specific
month. Period buttons make switching easy; tap a category to see its merchants
and largest purchases, then Back to overview to return.

Send `/categories` for a focused category breakdown: every category's amount,
share of that currency's spending, including categories with
zero recorded spending. It supports `/categories week`, `/categories month`,
`/categories lastmonth`, and `/categories YYYY-MM`. Its buttons stay in the
category view; tap a category with spending for detail, then Back to categories.
The overview uses one aggregate query and does not fetch merchants or purchases.

`/help` and `/start` show a short introduction with buttons for recording,
editing, report periods and app pairing.

Reports open with one short page. Next/Back updates that message in place.
Pages are limited to eight text lines and tested below 500 characters. Totals,
averages, category shares, merchants and purchases are available behind buttons.
Each currency has separate pages, without conversion.
Dates use Singapore time. Current periods compare against the matching date and
time in the preceding month/week; completed months compare against the full
preceding month. Only saved expenses count, so unconfirmed
entries are excluded and missing history is not treated as evidence of savings.

Categories use the labels saved with each expense. Tap Edit on its original
saved message to correct a merchant, category or amount; include its original
date when it should stay the same. `/recent` shows three expenses at a time,
with Older/Newer buttons.
See [the design and calculation rules](ANALYTICS.md)
for details. Deploy the updated Queue consumer to enable this feature in the live
bot. Apply migrations before deploying the Worker.

## Food and meal breakdowns

Food expenses store Breakfast, Lunch, Dinner, Snacks & Drinks, or Other food.
For example, `10.50 at subway for lunch` records Lunch. Explicit meal words take
precedence over coffee/snack words. Message time is never used to guess a meal;
unspecified food and older records appear as Other food. The Meal button on a
new saved food expense changes its label without changing its amount or date.
Older records can be corrected through Edit on their saved messages.

Tap Food & Dining in `/stats` or `/categories` for the meal totals. Each amount
counts in exactly one meal group, within its own currency and selected period.
Use one expense per message; combined costs are never fabricated.

Migration `0003_meal_types.sql` adds a nullable column without changing existing
amounts. Deploy it before the Worker. Rolling back the Worker leaves the column
and saved expenses intact.
