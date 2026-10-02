import { extractExpense, MODEL, SYSTEM_PROMPT } from '../shared/core.js';

// Local-only smoke harness: run with `wrangler dev --config cloudflare/test/wrangler.jsonc`.
export default {
  async fetch(request, env) {
    const { text, image, date, raw } = await request.json();
    if (raw) return Response.json(await env.AI.run(MODEL, { messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: image ? [
        { type: 'text', text: `Message timestamp: ${date}\nExpense input: ${text || 'Receipt photo'}` },
        { type: 'image_url', image_url: { url: image } }
      ] : `Message timestamp: ${date}\nExpense input: ${text}` }
    ], max_tokens: 300, temperature: 0.1, chat_template_kwargs: { enable_thinking: false } }));
    try { return Response.json(await extractExpense(env, text, date || new Date().toISOString(), image)); }
    catch (error) { return Response.json({ error: error.message }, { status: 500 }); }
  }
};
