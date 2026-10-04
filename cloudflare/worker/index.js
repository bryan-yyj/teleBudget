import { extractExpense, bytesToBase64, sha256, CATEGORIES } from '../shared/core.js';
import { resolveStatsPeriod, parseStatsCallback, loadStats, loadCategories, formatStats, formatCategories,
  statsKeyboard, STATS_USAGE, CATEGORIES_USAGE } from '../shared/analytics.js';

const api = (env, method) => `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;

const HELP_TEXT = `TeleBudget — track expenses in this private chat

Record an expense
Send one expense per message, with an amount and merchant or description. For example:
• 6.50 at macs
• 12.80 at NTUC paid with PayNow
• USD 15 at a cafe
• 8.50 at a cafe yesterday
SGD is the default currency. State another currency or date when needed. You can send text directly; /add shows a starter example.

Receipts and confirmation
Send a clear receipt photo or a JPG, PNG or WebP image smaller than 10 MB. I read the receipt total and merchant. Receipt images are not kept.
Clear expenses are saved automatically. If I ask you to check an expense, tap Confirm to save it, or send a complete corrected expense. Tap Cancel or use /cancel to stop. Finish a pending confirmation or edit within 30 minutes.

Review and correct
/recent — see your latest 10 saved expenses, ordered by expense date.
On the original “Saved #…” message, tap Edit and send the complete replacement expense. Include its original date if that date should stay the same. Tap Undo on that saved message to remove the expense. Use /cancel to abandon a pending edit; the saved expense stays.

Spending reports
/stats — this month’s totals, averages, categories, top merchants, largest purchases and payment methods, plus a previous-period comparison.
/categories — the amount, percentage and expense count for every category this month, including categories with no recorded spending.

Both commands support the same periods:
/stats week or /categories week — Monday through now.
/stats month or /categories month — this month to date (the default).
/stats lastmonth or /categories lastmonth — the previous full month.
/stats 2026-09 or /categories 2026-09 — a specific month, using YYYY-MM. Future months are unavailable.
Use the period buttons to switch reports. Tap a category with recorded spending to see its merchants and purchases; use Back to return.

Categories: ${CATEGORIES.join('; ')}.
Reports use Singapore time and saved expense dates. Each currency is shown separately, with no conversion. Unconfirmed entries are excluded; missing entries do not prove lower real spending. Categories use the labels saved with each expense.

Connect the app
/link — get an 8-digit code to enter in the TeleBudget app. It expires in 10 minutes.
/unlink — revoke all connected app sessions; your expenses stay saved.

/start — show this getting-started guide.
/help — show these instructions again.
/cancel — cancel the current pending confirmation or edit.`;

async function telegram(env, method, payload) {
  const response = await fetch(api(env, method), { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(15000) });
  const data = await response.json();
  if (!data.ok) throw new Error(`Telegram ${method}: ${response.status}`);
  return data.result;
}

async function sendAnalytics(env, chatId, userId, period, category = null, now = new Date(), view = 'stats') {
  const categoryOverview = view === 'categories' && !category;
  const data = categoryOverview ? await loadCategories(env.DB, userId, period) : await loadStats(env.DB, userId, period, category);
  const messages = categoryOverview ? formatCategories(data, period) : formatStats(data, period, category);
  for (let index = 0; index < messages.length; index++) {
    await telegram(env, 'sendMessage', { chat_id: chatId, text: messages[index],
      ...(index === messages.length - 1 ? { reply_markup: statsKeyboard(period, data, category, now, view) } : {}) });
  }
}

function buttons(id) {
  return { inline_keyboard: [[
    { text: '✏️ Edit', callback_data: `edit:${id}` },
    { text: '↩️ Undo', callback_data: `undo:${id}` }
  ]] };
}

function summary(entry) {
  return `${entry.currency} ${Number(entry.amount).toFixed(2)} · ${entry.merchant || entry.description}\n${entry.category}${entry.payment_method ? ` · ${entry.payment_method}` : ''}`;
}

async function getUser(env, from) {
  await env.DB.prepare(`INSERT INTO users(telegram_id, first_name, username) VALUES (?,?,?)
    ON CONFLICT(telegram_id) DO UPDATE SET first_name = excluded.first_name, username = excluded.username`)
    .bind(String(from.id), from.first_name || null, from.username || null).run();
  return env.DB.prepare('SELECT id FROM users WHERE telegram_id = ?').bind(String(from.id)).first();
}

async function getPending(env, userId) {
  return env.DB.prepare("SELECT * FROM pending_entries WHERE user_id = ? AND created_at > datetime('now', '-30 minutes')")
    .bind(userId).first();
}

async function setPending(env, userId, entry, transactionId = null) {
  await env.DB.prepare(`INSERT INTO pending_entries(user_id,payload,transaction_id) VALUES (?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload, transaction_id=excluded.transaction_id,
    created_at=CURRENT_TIMESTAMP`)
    .bind(userId, JSON.stringify(entry || {}), transactionId).run();
}

async function clearPending(env, userId) {
  await env.DB.prepare('DELETE FROM pending_entries WHERE user_id = ?').bind(userId).run();
}

async function saveEntry(env, userId, entry, sourceRef, pending = null) {
  if (pending?.transaction_id) {
    await env.DB.prepare(`UPDATE transactions SET amount=?, currency=?, description=?, merchant=?, category=?,
      transaction_date=?, payment_method=?, confidence_score=? WHERE id=? AND user_id=?`)
      .bind(entry.amount, entry.currency, entry.description, entry.merchant, entry.category,
        entry.date, entry.payment_method, entry.confidence, pending.transaction_id, userId).run();
    return pending.transaction_id;
  }
  const result = await env.DB.prepare(`INSERT INTO transactions(user_id,amount,currency,description,merchant,category,
    transaction_date,payment_method,source,source_reference,confidence_score)
    VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,source_reference) DO NOTHING`)
    .bind(userId, entry.amount, entry.currency, entry.description, entry.merchant, entry.category,
      entry.date, entry.payment_method, 'telegram', sourceRef, entry.confidence).run();
  let id = result.meta.last_row_id;
  if (!result.meta.changes) {
    const existing = await env.DB.prepare('SELECT id FROM transactions WHERE user_id=? AND source_reference=?').bind(userId, sourceRef).first();
    id = existing.id;
  }
  return id;
}

async function processText(env, message, user, updateId) {
  const text = message.text.trim();
  const chatId = message.chat.id;
  const command = text.split(/\s/)[0].toLowerCase().split('@')[0];
  if (command === '/start' || command === '/help') {
    await telegram(env, 'sendMessage', { chat_id: chatId,
      text: HELP_TEXT });
    return;
  }
  if (command === '/cancel') {
    await clearPending(env, user.id);
    await telegram(env, 'sendMessage', { chat_id: chatId, text: 'Cancelled. Send a new expense whenever you are ready.' });
    return;
  }
  if (command === '/add') {
    await telegram(env, 'sendMessage', { chat_id: chatId, text: 'What did you spend? For example: 6.50 at macs' });
    return;
  }
  if (command === '/recent') {
    const { results } = await env.DB.prepare('SELECT * FROM transactions WHERE user_id=? ORDER BY transaction_date DESC,id DESC LIMIT 10').bind(user.id).all();
    await telegram(env, 'sendMessage', { chat_id: chatId,
      text: results.length ? results.map(row => `#${row.id} ${summary(row)}`).join('\n\n') : 'No expenses yet. Send “6.50 at macs” to start.' });
    return;
  }
  if (command === '/stats' || command === '/categories') {
    const now = new Date();
    const period = resolveStatsPeriod(text.split(/\s+/).slice(1).join(' '), now);
    if (!period) {
      await telegram(env, 'sendMessage', { chat_id: chatId, text: command === '/categories' ? CATEGORIES_USAGE : STATS_USAGE });
      return;
    }
    await sendAnalytics(env, chatId, user.id, period, null, now, command.slice(1));
    return;
  }
  if (command === '/link') {
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 100000000).padStart(8, '0');
    const expiry = new Date(Date.now() + 10 * 60000).toISOString();
    await env.DB.prepare('DELETE FROM link_codes WHERE user_id=?').bind(user.id).run();
    await env.DB.prepare('INSERT INTO link_codes(code_hash,user_id,expires_at) VALUES (?,?,?)')
      .bind(await sha256(code + env.TELEGRAM_WEBHOOK_SECRET), user.id, expiry).run();
    await telegram(env, 'sendMessage', { chat_id: chatId, text: `Enter this code in the TeleBudget app: ${code}\nIt expires in 10 minutes.` });
    return;
  }
  if (command === '/unlink') {
    await env.DB.prepare('DELETE FROM app_tokens WHERE user_id=?').bind(user.id).run();
    await telegram(env, 'sendMessage', { chat_id: chatId, text: 'All connected app sessions have been revoked.' });
    return;
  }
  if (text.startsWith('/')) {
    await telegram(env, 'sendMessage', { chat_id: chatId, text: 'Unknown command. Use /help for examples.' });
    return;
  }
  const pending = await getPending(env, user.id);
  let entry;
  try { entry = await extractExpense(env, text, new Date(message.date * 1000).toISOString()); }
  catch (error) {
    console.error('AI text extraction failed', error instanceof Error ? error.name : 'Error');
    await telegram(env, 'sendMessage', { chat_id: chatId, text: 'I cannot read expenses right now. Please try again later; nothing was saved.' });
    return;
  }
  if (!entry) {
    await telegram(env, 'sendMessage', { chat_id: chatId, text: 'I could not find a clear amount. Please send something like “6.50 at macs”.' });
    return;
  }
  if (entry.confidence <= 0.6) {
    await setPending(env, user.id, entry, pending?.transaction_id || null);
    await telegram(env, 'sendMessage', { chat_id: chatId,
      text: `Please check this expense:\n${summary(entry)}\nTap Confirm or send a corrected entry.`,
      reply_markup: { inline_keyboard: [[{ text: '✅ Confirm', callback_data: 'confirm' }, { text: '❌ Cancel', callback_data: 'cancel' }]] } });
    return;
  }
  const id = await saveEntry(env, user.id, entry, `update:${updateId}`, pending);
  await clearPending(env, user.id);
  await telegram(env, 'sendMessage', { chat_id: chatId, text: `Saved #${id}\n${summary(entry)}`, reply_markup: buttons(id) });
}

async function processPhoto(env, message, user, updateId) {
  const chatId = message.chat.id;
  await clearPending(env, user.id);
  const fileId = message.photo?.at(-1)?.file_id || message.document?.file_id;
  const file = await telegram(env, 'getFile', { file_id: fileId });
  if (file.file_size > 10 * 1024 * 1024) {
    await telegram(env, 'sendMessage', { chat_id: chatId, text: 'Please send an image smaller than 10 MB.' });
    return;
  }
  const response = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`,
    { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Telegram image download failed: ${response.status}`);
  const responseType = response.headers.get('content-type') || '';
  const contentType = /^image\/(jpeg|png|webp)$/.test(responseType)
    ? responseType : (message.document?.mime_type || 'image/jpeg');
  if (!/^image\/(jpeg|png|webp)$/.test(contentType)) {
    await telegram(env, 'sendMessage', { chat_id: chatId, text: 'Please send a JPG, PNG, or WebP receipt.' });
    return;
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > 10 * 1024 * 1024) throw new Error('Image size exceeded limit');
  let entry;
  try { entry = await extractExpense(env, message.caption || '', new Date(message.date * 1000).toISOString(), `data:${contentType};base64,${bytesToBase64(bytes)}`); }
  catch (error) {
    console.error('AI receipt extraction failed', error instanceof Error ? error.name : 'Error');
    await telegram(env, 'sendMessage', { chat_id: chatId, text: 'I could not scan that receipt. Please send the amount and merchant as text; nothing was saved.' });
    return;
  }
  if (!entry) {
    await telegram(env, 'sendMessage', { chat_id: chatId, text: 'I could not read the total. Please send a correction such as “6.50 at macs”.' });
    return;
  }
  if (entry.confidence <= 0.6) {
    await setPending(env, user.id, entry);
    await telegram(env, 'sendMessage', { chat_id: chatId, text: `Please check the receipt:\n${summary(entry)}\nTap Confirm or send a corrected entry.`,
      reply_markup: { inline_keyboard: [[{ text: '✅ Confirm', callback_data: 'confirm' }, { text: '❌ Cancel', callback_data: 'cancel' }]] } });
    return;
  }
  const id = await saveEntry(env, user.id, entry, `receipt-update:${updateId}`);
  await telegram(env, 'sendMessage', { chat_id: chatId, text: `Saved receipt #${id}\n${summary(entry)}`, reply_markup: buttons(id) });
}

async function processCallback(env, query, user) {
  const chatId = query.message.chat.id;
  const data = query.data || '';
  await telegram(env, 'answerCallbackQuery', { callback_query_id: query.id });
  if (data.startsWith('stats:') || data.startsWith('categories:')) {
    const now = new Date();
    const selection = parseStatsCallback(data, now);
    if (!selection) {
      await telegram(env, 'sendMessage', { chat_id: chatId, text: data.startsWith('categories:') ? CATEGORIES_USAGE : STATS_USAGE });
      return;
    }
    await sendAnalytics(env, chatId, user.id, selection.period, selection.category, now, selection.view);
    return;
  }
  if (data === 'cancel') {
    await clearPending(env, user.id);
    await telegram(env, 'sendMessage', { chat_id: chatId, text: 'Cancelled; nothing was saved.' });
    return;
  }
  if (data === 'confirm') {
    const pending = await getPending(env, user.id);
    if (!pending) return;
    const entry = JSON.parse(pending.payload);
    if (!entry.amount) return;
    const id = await saveEntry(env, user.id, entry, `confirmed:${query.id}`, pending);
    await clearPending(env, user.id);
    await telegram(env, 'sendMessage', { chat_id: chatId, text: `Saved #${id}\n${summary(entry)}`, reply_markup: buttons(id) });
    return;
  }
  const match = data.match(/^(edit|undo):(\d+)$/);
  if (!match) return;
  const id = Number(match[2]);
  const transaction = await env.DB.prepare('SELECT * FROM transactions WHERE id=? AND user_id=?').bind(id, user.id).first();
  if (!transaction) {
    await telegram(env, 'sendMessage', { chat_id: chatId, text: 'That expense is no longer available.' });
    return;
  }
  if (match[1] === 'edit') {
    await setPending(env, user.id, transaction, id);
    await telegram(env, 'sendMessage', { chat_id: chatId, text: `Send the corrected expense for #${id}, for example “6.50 at macs”.` });
    return;
  }
  await env.DB.prepare('DELETE FROM transactions WHERE id=? AND user_id=?').bind(id, user.id).run();
  await telegram(env, 'sendMessage', { chat_id: chatId, text: `Undid expense #${id}.` });
}

async function handleUpdate(env, update) {
  const message = update.message;
  const query = update.callback_query;
  const from = message?.from || query?.from;
  const chat = message?.chat || query?.message?.chat;
  if (!from || !chat || chat.type !== 'private') return;
  const user = await getUser(env, from);
  if (query) return processCallback(env, query, user);
  if (message.text) return processText(env, message, user, update.update_id);
  if (message.photo || (message.document && /^image\/(jpeg|png|webp)$/.test(message.document.mime_type || ''))) {
    return processPhoto(env, message, user, update.update_id);
  }
  await telegram(env, 'sendMessage', { chat_id: chat.id, text: 'Send an expense as text or a receipt photo.' });
}

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname !== '/internal/webhook/setup' || request.method !== 'POST') {
      return new Response('Not found', { status: 404 });
    }
    if (!env.TELEGRAM_WEBHOOK_SECRET || request.headers.get('X-TeleBudget-Admin') !== env.TELEGRAM_WEBHOOK_SECRET) {
      return new Response('Unauthorized', { status: 401 });
    }
    try {
      const bot = await telegram(env, 'getMe', {});
      await telegram(env, 'setWebhook', {
        url: 'https://telebudget.pages.dev/api/telegram',
        secret_token: env.TELEGRAM_WEBHOOK_SECRET,
        allowed_updates: ['message', 'callback_query']
      });
      return Response.json({ ok: true, username: bot.username });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const method = message.startsWith('Telegram setWebhook:') ? 'setWebhook' : 'getMe';
      const status = message.match(/Telegram (?:getMe|setWebhook): (\d{3})$/)?.[1];
      console.error('Telegram webhook setup failed', method, status || (error instanceof Error ? error.name : 'Error'));
      return Response.json({ ok: false, method, upstream_status: status ? Number(status) : null,
        error_type: error instanceof Error ? error.name : 'Error' }, { status: 502 });
    }
  },
  async queue(batch, env) {
    for (const message of batch.messages) {
      const update = message.body;
      try {
        const status = await env.DB.prepare('SELECT status FROM telegram_updates WHERE update_id=?').bind(update.update_id).first();
        if (status?.status === 'processed') { message.ack(); continue; }
        await handleUpdate(env, update);
        await env.DB.prepare('UPDATE telegram_updates SET status=? WHERE update_id=?').bind('processed', update.update_id).run();
        message.ack();
      } catch (error) {
        console.error('Telegram update failed', update.update_id, error instanceof Error ? error.name : 'Error');
        message.retry();
      }
    }
  }
};
