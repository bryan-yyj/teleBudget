import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEntry, parseModelJson, extractExpense, SYSTEM_PROMPT } from '../shared/core.js';

test('understands the intended shorthand through the AI prompt', async () => {
  assert.match(SYSTEM_PROMPT, /6\.50 at macs/);
  const env = { AI: { run: async (_, input) => {
    assert.match(input.messages[0].content, /McDonald/);
    return { response: JSON.stringify({ amount: 6.5, currency: 'SGD', merchant: "McDonald's",
      description: "McDonald's meal", category: 'Food & Dining', confidence: 0.85 }) };
  } } };
  const entry = await extractExpense(env, '6.50 at macs', '2026-09-25T00:00:00.000Z');
  assert.equal(entry.amount, 6.5);
  assert.equal(entry.merchant, "McDonald's");
  assert.equal(entry.confidence > 0.6, true);
});

test('conflicting text amount requires clarification', () => {
  const entry = normalizeEntry({ amount: 16.5, merchant: "McDonald's", description: 'Meal', category: 'Food & Dining', confidence: 0.99 }, '6.50 at macs');
  assert.equal(entry.confidence, 0.6);
});

test('text with no stated amount cannot auto-save and invented payment method is removed', () => {
  const entry = normalizeEntry({ amount: 6.5, merchant: "McDonald's", description: 'Meal',
    category: 'Food & Dining', payment_method: 'Credit Card', confidence: 0.98 }, 'macs',
    '2026-09-25T00:00:00.000Z', true);
  assert.equal(entry.confidence, 0.6);
  assert.equal(entry.payment_method, null);
});

test('bare amount or conflicting currency needs clarification', () => {
  const raw = { amount: 6.5, currency: 'SGD', merchant: 'Cafe', description: 'Coffee', confidence: 0.9 };
  assert.equal(normalizeEntry(raw, '6.50', '2026-09-25T00:00:00.000Z', true).confidence, 0.6);
  assert.equal(normalizeEntry(raw, 'USD 6.50 at cafe', '2026-09-25T00:00:00.000Z', true).confidence, 0.6);
});

test('rejects missing amount and malformed AI JSON', () => {
  assert.equal(normalizeEntry({ merchant: 'Macs', confidence: 0.9 }), null);
  assert.throws(() => parseModelJson({ response: 'not JSON' }), SyntaxError);
});
