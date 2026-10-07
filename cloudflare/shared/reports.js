import { CATEGORIES } from './core.js';
import { MEALS } from './meals.js';

export const shortLabel = (value, max = 24) => {
  const chars = [...String(value || '').replace(/[\s\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]+/g, ' ').trim()];
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : chars.join('');
};
const money = (currency, cents) => `${currency} ${(cents / 100).toFixed(2)}`;
const share = (part, total) => `${(total ? part / total * 100 : 0).toFixed(1)}%`;
const expenses = count => `${count} ${count === 1 ? 'expense' : 'expenses'}`;
const currenciesOf = rows => [...new Set(rows.map(row => row.currency))].sort((a, b) => a === b ? 0 : a === 'SGD' ? -1 : b === 'SGD' ? 1 : a.localeCompare(b));
const header = (title, period, currency) => `${title} · ${currency}\n${period.key}${period.partial ? ' to date' : ''} · SGT`;
const sgtDate = value => new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(0, 10);
const dates = window => `${sgtDate(window.start)} – ${sgtDate(new Date(Math.max(Date.parse(window.start), Date.parse(window.end) - 1)).toISOString())}`;
const page = (title, period, currency, lines) => [header(title, period, currency), ...lines].join('\n');

// Each page has at most four data rows. Navigation edits one message in place.
function listPages(title, period, currency, lines) {
  const pages = [];
  for (let i = 0; i < lines.length; i += 4) pages.push(page(title, period, currency, lines.slice(i, i + 4)));
  return pages;
}

export function formatCategories(data, period) {
  const currencies = currenciesOf(data.categories);
  if (!currencies.length) currencies.push('SGD');
  return currencies.flatMap(currency => {
    const recorded = data.categories.filter(row => row.currency === currency && row.period === 0);
    const total = recorded.reduce((sum, row) => sum + row.total, 0);
    const rows = CATEGORIES.map(name => recorded.find(row => row.label === name) || { label: name, total: 0, count: 0 });
    return [0, 4].map(offset => page('Categories', period, currency, [
      `Total ${money(currency, total)}${recorded.length ? '' : ' · no expenses'}`,
      ...rows.slice(offset, offset + 4).map(row => `${row.label}: ${(row.total / 100).toFixed(2)} · ${share(row.total, total)}`),
      'Tap a category for details.'
    ]));
  });
}

export function formatStats(data, period, category = null) {
  const source = category ? data.categories.filter(row => row.label === category) : data.totals;
  const currencies = currenciesOf(source);
  if (!currencies.length) return [page(category || 'Spending stats', period, 'SGD', ['No expenses recorded.', 'Try another period.'])];
  return currencies.flatMap(currency => {
    const current = source.find(row => row.currency === currency && row.period === 0);
    const previous = source.find(row => row.currency === currency && row.period === 1);
    const total = current?.total || 0;
    const count = current?.count || 0;
    const summary = [`${money(currency, total)} · ${expenses(count)}`];
    if (count) summary.push(`Avg ${money(currency, total / count)}`, `Per day ${money(currency, total / period.current.days)}`);
    if (previous?.count) {
      const delta = total - previous.total;
      summary.push(`${delta < 0 ? 'Down' : delta > 0 ? 'Up' : 'Unchanged'} ${money(currency, Math.abs(delta))} (${share(Math.abs(delta), previous.total)})`);
      summary.push(`vs ${sgtDate(period.previous.start)} (${period.previous.days} days)*`);
    } else summary.push('No prior recorded history.');
    const result = [page(category || 'Spending stats', period, currency, summary)];
    if (!category || category === 'Food & Dining') {
      const meals = (data.meals || []).filter(row => row.currency === currency);
      if (meals.length || category) {
        const foodTotal = meals.reduce((sum, row) => sum + row.total, 0);
        const mealPage = page('Food breakdown', period, currency, [
          `Food total ${money(currency, foodTotal)}`,
          ...MEALS.map(name => `${name}: ${money(currency, meals.find(row => row.label === name)?.total || 0)}`)
        ]);
        if (category) result.unshift(mealPage); else result.push(mealPage);
      }
    }
    if (category && count) {
      const overall = data.totals.find(row => row.currency === currency && row.period === 0)?.total || 0;
      result.push(page('Category share', period, currency, [category, `${money(currency, total)} · ${share(total, overall)} of spending`]));
    }
    if (!category && count) result.push(...formatCategories({ categories: data.categories.filter(row => row.currency === currency && row.period === 0) }, period));
    for (const [key, title, unknown, remainder] of [
      ['merchants', 'Top merchants', 'Not recorded', 'Other merchants'],
      ['payments', 'Payment methods', 'Not recorded', 'Other methods']
    ]) {
      const rows = data[key].filter(row => row.currency === currency);
      const lines = rows.map(row => `${row.unknown ? unknown : shortLabel(row.label)}: ${money(currency, row.total)}`);
      const included = rows.reduce((sum, row) => sum + row.total, 0);
      if (included < total) lines.push(`${remainder}: ${money(currency, total - included)}`);
      result.push(...listPages(title, period, currency, lines));
    }
    const purchases = data.purchases.filter(row => row.currency === currency);
    if (purchases.length) result.push(page('Largest purchases', period, currency,
      purchases.map(row => `#${row.id} ${shortLabel(row.merchant || row.description, 18)}: ${money(currency, row.total)}`)));
    if (previous?.count) result.push(page('Comparison', period, currency, [
      `Current: ${money(currency, total)} / ${period.current.days} days`,
      dates(period.current),
      `Previous: ${money(currency, previous.total)} / ${period.previous.days} days`,
      dates(period.previous),
      '*Matching elapsed dates for partial periods.', 'Recorded expenses only; currencies separate.'
    ]));
    return result;
  });
}

export function statsKeyboard(period, data, category = null, now = new Date(), view = 'stats', pageIndex = 0, pageCount = 1) {
  const local = new Date(now.getTime() + 8 * 3600000);
  const thisMonth = local.toISOString().slice(0, 7);
  const lastMonth = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  const base = `${view}:${period.key}${category ? `:${CATEGORIES.indexOf(category)}` : ''}`;
  const rows = [[
    { text: 'Month', callback_data: `${view}:${thisMonth}` },
    { text: 'Week', callback_data: `${view}:week` },
    { text: 'Last month', callback_data: `${view}:${lastMonth}` }
  ]];
  const nav = [];
  if (pageIndex > 0) nav.push({ text: '‹ Back', callback_data: `${base}:p${pageIndex - 1}` });
  if (pageCount > 1) nav.push({ text: `${pageIndex + 1}/${pageCount}`, callback_data: 'noop' });
  if (pageIndex + 1 < pageCount) nav.push({ text: 'Next ›', callback_data: `${base}:p${pageIndex + 1}` });
  if (nav.length) rows.push(nav);
  if (category) rows.push([{ text: view === 'categories' ? 'Back to categories' : 'Back to overview', callback_data: `${view}:${period.key}` }]);
  else if (view === 'categories') {
    const names = CATEGORIES.slice((pageIndex % 2) * 4, (pageIndex % 2) * 4 + 4);
    for (let i = 0; i < names.length; i += 2) rows.push(names.slice(i, i + 2).map(name => ({text: name, callback_data: `${view}:${period.key}:${CATEGORIES.indexOf(name)}`})));
  } else rows.push([
    { text: 'Food & Dining', callback_data: `stats:${period.key}:0` },
    { text: 'Categories', callback_data: `categories:${period.key}` }
  ]);
  return { inline_keyboard: rows };
}
