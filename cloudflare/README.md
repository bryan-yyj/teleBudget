# Cloudflare backend

The live backend uses Pages Functions (`pages/functions`), a Queue consumer Worker (`worker/index.js`), D1, and Workers AI. Receipt bytes are sent to Workers AI in memory and discarded; no receipt images are stored.

Workers AI uses `@cf/google/gemma-4-26b-a4b-it` for both short expense messages and receipt photos. It supports vision on the Workers Free plan, so one model handles both inputs. Cloudflare's free Workers AI allowance is 10,000 Neurons per day; requests fail after the allowance is exhausted until the daily reset. See [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) and [Gemma 4 model details](https://developers.cloudflare.com/ai/models/%40cf/google/gemma-4-26b-a4b-it/).

The Cloudflare account already has the `telebudget` Pages project, `telebudget-db` D1 database, and `telebudget-updates` Queue. If recreating the project in another account, create those resources and replace the D1 ID in both Wrangler files.

1. Run `npm install` from the repository root.
2. Copy `.env.example` to `.env` and set `TELEGRAM_BOT_TOKEN`. Keep `.env` private.
3. Run `powershell -ExecutionPolicy Bypass -File cloudflare/deploy.ps1` from the repository root. The script applies migrations, deploys Pages and the Worker, sets secrets, checks health, and registers the Telegram webhook.
4. Send `/start` to the bot, then `6.50 at macs`. Send `/link` to connect the Flutter app.

The bot automatically saves entries only when validated confidence is greater than 0.60. If it is lower, the bot asks for confirmation or a corrected message. On Workers AI quota or service failure, it does not save an expense.

For local Pages development, run `npm run cf:pages:dev`. Run `node --test cloudflare/test/*.test.js` for extraction checks. Wrangler's local AI binding still calls Cloudflare and uses the daily allocation.
