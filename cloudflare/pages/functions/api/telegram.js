import { json } from '../../../shared/core.js';

export async function onRequestPost({ request, env }) {
  if (!env.TELEGRAM_WEBHOOK_SECRET || request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TELEGRAM_WEBHOOK_SECRET) {
    return json({ error: 'Unauthorized' }, 401);
  }
  let update;
  try { update = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  if (!Number.isInteger(update?.update_id)) return json({ error: 'Invalid update' }, 400);
  const result = await env.DB.prepare('INSERT OR IGNORE INTO telegram_updates(update_id) VALUES (?)').bind(update.update_id).run();
  if (!result.meta.changes) return json({ ok: true });
  try {
    await env.UPDATES.send(update);
  } catch (error) {
    await env.DB.prepare('DELETE FROM telegram_updates WHERE update_id = ?').bind(update.update_id).run();
    throw error;
  }
  return json({ ok: true });
}
