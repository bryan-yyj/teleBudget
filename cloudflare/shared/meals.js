export const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snacks & Drinks', 'Other food'];

// Message time is not meal time. Explicit meal words take precedence over food items.
export function mealFromText(text) {
  const matches = [
    ['Breakfast', /\b(breakfast|brekkie|bfast)\b/i],
    ['Lunch', /\blunch\b/i],
    ['Dinner', /\b(dinner|supper)\b/i]
  ].filter(([, pattern]) => pattern.test(text));
  if (matches.length === 1) return matches[0][0];
  if (matches.length > 1) return 'Other food';
  if (/\b(snacks?|coffee|kopi|tea|teh|bubble tea|boba|drinks?|dessert|ice cream)\b/i.test(text)) return 'Snacks & Drinks';
  return 'Other food';
}

export function normalizeMeal(category, raw, text, textOnly = true) {
  if (category !== 'Food & Dining') return null;
  const explicit = mealFromText(text);
  if (explicit !== 'Other food' || textOnly) return explicit;
  return MEALS.includes(raw) ? raw : 'Other food';
}
