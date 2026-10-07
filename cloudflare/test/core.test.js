import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEntry, parseModelJson, extractExpense, SYSTEM_PROMPT } from '../shared/core.js';
import { mealFromText } from '../shared/meals.js';

test('food meals follow explicit words and never the message time or guessed AI label', () => {
  const raw = { amount: 10.5, category: 'Food & Dining', merchant: 'Subway', confidence: 0.9, meal_type: 'Breakfast' };
  const normalize = text => normalizeEntry(raw, text, '2026-10-07T00:00:00Z', true);
  for (const [text, expected] of [
    ['10.50 at Subway for lunch', 'Lunch'], ['10.50 breakfast at Subway', 'Breakfast'],
    ['10.50 dinner at Subway', 'Dinner'], ['10.50 brekkie', 'Breakfast'],
    ['10.50 kopi', 'Snacks & Drinks'], ['10.50 coffee with lunch', 'Lunch'],
    ['10.50 at Subway', 'Other food'], ['10.50 breakfast and lunch', 'Other food']
  ]) assert.equal(normalize(text).meal_type, expected, text);
  assert.equal(normalizeEntry({ ...raw, category: 'Transportation' }, '10.50 grab after lunch', undefined, true).meal_type, null);
  assert.equal(mealFromText('10.50 at Dinnerware shop'), 'Other food');
});

test('receipt meal values are restricted and a caption overrides the model', () => {
  const raw = { amount: 8, category: 'Food & Dining', merchant: 'Cafe', meal_type: 'Brunch' };
  assert.equal(normalizeEntry(raw).meal_type, 'Other food');
  assert.equal(normalizeEntry({ ...raw, meal_type: 'Breakfast' }, 'dinner receipt').meal_type, 'Dinner');
});

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
