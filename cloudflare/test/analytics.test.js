import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../worker/index.js';
import { CATEGORIES } from '../shared/core.js';
import { resolveStatsPeriod, parseStatsCallback, loadStats, formatStats, statsKeyboard,
  loadCategories, formatCategories, splitStatsMessage, STATS_USAGE, CATEGORIES_USAGE } from '../shared/analytics.js';

const NOW = new Date('2026-10-05T04:00:00.000Z'); // Monday, noon SGT

// Execute production prepared SQL, not a mock of query results. The adapter only
// translates SQLite's return values into the D1 binding interface used by Worker.
class TestDatabase {
  constructor(t) {
    this.sqlite = new DatabaseSync(':memory:');
    t.after(() => this.sqlite.close());
    for (const migration of ['0001_initial.sql', '0002_no_image_storage.sql']) {
      this.sqlite.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), 'utf8'));
    }
    this.sqlite.exec("INSERT INTO users(id,telegram_id) VALUES (1,'101'),(2,'202')");
  }
  prepare(sql) {
    const statement = this.sqlite.prepare(sql);
    let params = [];
    const bound = {
      bind: (...values) => { params = values; return bound; },
      all: async () => ({ results: statement.all(...params) }),
      first: async () => statement.get(...params) || null,
      run: async () => {
        const result = statement.run(...params);
        return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
      }
    };
    return bound;
  }
  async batch(statements) {
    this.sqlite.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.all());
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
}

let sourceId = 0;
function insert(db, overrides = {}) {
  const row = { user_id: 1, amount: 10, currency: 'SGD', merchant: 'Cafe',
    description: 'Lunch', category: 'Food & Dining', transaction_date: '2026-10-01T00:00:00.000Z',
    payment_method: 'Card', source_reference: `test:${++sourceId}`, confidence_score: 0.9, ...overrides };
  const keys = Object.keys(row);
  return Number(db.sqlite.prepare(`INSERT INTO transactions(${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
    .run(...Object.values(row)).lastInsertRowid);
}

function fixture(t) {
  const db = new TestDatabase(t);
  insert(db);
  insert(db, { amount: 20, merchant: ' cafe ', transaction_date: '2026-10-02T00:00:00.000Z' });
  insert(db, { amount: 5, category: 'Transportation', merchant: 'MRT', transaction_date: '2026-10-03T00:00:00.000Z' });
  insert(db, { amount: 100, category: 'Shopping', merchant: 'Store', transaction_date: '2026-10-04T00:00:00.000Z' });
  insert(db, { amount: 6, category: 'Others', merchant: null, payment_method: null, transaction_date: '2026-10-05T00:00:00.000Z' });
  insert(db, { amount: 2, merchant: '', payment_method: ' ', transaction_date: '2026-10-05T00:01:00.000Z' });
  insert(db, { amount: 40, transaction_date: '2026-09-01T00:00:00.000Z' });
  insert(db, { amount: 10, category: 'Transportation', transaction_date: '2026-09-04T00:00:00.000Z' });
  insert(db, { amount: 50, currency: 'USD' });
  insert(db, { amount: 20, currency: 'USD', transaction_date: '2026-09-01T00:00:00.000Z' });
  insert(db, { amount: 9, currency: 'EUR', transaction_date: '2026-09-01T00:00:00.000Z' });
  insert(db, { amount: 99999, user_id: 2 });
  insert(db, { amount: 88888, transaction_date: '2026-10-05T04:00:01.000Z' }); // future, same day
  insert(db, { amount: 77777, transaction_date: '2026-09-05T04:00:01.000Z' }); // beyond matching time
  return db;
}

test('month to date uses SGT boundaries and a matching prior date/time', () => {
  const period = resolveStatsPeriod('month', NOW);
  assert.equal(period.key, '2026-10');
  assert.equal(period.current.start, '2026-09-30T16:00:00.000Z');
  assert.equal(period.current.end, NOW.toISOString());
  assert.equal(period.current.days, 5);
  assert.equal(period.previous.start, '2026-08-31T16:00:00.000Z');
  assert.equal(period.previous.end, '2026-09-05T04:00:00.000Z');
  assert.equal(period.previous.days, 5);
});

test('week starts Monday and compares the same weekdays/time', () => {
  const monday = resolveStatsPeriod('week', NOW);
  assert.equal(monday.current.days, 1);
  assert.equal(monday.current.start, '2026-10-04T16:00:00.000Z');
  assert.equal(monday.previous.end, '2026-09-28T04:00:00.000Z');
  const sunday = resolveStatsPeriod('week', new Date('2026-10-04T15:59:00Z'));
  assert.equal(sunday.current.days, 7);
  assert.equal(sunday.current.start, '2026-09-27T16:00:00.000Z');
});

test('month selection handles year rollover, leap years and unequal lengths', () => {
  const january = resolveStatsPeriod('lastmonth', new Date('2026-01-01T00:00:00Z'));
  assert.equal(january.key, '2025-12');
  assert.equal(january.current.days, 31);
  assert.equal(january.previous.days, 30);
  const leap = resolveStatsPeriod('2024-02', NOW);
  assert.equal(leap.current.days, 29);
  assert.equal(leap.current.end, '2024-02-29T16:00:00.000Z');
  const short = resolveStatsPeriod('month', new Date('2026-03-31T04:00:00Z'));
  assert.equal(short.current.days, 31);
  assert.equal(short.previous.days, 28);
  assert.equal(short.previous.end, '2026-02-28T16:00:00.000Z');
  assert.match(short.previous.label, /2026-02-28 \(28 calendar days\)/);
});

test('UTC evening rollover selects the next SGT day/month', () => {
  const period = resolveStatsPeriod('', new Date('2026-09-30T16:00:00Z'));
  assert.equal(period.key, '2026-10');
  assert.equal(period.current.days, 1);
  assert.equal(period.current.start, period.current.end);
  assert.equal(resolveStatsPeriod('2026-10', NOW).partial, true);
});

test('invalid, extra and future arguments or callbacks are rejected', () => {
  for (const value of ['2026-13', '2026-00', '2026-9', '2026-11', 'all', 'month extra', 'week; DROP TABLE users']) {
    assert.equal(resolveStatsPeriod(value, NOW), null, value);
  }
  assert.equal(resolveStatsPeriod(' WEEK ', NOW).key, 'week');
  for (const data of ['stats:month', 'stats:2026-13', 'stats:2026-11', 'stats:2026-09:8', 'stats:2026-09:0:1', 'stats:week:-1']) {
    assert.equal(parseStatsCallback(data, NOW), null, data);
  }
  assert.equal(parseStatsCallback('stats:2026-09:0', NOW).category, 'Food & Dining');
});

test('real SQL totals all saved entries by user/currency, with accurate shares and comparisons', async t => {
  const db = fixture(t);
  const period = resolveStatsPeriod('month', NOW);
  const data = await loadStats(db, 1, period);
  const total = data.totals.find(row => row.period === 0 && row.currency === 'SGD');
  assert.deepEqual({ total: total.total, count: total.count, days: total.active_days }, { total: 14300, count: 6, days: 5 });
  const messages = formatStats(data, period);
  assert.equal(messages.length, 3);
  const sgd = messages[0];
  assert.match(sgd, /Recorded total: SGD 143\.00 · 6 expenses/);
  assert.match(sgd, /Average expense: SGD 23\.83/);
  assert.match(sgd, /Recorded spend\/calendar day: SGD 28\.60/);
  assert.match(sgd, /Shopping: SGD 100\.00 · 69\.9% · 1 expense/);
  assert.match(sgd, /Food & Dining: SGD 32\.00 · 22\.4% · 3 expenses/);
  assert.match(sgd, /Recorded spending up SGD 93\.00 \(186\.0%\)/);
  assert.match(sgd, /Largest category increase: Shopping \+SGD 100\.00/);
  assert.match(sgd, /Largest category decrease: Food & Dining -SGD 8\.00/);
  assert.match(messages.find(message => message.includes('\nUSD\n')), /Recorded total: USD 50\.00 · 1 expense/);
  assert.match(messages.find(message => message.includes('\nEUR\n')), /Recorded total: EUR 0\.00 · 0 expenses/);
  assert.match(messages.find(message => message.includes('\nEUR\n')), /down EUR 9\.00 \(100\.0%\)/);
  assert.doesNotMatch(messages.join('\n'), /99,999|88,888|77,777|NaN|Infinity|savings/);
});

test('unknown labels are combined and accounted for without inventing merchants/payments', async t => {
  const data = await loadStats(fixture(t), 1, resolveStatsPeriod('month', NOW));
  const merchants = data.merchants.filter(row => row.currency === 'SGD');
  assert.equal(merchants.find(row => row.label.toLowerCase() === 'cafe').count, 2);
  assert.equal(merchants.filter(row => row.unknown).length, 1);
  assert.equal(merchants.find(row => row.unknown).total, 800);
  const payments = data.payments.filter(row => row.currency === 'SGD');
  assert.equal(payments.filter(row => row.unknown).length, 1);
  const output = formatStats(data, resolveStatsPeriod('month', NOW))[0];
  assert.match(output, /Merchant not recorded: SGD 8\.00 · 5\.6% · 2 expenses/);
  assert.match(output, /Payment method not recorded: SGD 8\.00 · 5\.6% · 2 expenses/);
});

test('category drilldown filters purchases/groups but shares use the overall currency total', async t => {
  const db = fixture(t);
  const period = resolveStatsPeriod('month', NOW);
  const data = await loadStats(db, 1, period, 'Food & Dining');
  const report = formatStats(data, period, 'Food & Dining')[0];
  assert.match(report, /Recorded total: SGD 32\.00 · 3 expenses/);
  assert.match(report, /Share of all SGD spending: 22\.4%/);
  assert.match(report, /Average expense: SGD 10\.67/);
  assert.match(report, /Recorded spending down SGD 8\.00 \(20\.0%\)/);
  assert.doesNotMatch(report, /Store|Shopping|Where the money went/);
  assert.equal(data.purchases.filter(row => row.currency === 'SGD').length, 3);
  assert.ok(data.purchases.every(row => row.category === 'Food & Dining'));
  assert.match(statsKeyboard(period, data, 'Food & Dining', NOW).inline_keyboard[1][0].text, /Back/);
});

test('SGT date boundaries, inclusive start and exclusive end hold in the actual SQL', async t => {
  const db = new TestDatabase(t);
  const period = resolveStatsPeriod('2026-09', NOW);
  insert(db, { transaction_date: '2026-08-31T15:59:59.999Z', amount: 1 });
  insert(db, { transaction_date: period.current.start, amount: 2 });
  insert(db, { transaction_date: '2026-09-30T15:59:59.999Z', amount: 3 });
  insert(db, { transaction_date: period.current.end, amount: 4 });
  const data = await loadStats(db, 1, period);
  assert.equal(data.totals.find(row => row.period === 0).total, 500);
  assert.equal(data.totals.find(row => row.period === 0).active_days, 2);
  assert.equal(data.purchases[0].date, '2026-09-30');
  assert.equal(data.purchases[1].date, '2026-09-01');
});

test('empty and one-expense periods have honest averages and missing-history messages', async t => {
  const db = new TestDatabase(t);
  const period = resolveStatsPeriod('month', NOW);
  let data = await loadStats(db, 1, period);
  assert.match(formatStats(data, period)[0], /No expenses recorded/);
  insert(db, { amount: 0.1 });
  data = await loadStats(db, 1, period);
  const report = formatStats(data, period)[0];
  assert.match(report, /Average expense: SGD 0\.10/);
  assert.match(report, /Recorded spend\/calendar day: SGD 0\.02/);
  assert.match(report, /not enough history for a percentage change/);
  assert.doesNotMatch(report, /Recorded spending (?:up|down)|NaN|Infinity/);
  insert(db, { amount: 0.2 });
  data = await loadStats(db, 1, period);
  assert.equal(data.totals[0].total, 30);
});

test('all categories appear while long merchant/payment lists have bounded results and remainders', async t => {
  const db = new TestDatabase(t);
  for (let index = 0; index < 100; index++) insert(db, { amount: 1, merchant: `Shop ${index}`,
    payment_method: `Card ${index}`, category: CATEGORIES[index % CATEGORIES.length] });
  insert(db, { amount: 2, merchant: null, payment_method: '', category: 'Unexpected legacy category' });
  const period = resolveStatsPeriod('month', NOW);
  const data = await loadStats(db, 1, period);
  assert.equal(data.merchants.length, 6);
  assert.equal(data.payments.length, 4);
  assert.equal(data.purchases.length, 3);
  assert.equal(data.categories.length, CATEGORIES.length);
  const report = formatStats(data, period).join('\n');
  for (const name of CATEGORIES) assert.ok(report.includes(`${name}: SGD`));
  assert.match(report, /Other merchants: SGD 95\.00/);
  assert.match(report, /Other payment methods: SGD 97\.00/);
  const keyboard = statsKeyboard(period, data, null, NOW);
  assert.equal(keyboard.inline_keyboard.flat().length, CATEGORIES.length + 3);
  assert.ok(keyboard.inline_keyboard.flat().every(button => Buffer.byteLength(button.callback_data) <= 64));
});

test('query plan uses the existing user/date index', async t => {
  const db = new TestDatabase(t);
  const plan = db.sqlite.prepare('EXPLAIN QUERY PLAN SELECT SUM(amount) FROM transactions WHERE user_id=? AND transaction_date>=? AND transaction_date<?')
    .all(1, '2026-09-30T16:00:00.000Z', NOW.toISOString());
  assert.ok(plan.some(row => row.detail.includes('idx_transactions_user_date')));
});

test('long Unicode/user-provided labels remain plain text and within Telegram limits', async t => {
  const db = new TestDatabase(t);
  for (let index = 0; index < 8; index++) insert(db, { amount: 1000000, merchant: `*<${index}>*\n` + '🧋'.repeat(120),
    description: '🧋'.repeat(240), category: CATEGORIES[index], payment_method: `Card ${index}` + '🧋'.repeat(80) });
  const period = resolveStatsPeriod('month', NOW);
  const output = formatStats(await loadStats(db, 1, period), period);
  assert.ok(output.every(message => message.length > 0 && message.length <= 3900));
  assert.ok(output.join('\n').includes('*<'));
  const long = '🧋'.repeat(5000);
  const split = splitStatsMessage(long);
  assert.ok(split.every(message => message.length <= 3900));
  assert.equal(split.join(''), long);
});

async function dispatch(t, db, textOrCallback, userId = 101) {
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    sent.push({ method: url.split('/').at(-1), ...JSON.parse(request.body) });
    return Response.json({ ok: true, result: {} });
  });
  const chat = { id: userId, type: 'private' };
  const from = { id: userId, first_name: 'Test' };
  const updateId = ++sourceId;
  const body = typeof textOrCallback === 'string'
    ? { update_id: updateId, message: { from, chat, text: textOrCallback, date: Math.floor(Date.now() / 1000) } }
    : { update_id: updateId, callback_query: { id: `callback-${updateId}`, from, message: { chat }, ...textOrCallback } };
  db.sqlite.prepare('INSERT INTO telegram_updates(update_id) VALUES (?)').run(updateId);
  let acked = false;
  let retried = false;
  await worker.queue({ messages: [{ body, ack: () => { acked = true; }, retry: () => { retried = true; } }] },
    { DB: db, TELEGRAM_BOT_TOKEN: 'test-token', AI: { run: () => { throw new Error('Stats must not call AI'); } } });
  assert.equal(retried, false);
  assert.equal(acked, true);
  assert.equal(db.sqlite.prepare('SELECT status FROM telegram_updates WHERE update_id=?').get(updateId).status, 'processed');
  t.mock.restoreAll();
  return sent;
}

test('queued stats command and category callbacks work end to end without disturbing pending entries', async t => {
  const db = new TestDatabase(t);
  const period = resolveStatsPeriod('lastmonth');
  insert(db, { amount: 13.35, transaction_date: period.current.start });
  db.sqlite.prepare('INSERT INTO pending_entries(user_id,payload) VALUES (?,?)').run(1, '{"amount":200}');
  const sent = await dispatch(t, db, `/stats@TeleBudgetBot ${period.key}`);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /Recorded total: SGD 13\.35 · 1 expense/);
  assert.equal(sent[0].parse_mode, undefined);
  const button = sent[0].reply_markup.inline_keyboard.flat().find(row => row.text === 'Food & Dining');
  const detail = await dispatch(t, db, { data: button.callback_data });
  assert.equal(detail[0].method, 'answerCallbackQuery');
  assert.match(detail[1].text, /Share of all SGD spending: 100\.0%/);
  assert.equal(db.sqlite.prepare('SELECT payload FROM pending_entries WHERE user_id=1').get().payload, '{"amount":200}');
  const otherUser = await dispatch(t, db, { data: button.callback_data }, 202);
  assert.match(otherUser[1].text, /No Food & Dining expenses recorded/);
  assert.doesNotMatch(otherUser[1].text, /13\.35/);
});

test('queued defaults, shortcuts, help and invalid selections route without AI', async t => {
  const db = new TestDatabase(t);
  for (const command of ['/stats', '/stats month', '/stats week', '/stats lastmonth']) {
    const sent = await dispatch(t, db, command);
    assert.match(sent[0].text, /Spending stats/);
    assert.equal(sent[0].reply_markup.inline_keyboard[0].length, 3);
  }
  for (const command of ['/stats all', '/stats 9999-12', '/stats 2026-13', '/stats month extra']) {
    assert.equal((await dispatch(t, db, command))[0].text, STATS_USAGE);
  }
  assert.equal((await dispatch(t, db, { data: 'stats:2026-13:0' }))[1].text, STATS_USAGE);
  assert.match((await dispatch(t, db, '/help'))[0].text, /Tap a category/);
});

test('confirmation, edits and undo are reflected immediately; pending entries are excluded', async t => {
  const db = new TestDatabase(t);
  const period = resolveStatsPeriod('lastmonth');
  const id = insert(db, { amount: 10, transaction_date: period.current.start });
  const pending = { amount: 20, currency: 'SGD', merchant: 'Cafe', description: 'Dinner',
    category: 'Food & Dining', date: period.current.start, payment_method: null, confidence: 0.5 };
  db.sqlite.prepare('INSERT INTO pending_entries(user_id,payload) VALUES (?,?)').run(1, JSON.stringify(pending));
  assert.match((await dispatch(t, db, `/stats ${period.key}`))[0].text, /SGD 10\.00 · 1 expense/);
  await dispatch(t, db, { data: 'confirm' });
  assert.match((await dispatch(t, db, `/stats ${period.key}`))[0].text, /SGD 30\.00 · 2 expenses/);
  await dispatch(t, db, { data: `edit:${id}` });
  db.sqlite.prepare('UPDATE pending_entries SET payload=? WHERE user_id=1').run(JSON.stringify({ ...pending, amount: 40 }));
  await dispatch(t, db, { data: 'confirm' });
  assert.match((await dispatch(t, db, `/stats ${period.key}`))[0].text, /SGD 60\.00 · 2 expenses/);
  await dispatch(t, db, { data: `undo:${id}` });
  assert.match((await dispatch(t, db, `/stats ${period.key}`))[0].text, /SGD 20\.00 · 1 expense/);
});

test('category overview totals and shares match stats, with all categories and separate currencies', async t => {
  const db = fixture(t);
  const period = resolveStatsPeriod('month', NOW);
  const data = await loadCategories(db, 1, period);
  const reports = formatCategories(data, period);
  assert.equal(reports.length, 2); // prior-only EUR is outside the selected period
  assert.match(reports[0], /Recorded total: SGD 143\.00 · 6 expenses/);
  assert.match(reports[0], /Shopping: SGD 100\.00 · 69\.9% · 1 expense/);
  assert.match(reports[0], /Food & Dining: SGD 32\.00 · 22\.4% · 3 expenses/);
  assert.match(reports[0], /Education: SGD 0\.00 · 0\.0% · 0 expenses/);
  assert.match(reports[1], /Recorded total: USD 50\.00 · 1 expense/);
  for (const report of reports) {
    for (const category of CATEGORIES) assert.ok(report.includes(`${category}: `));
    assert.ok(report.length <= 3900);
  }
  assert.doesNotMatch(reports.join('\n'), /EUR|99,999|88,888|NaN|Infinity/);
  const sgd = data.categories.filter(row => row.currency === 'SGD');
  assert.equal(sgd.reduce((sum, row) => sum + row.total, 0), 14300);
});

test('empty category periods list zero spending in all supported categories', async t => {
  const db = new TestDatabase(t);
  const period = resolveStatsPeriod('month', NOW);
  const report = formatCategories(await loadCategories(db, 1, period), period)[0];
  assert.match(report, /No expenses recorded in this period/);
  assert.match(report, /SGD · default currency/);
  for (const category of CATEGORIES) assert.ok(report.includes(`${category}: SGD 0.00 · 0.0% · 0 expenses`));
  assert.doesNotMatch(report, /NaN|Infinity/);
});

test('queued categories report, detail and Back retain the category view and user isolation', async t => {
  const db = new TestDatabase(t);
  const period = resolveStatsPeriod('lastmonth');
  insert(db, { amount: 13.35, transaction_date: period.current.start });
  db.sqlite.prepare('INSERT INTO pending_entries(user_id,payload) VALUES (?,?)').run(1, '{"amount":200}');
  const sent = await dispatch(t, db, `/categories@TeleBudgetBot ${period.key}`);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /Food & Dining: SGD 13\.35 · 100\.0% · 1 expense/);
  assert.doesNotMatch(sent[0].text, /Top merchants|Largest purchases/);
  const buttons = sent[0].reply_markup.inline_keyboard.flat();
  assert.ok(buttons.every(button => button.callback_data.startsWith('categories:')));
  assert.ok(buttons.every(button => Buffer.byteLength(button.callback_data) <= 64));
  const detail = await dispatch(t, db, { data: buttons.find(button => button.text === 'Food & Dining').callback_data });
  assert.equal(detail[0].method, 'answerCallbackQuery');
  assert.match(detail[1].text, /Share of all SGD spending: 100\.0%/);
  const back = detail[1].reply_markup.inline_keyboard.flat().find(button => button.text === 'Back to categories');
  assert.equal(back.callback_data, `categories:${period.key}`);
  assert.match((await dispatch(t, db, { data: back.callback_data }))[1].text, /Category spending/);
  const otherUser = await dispatch(t, db, { data: back.callback_data }, 202);
  assert.doesNotMatch(otherUser[1].text, /13\.35/);
  assert.equal(db.sqlite.prepare('SELECT payload FROM pending_entries WHERE user_id=1').get().payload, '{"amount":200}');
});

test('categories shortcuts, period buttons and invalid arguments route without AI', async t => {
  const db = new TestDatabase(t);
  for (const command of ['/categories', '/categories month', '/categories week', '/categories lastmonth']) {
    const sent = await dispatch(t, db, command);
    assert.match(sent[0].text, /Category spending/);
    const periods = sent[0].reply_markup.inline_keyboard[0];
    assert.equal(periods.length, 3);
    for (const button of periods) {
      assert.match((await dispatch(t, db, { data: button.callback_data }))[1].text, /Category spending/);
    }
  }
  for (const command of ['/categories all', '/categories 9999-12', '/categories month extra']) {
    assert.equal((await dispatch(t, db, command))[0].text, CATEGORIES_USAGE);
  }
  for (const data of ['categories:2026-13:0', 'categories:week:8', 'categories:week:0:1']) {
    assert.equal((await dispatch(t, db, { data }))[1].text, CATEGORIES_USAGE);
  }
});

test('help and start explain every command and supported workflow within one Telegram message', async t => {
  const db = new TestDatabase(t);
  const help = (await dispatch(t, db, '/help'))[0].text;
  for (const command of ['/add', '/recent', '/stats', '/categories', '/link', '/unlink', '/start', '/help', '/cancel']) {
    assert.ok(help.includes(command), command);
  }
  for (const detail of ['6.50 at macs', 'Confirm', 'Edit', 'Undo', '30 minutes', '10 minutes',
    'YYYY-MM', 'Monday through now', 'Singapore time', 'separately', 'original date']) {
    assert.ok(help.includes(detail), detail);
  }
  assert.ok(help.length <= 4096, `Help length: ${help.length}`);
  assert.equal((await dispatch(t, db, '/start'))[0].text, help);
});
