# Telegram spending analytics

## Compact chat update

Reports now open one page at a time (up to eight text lines / 500 characters),
with Next/Back editing the same message. Help is split into button-selected topics;
recent expenses show three entries per page. Category overviews show four categories
per page. The older detailed report layout described below has been replaced.

Food reports add Breakfast, Lunch, Dinner, Snacks & Drinks and Other food totals.
Explicit meal words identify the group; unknown meals and legacy rows are Other food.
Use the Meal button on a newly saved food expense to correct it. Receipt captions
can supply the meal. Message time never supplies a guessed meal type. Meal totals
use integer hundredths and the same user, currency and SGT period filters as stats.

Apply additive migration `0003_meal_types.sql` before deploying this update.

## Scope and architecture

The live path is Telegram -> Pages `/api/telegram` -> Queue -> `worker/index.js` -> D1.
`shared/core.js` validates AI extraction, and the Worker saves, edits, confirms and
deletes transactions. Flutter reads the same D1 transactions through the paired
app API. `src/` is the legacy Express/Ollama backend and is outside this change.

Replace the live SGD-only monthly count/total with deterministic analytics over
saved transactions. Keep extraction, confirmation, editing, undo and pairing
unchanged. Do not infer receipt itemization, budgets, income, recurring payments,
exchange rates, savings or forecasts: the current data cannot support them.

## User experience

- `/stats` or `/stats month`: this month to date.
- `/stats week`: Monday through now.
- `/stats lastmonth`: the completed previous calendar month.
- `/stats YYYY-MM`: a completed month, or month to date for the current month.
- `/categories` accepts the same period arguments and shows all eight categories
  with amounts, shares and counts, including zero-spending categories. Currency
  totals come from the category aggregates. Empty reports show zero entries in
  the bot's default SGD currency. The overview needs one aggregate query.
- Category-view period and detail buttons retain that view, with Back to categories
  returning to the selected period. `/help` and `/start` explain expense examples,
  receipts, confirmation, edits, undo, reports and app linking.
- Inline buttons select periods and drill into a saved category. A category
  report shows its share of all spending in each currency, merchants, payment
  methods and largest purchases. Back returns to that period's overview.
- Reports show totals, expense counts, average expense, recorded spend per
  elapsed calendar day, and days with entries. Overview lists every category
  with amount, percentage and count; top five known merchants; top three
  purchases with dates, IDs and descriptions; and payment method totals.
- Unknown merchants/payment methods are explicitly accounted for. Lists that
  show only the top entries include a remainder. Currency reports stay separate.
- Invalid or future periods show usage. Empty periods say no expenses were
  recorded; a prior baseline may still be shown. Categories use saved labels,
  which users can correct using Edit on the original saved expense message.
  `/recent` lists the latest 10 expenses, ordered by expense date.

## Meaning and calculation rules

- All calendar boundaries and displayed dates use Singapore time (UTC+08:00).
  Use expense dates, not receipt upload/creation dates. Future-dated entries and
  unconfirmed pending entries do not count.
- Sum amounts as integer hundredths, consistent with extraction's two-decimal
  rounding. Never add different currencies or assume conversion rates.
- Average expense = period total / saved expense count. Daily average = total /
  calendar days in the selected range, including days without recorded expenses.
  The current day is partial and is labelled with an as-of time.
- Category percentages = category total / that currency's overall period total.
  Merchant/payment percentages = group total / the selected view's total.
  Rounded shares can differ slightly from 100%.
- Group known merchant and payment labels ignoring case and outer whitespace.
  Do not guess aliases or merge distinct merchants using AI.
- Compare weeks against the same weekdays and time one week earlier. Compare
  month to date against the same day and local time in the prior month, capped
  at that month's end. Completed months compare with the full preceding month.
  Display both ranges and their day counts, especially for unequal month lengths.
- Change = current recorded total minus prior recorded total, per currency.
  Percentage change requires a positive prior total. Missing prior entries mean
  insufficient recorded history, not zero real spending or proof of savings.
  Category changes identify the largest increase and decrease only when there
  is a recorded prior baseline. Include prior-only categories/currencies.

## Implementation and proof

`shared/analytics.js` owns period validation, prepared read-only aggregation,
formatting and callback keyboards. D1 batches the overview/category totals,
bounded merchant and payment groups, and purchases in one consistent read batch.
Queries use the existing `(user_id, transaction_date)` index with UTC ISO bounds;
SQL aggregates all matching expenses, rather than the API's paginated recent list.
Only top groups/purchases are returned to the Worker. Reports are plain text;
user-provided names cannot introduce Telegram formatting. Split long reports at
line boundaries under Telegram's message limit and attach navigation once.

Acceptance checks use the actual SQL against SQLite plus the queued Worker with
mock Telegram responses: exact amounts and shares; SGT rollover; leap years and
short months; matching partial cutoffs; mixed and prior-only currencies; unknown
labels; empty/one-expense periods; user isolation; pending/edit/undo effects;
invalid commands/callbacks; bounded output; and no AI call for stats.

Run `npm run test:cloudflare` (Node 22.12+ with experimental SQLite enabled).
The SQLite adapter is test-only; production continues using the D1 binding.
Deploy the Queue consumer through the existing Cloudflare deployment workflow
to enable the commands in the live chat. No migration is required.
