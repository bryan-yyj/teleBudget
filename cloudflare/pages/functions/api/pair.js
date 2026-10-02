import { json, randomToken, sha256 } from '../../../shared/core.js';

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const code = String(body?.code || '').trim();
  if (!/^\d{8}$/.test(code)) return json({ error: 'Enter the 8-digit code from Telegram' }, 400);
  const hash = await sha256(code + env.TELEGRAM_WEBHOOK_SECRET);
  const now = new Date().toISOString();
  const existing = await env.DB.prepare('SELECT * FROM link_codes WHERE code_hash = ? AND expires_at > ? AND attempts < 5')
    .bind(hash, now).first();
  if (!existing) return json({ error: 'Code expired or invalid' }, 401);
  await env.DB.prepare('UPDATE link_codes SET attempts = attempts + 1 WHERE code_hash = ?').bind(hash).run();
  const token = randomToken();
  const expiry = new Date(Date.now() + 90 * 86400000).toISOString();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO app_tokens(token_hash,user_id,expires_at) VALUES (?,?,?)').bind(await sha256(token), existing.user_id, expiry),
    env.DB.prepare('DELETE FROM link_codes WHERE code_hash = ?').bind(hash)
  ]);
  return json({ token, expires_at: expiry });
}
