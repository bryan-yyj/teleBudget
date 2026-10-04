import { CATEGORIES } from './core.js';

const DAY = 86400000;
const SGT = 8 * 3600000;
export const STATS_USAGE = 'Use /stats (this month), /stats week, /stats month, /stats lastmonth, or /stats YYYY-MM, for example /stats 2026-09. Future months are not available.';

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
  const match = data.match(/^stats:(week|\d{4}-\d{2})(?::([0-7]))?$/);
  if (!match) return null;
  const period = resolveStatsPeriod(match[1], now);
  return period ? { period, category: match[2] === undefined ? null : CATEGORIES[Number(match[2])] } : null;
}

// Bound by user + UTC dates, so D1 can use idx_transactions_user_date.
const FILTER = 'user_id=? AND transaction_date>=? AND transaction_date<?';
const CENTS = 'CAST(ROUND(amount * 100) AS INTEGER)';
const CATEGORY = `CASE WHEN category IN (${CATEGORIES.map(() => '?').join(',')}) THEN category ELSE 'Others' END`;

export async function loadStats(db, userId, period, category = null) {
  const periods = [period.current, period.previous];
  const totals = periods.map((window, index) => db.prepare(`SELECT ${index} AS period, currency,
    COUNT(*) AS count, SUM(${CENTS}) AS total,
    COUNT(DISTINCT date(transaction_date, '+8 hours')) AS active_days
    FROM transactions WHERE ${FILTER} GROUP BY currency`).bind(userId, window.start, window.end));
  const categories = periods.map((window, index) => db.prepare(`SELECT ${index} AS period, currency,
    ${CATEGORY} AS label, COUNT(*) AS count, SUM(${CENTS}) AS total,
    COUNT(DISTINCT date(transaction_date, '+8 hours')) AS active_days
    FROM transactions WHERE ${FILTER} GROUP BY currency, label ORDER BY currency, total DESC, label`)
    .bind(...CATEGORIES, userId, window.start, window.end));
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
  const results = await db.batch([...totals, ...categories, groups('merchant', 5), groups('payment_method', 3), purchases]);
  return { totals: results.slice(0, 2).flatMap(result => result.results),
    categories: results.slice(2, 4).flatMap(result => result.results),
    merchants: results[4].results, payments: results[5].results, purchases: results[6].results };
}

const money = (currency, cents) => `${currency} ${(cents / 100).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const share = (part, total) => total > 0 ? `${(part / total * 100).toFixed(1)}%` : '0.0%';
const expenses = count => `${count} ${count === 1 ? 'expense' : 'expenses'}`;
// Plain text with one physical line per label; preserve literal punctuation safely.
const label = (value, max = 64) => {
  const clean = String(value || '').replace(/[\s\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]+/g, ' ').trim();
  return [...clean].length > max ? [...clean].slice(0, max - 1).join('') + '…' : clean;
};

function comparison(currency, current, previous) {
  if (!previous?.count) return ['No expenses recorded in the comparison period; not enough history for a percentage change.'];
  const delta = (current?.total || 0) - previous.total;
  const change = delta === 0 ? 'unchanged' : `${delta > 0 ? 'up' : 'down'} ${money(currency, Math.abs(delta))} (${share(Math.abs(delta), previous.total)})`;
  return [`Previous recorded total: ${money(currency, previous.total)} · ${expenses(previous.count)}`,
    `Recorded spending ${change}.`];
}

function categoryChanges(data, currency) {
  const rows = data.categories.filter(row => row.currency === currency);
  const changes = new Map();
  for (const row of rows) changes.set(row.label, (changes.get(row.label) || 0) + (row.period === 0 ? row.total : -row.total));
  const sorted = [...changes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const lines = [];
  if (sorted[0]?.[1] > 0) lines.push(`Largest category increase: ${sorted[0][0]} +${money(currency, sorted[0][1])}`);
  const last = sorted.at(-1);
  if (last?.[1] < 0) lines.push(`Largest category decrease: ${last[0]} -${money(currency, -last[1])}`);
  return lines;
}

function groupLines(rows, currency, total, count, unknownLabel, remainderLabel) {
  let includedTotal = 0;
  let includedCount = 0;
  const lines = rows.filter(row => row.currency === currency).map(row => {
    includedTotal += row.total;
    includedCount += row.count;
    return `${row.unknown ? unknownLabel : label(row.label)}: ${money(currency, row.total)} · ${share(row.total, total)} · ${expenses(row.count)}`;
  });
  if (count > includedCount) lines.push(`${remainderLabel}: ${money(currency, total - includedTotal)} · ${share(total - includedTotal, total)} · ${expenses(count - includedCount)}`);
  return lines;
}

export function formatStats(data, period, category = null) {
  const header = [`Spending stats · ${period.title}${category ? ` · ${category}` : ''}`,
    `Period (SGT): ${period.current.label}`,
    ...(period.partial ? [`As of ${new Date(Date.parse(period.asOf) + SGT).toISOString().slice(0, 16).replace('T', ' ')} SGT; today is partial.`] : []),
    `Compare with (SGT): ${period.previous.label}`];
  if (period.partial) header.push(period.key === 'week'
    ? 'Comparison covers the same weekdays and local time last week.'
    : 'Comparison stops at the matching local time, capped at the previous month’s end.');
  if (period.current.days !== period.previous.days) header.push('Calendar lengths differ; the totals cover different numbers of days.');
  const source = category ? data.categories.filter(row => row.label === category) : data.totals;
  const currencies = [...new Set(source.map(row => row.currency))].sort((a, b) => a === b ? 0 : a === 'SGD' ? -1 : b === 'SGD' ? 1 : a.localeCompare(b));
  const reports = [];
  const footer = 'Recorded expenses only; unconfirmed entries excluded. Currencies are separate, with no conversion. Categories follow saved labels; use /recent → Edit to correct an entry.';
  if (!currencies.length) reports.push([...header, '', `No ${category ? `${category} ` : ''}expenses recorded in this period or its comparison period.`,
    'Send an expense such as “6.50 at macs”, or choose another period.', '', footer].join('\n'));
  for (const currency of currencies) {
    const current = source.find(row => row.currency === currency && row.period === 0);
    const previous = source.find(row => row.currency === currency && row.period === 1);
    const total = current?.total || 0;
    const count = current?.count || 0;
    const lines = [...header, '', `${currency}${category ? ` · ${category}` : ''}`,
      `Recorded total: ${money(currency, total)} · ${expenses(count)}`];
    if (count) {
      lines.push(`Average expense: ${money(currency, total / count)}`,
        `Recorded spend/calendar day: ${money(currency, total / period.current.days)}`,
        `Days with entries: ${current.active_days} of ${period.current.days}`);
      if (category) {
        const overall = data.totals.find(row => row.currency === currency && row.period === 0);
        lines.push(`Share of all ${currency} spending: ${share(total, overall?.total || 0)}`);
      }
    } else lines.push('No expenses recorded for this selection.');
    lines.push('', 'Period comparison', ...comparison(currency, current, previous));
    if (previous?.count) lines.push(`Previous recorded spend/calendar day: ${money(currency, previous.total / period.previous.days)}`);
    if (!category && previous?.count) lines.push(...categoryChanges(data, currency));
    if (count) {
      if (!category) lines.push('', 'Where the money went', ...data.categories
        .filter(row => row.currency === currency && row.period === 0)
        .map(row => `${row.label}: ${money(currency, row.total)} · ${share(row.total, total)} · ${expenses(row.count)}`));
      lines.push('', 'Top merchants · by recorded spend', ...groupLines(data.merchants, currency, total, count, 'Merchant not recorded', 'Other merchants'));
      lines.push('', 'Largest purchases · up to 3');
      for (const row of data.purchases.filter(row => row.currency === currency)) {
        const merchant = label(row.merchant) || 'Merchant not recorded';
        const description = label(row.description, 90);
        lines.push(`#${row.id} · ${row.date} · ${money(currency, row.total)} · ${merchant}`);
        lines.push(`  ${row.category}${description && description !== merchant ? ` · ${description}` : ''}`);
      }
      lines.push('', 'Payment methods · top 3 recorded labels', ...groupLines(data.payments, currency, total, count, 'Payment method not recorded', 'Other payment methods'));
    }
    lines.push('', footer, '', category ? 'Tap Back to overview to see all categories.' : 'Tap a category below for its merchants and purchases.');
    reports.push(lines.join('\n'));
  }
  return reports.flatMap(report => splitStatsMessage(report));
}

// UTF-16 length is a conservative bound for Telegram; never split a surrogate pair.
export function splitStatsMessage(text, limit = 3900) {
  const chunks = [];
  let chunk = '';
  for (const line of text.split('\n')) {
    if (chunk && chunk.length + line.length + 1 > limit) { chunks.push(chunk); chunk = ''; }
    if (line.length > limit) {
      let part = '';
      for (const char of line) {
        if (part.length + char.length > limit) { chunks.push(part); part = ''; }
        part += char;
      }
      chunk = part;
    } else chunk += (chunk ? '\n' : '') + line;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

export function statsKeyboard(period, data, category = null, now = new Date()) {
  const rows = [[
    { text: 'This month', callback_data: `stats:${resolveStatsPeriod('month', now).key}` },
    { text: 'This week', callback_data: 'stats:week' },
    { text: 'Last month', callback_data: `stats:${resolveStatsPeriod('lastmonth', now).key}` }
  ]];
  if (category) rows.push([{ text: 'Back to overview', callback_data: `stats:${period.key}` }]);
  else {
    const present = new Set(data.categories.map(row => row.label));
    const buttons = CATEGORIES.filter(name => present.has(name)).map(name => ({ text: name,
      callback_data: `stats:${period.key}:${CATEGORIES.indexOf(name)}` }));
    for (let index = 0; index < buttons.length; index += 2) rows.push(buttons.slice(index, index + 2));
  }
  return { inline_keyboard: rows };
}
