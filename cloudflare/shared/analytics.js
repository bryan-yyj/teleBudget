import { CATEGORIES } from './core.js';

const DAY = 86400000;
const SGT = 8 * 3600000;
export const STATS_USAGE = 'Use /stats (this month), /stats week, /stats month, /stats lastmonth, or /stats YYYY-MM, for example /stats 2026-09. Future months are not available.';
export const CATEGORIES_USAGE = STATS_USAGE.replaceAll('/stats', '/categories');

const monthKey = local => new Date(local).toISOString().slice(0, 7);
const utc = local => new Date(local - SGT).toISOString();
const localDate = local => new Date(local).toISOString().slice(0, 10);
const monthStart = (year, month) => Date.UTC(year, month, 1);

function range(start, end, days, partial) {
  return { start: utc(start), end: utc(end), days,
    label: `${localDate(start)} to ${localDate(partial ? end : end - 1)} (${days} calendar ${days === 1 ? 'day' : 'days'})` };
}

// Shift into a UTC calendar representing SGT; never depend on the host timezone.
export function resolveStatsPeriod(input = 'month', now = new Date()) {
  const localNow = now.getTime() + SGT;
  const date = new Date(localNow);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const today = Date.UTC(year, month, day);
  const time = localNow - today;
  const value = input.trim().toLowerCase() || 'month';
  if (value === 'week') {
    const days = (date.getUTCDay() + 6) % 7 + 1;
    const start = today - (days - 1) * DAY;
    return { key: 'week', title: 'This week to date', partial: true, asOf: utc(localNow),
      current: range(start, localNow, days, true),
      previous: range(start - 7 * DAY, localNow - 7 * DAY, days, true) };
  }
  let start;
  if (value === 'month') start = monthStart(year, month);
  else if (value === 'lastmonth') start = monthStart(year, month - 1);
  else if (/^(?:[2-9]\d{3})-(?:0[1-9]|1[0-2])$/.test(value)) {
    const [selectedYear, selectedMonth] = value.split('-').map(Number);
    start = monthStart(selectedYear, selectedMonth - 1);
  } else return null;
  if (start > localNow) return null;
  const selected = new Date(start);
  const next = monthStart(selected.getUTCFullYear(), selected.getUTCMonth() + 1);
  const previousStart = monthStart(selected.getUTCFullYear(), selected.getUTCMonth() - 1);
  const partial = start === monthStart(year, month);
  const previousDays = Math.round((start - previousStart) / DAY);
  const days = partial ? day : Math.round((next - start) / DAY);
  const previousEnd = partial ? Math.min(start, previousStart + (day - 1) * DAY + time) : start;
  return { key: monthKey(start), title: partial ? 'This month to date' : monthKey(start),
    partial, asOf: utc(localNow),
    current: range(start, partial ? localNow : next, days, partial),
    previous: range(previousStart, previousEnd, partial ? Math.min(days, previousDays) : previousDays,
      partial && previousEnd < start) };
}

export function parseStatsCallback(data, now = new Date()) {
  const match = data.match(/^(stats|categories):(week|\d{4}-\d{2})(?::([0-7]))?(?::p(\d{1,3}))?$/);
  if (!match) return null;
  const period = resolveStatsPeriod(match[2], now);
  return period ? { view: match[1], period, category: match[3] === undefined ? null : CATEGORIES[Number(match[3])], page: Number(match[4] || 0) } : null;
}

// Bound by user + UTC dates, so D1 can use idx_transactions_user_date.
const FILTER = 'user_id=? AND transaction_date>=? AND transaction_date<?';
const CENTS = 'CAST(ROUND(amount * 100) AS INTEGER)';
const CATEGORY = `CASE WHEN category IN (${CATEGORIES.map(() => '?').join(',')}) THEN category ELSE 'Others' END`;

function categoryStatement(db, userId, window, index = 0) {
  return db.prepare(`SELECT ${index} AS period, currency,
    ${CATEGORY} AS label, COUNT(*) AS count, SUM(${CENTS}) AS total,
    COUNT(DISTINCT date(transaction_date, '+8 hours')) AS active_days
    FROM transactions WHERE ${FILTER} GROUP BY currency, label ORDER BY currency, total DESC, label`)
    .bind(...CATEGORIES, userId, window.start, window.end);
}

export async function loadCategories(db, userId, period) {
  const { results } = await categoryStatement(db, userId, period.current).all();
  return { categories: results };
}

function mealStatement(db, userId, window) {
  return db.prepare(`SELECT currency, COALESCE(meal_type, 'Other food') AS label,
    COUNT(*) AS count, SUM(${CENTS}) AS total FROM transactions
    WHERE ${FILTER} AND category='Food & Dining'
    GROUP BY currency, label ORDER BY currency, label`).bind(userId, window.start, window.end);
}

export async function loadStats(db, userId, period, category = null) {
  const periods = [period.current, period.previous];
  const totals = periods.map((window, index) => db.prepare(`SELECT ${index} AS period, currency,
    COUNT(*) AS count, SUM(${CENTS}) AS total,
    COUNT(DISTINCT date(transaction_date, '+8 hours')) AS active_days
    FROM transactions WHERE ${FILTER} GROUP BY currency`).bind(userId, window.start, window.end));
  const categories = periods.map((window, index) => categoryStatement(db, userId, window, index));
  const selectedFilter = `${FILTER}${category ? ` AND ${CATEGORY}=?` : ''}`;
  const args = [userId, period.current.start, period.current.end, ...(category ? [...CATEGORIES, category] : [])];
  function groups(field, limit) {
    // Unknown labels are kept separate from real merchants named "Unknown".
    return db.prepare(`WITH grouped AS (
      SELECT currency, MIN(TRIM(${field})) AS label,
        CASE WHEN NULLIF(TRIM(${field}), '') IS NULL THEN 1 ELSE 0 END AS unknown,
        COUNT(*) AS count, SUM(${CENTS}) AS total
      FROM transactions WHERE ${selectedFilter}
      GROUP BY currency, COALESCE(NULLIF(LOWER(TRIM(${field})), ''), ''), unknown
    ), ranked AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY currency, unknown ORDER BY total DESC, label) AS rank
      FROM grouped
    ) SELECT * FROM ranked WHERE unknown=1 OR rank<=${limit} ORDER BY currency, unknown, rank`).bind(...args);
  }
  const purchases = db.prepare(`WITH ranked AS (
    SELECT id, currency, ${CENTS} AS total, merchant, description, ${CATEGORY} AS category,
      date(transaction_date, '+8 hours') AS date,
      ROW_NUMBER() OVER (PARTITION BY currency ORDER BY amount DESC, transaction_date DESC, id DESC) AS rank
    FROM transactions WHERE ${selectedFilter}
  ) SELECT * FROM ranked WHERE rank<=3 ORDER BY currency, rank`).bind(...CATEGORIES, ...args);
  const results = await db.batch([...totals, ...categories, groups('merchant', 5), groups('payment_method', 3), purchases,
    mealStatement(db, userId, period.current)]);
  return { totals: results.slice(0, 2).flatMap(result => result.results),
    categories: results.slice(2, 4).flatMap(result => result.results),
    merchants: results[4].results, payments: results[5].results, purchases: results[6].results, meals: results[7].results };
}

export { formatStats, formatCategories, statsKeyboard } from './reports.js';
