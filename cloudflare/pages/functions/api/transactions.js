import { appUser, json } from '../../../shared/core.js';

export async function onRequestGet({ request, env }) {
  const user = await appUser(request, env);
  if (!user) return json({ error: 'Unauthorized' }, 401);
  const url = new URL(request.url);
  const limit = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get('limit') || '50', 10) || 50));
  const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const { results } = await env.DB.prepare(`SELECT id, amount, currency, description, merchant, category,
    transaction_date AS transactionDate, payment_method AS paymentMethod, source, confidence_score AS confidenceScore
    FROM transactions WHERE user_id = ? ORDER BY transaction_date DESC, id DESC LIMIT ? OFFSET ?`)
    .bind(user.user_id, limit, (page - 1) * limit).all();
  const count = await env.DB.prepare('SELECT COUNT(*) AS total FROM transactions WHERE user_id = ?').bind(user.user_id).first();
  return json({ transactions: results, pagination: { page, limit, total: count.total } });
}
