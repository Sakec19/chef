/* Fridge Chef — Vercel Serverless Function: POST /api/ai
 * PRIMARY AI proxy for the PWA (v1.3.0). No dependencies.
 *
 * The API key lives ONLY on the host (Vercel env vars). The browser never
 * sends a key and this function NEVER accepts one from the client:
 * a request body containing apiKey / key / aiKey is rejected.
 * Keys are never logged.
 *
 * Env vars (set in Vercel Dashboard > Settings > Environment Variables):
 *   OPENAI_API_KEY      — for provider "openai" (or auto when present)
 *   ANTHROPIC_API_KEY   — for provider "anthropic" (or auto fallback)
 *   ALLOWED_ORIGIN      — optional. When set, only this Origin is allowed
 *                         (e.g. https://your-app.vercel.app). When unset,
 *                         the request Origin is reflected (same-origin
 *                         deployments work; set ALLOWED_ORIGIN for production).
 *
 * Request (JSON): { provider, model, prompt, diet, meal, count, ingredients, servings }
 *   provider: "openai" | "anthropic" | "custom" | "auto" | omitted.
 *             "custom"/"auto"/omitted = auto-select: OpenAI if its key is set,
 *             else Anthropic if its key is set, else 500.
 * Response: { recipes: [...] } when the provider text parses as JSON,
 *           else { text: "<raw provider text>" } (the app re-parses it).
 * Errors: friendly JSON { error: "..." }. Missing env key -> 500
 *         "AI key not configured on host".
 *
 * Deploy: see DEPLOY-VERCEL.md. This file is NOT cached by the PWA
 * service worker (it is server-side, not part of the app shell).
 */
'use strict';

function stripFences(t) {
  var s = String(t == null ? '' : t).trim();
  s = s.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
  return s;
}

function parseRecipesFromText(text) {
  try {
    var p = JSON.parse(stripFences(text));
    if (Array.isArray(p)) return p;
    if (p && Array.isArray(p.recipes)) return p.recipes;
  } catch (e) { /* not JSON — caller returns {text} */ }
  return null;
}

module.exports = async function handler(req, res) {
  var origin = (req.headers && req.headers.origin) || '';
  var allowedOrigin = process.env.ALLOWED_ORIGIN || process.env.CORS_ORIGIN || '';
  // CORS: same-origin + configurable allowed origin only.
  if (allowedOrigin && origin && origin !== allowedOrigin) {
    res.status(403).json({ error: 'Origin not allowed' });
    return;
  }
  var corsOrigin = allowedOrigin || origin || '*';
  res.setHeader('Access-Control-Allow-Origin', corsOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed — use POST' }); return; }

  var body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { res.status(400).json({ error: 'Invalid JSON body' }); return; }
  }
  body = body || {};

  // NEVER accept a key from the client.
  if (body.apiKey || body.key || body.aiKey || body.api_key) {
    res.status(400).json({ error: 'Do not send an API key from the client — the key lives on the host (Vercel env vars).' });
    return;
  }
  if (!body.prompt || typeof body.prompt !== 'string') {
    res.status(400).json({ error: 'Missing prompt' });
    return;
  }

  var requested = String(body.provider || 'auto').toLowerCase();
  var provider = requested;
  if (provider === 'custom' || provider === 'auto' || provider === '') {
    if (process.env.OPENAI_API_KEY) provider = 'openai';
    else if (process.env.ANTHROPIC_API_KEY) provider = 'anthropic';
    else { res.status(500).json({ error: 'AI key not configured on host' }); return; }
  }
  if (provider !== 'openai' && provider !== 'anthropic') {
    res.status(400).json({ error: 'Unknown provider: ' + requested });
    return;
  }
  var envKey = provider === 'openai' ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY;
  if (!envKey) { res.status(500).json({ error: 'AI key not configured on host' }); return; }

  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, 30000);
  try {
    var upstreamRes, upstreamBody;
    if (provider === 'openai') {
      upstreamBody = {
        model: body.model || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a recipe generator. Return ONLY valid JSON array, no markdown.' },
          { role: 'user', content: body.prompt }
        ],
        temperature: 0.7,
        response_format: { type: 'json_object' }
      };
      upstreamRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + envKey },
        body: JSON.stringify(upstreamBody),
        signal: controller.signal
      });
      var openaiJson = await upstreamRes.json().catch(function () { return null; });
      if (!upstreamRes.ok) {
        res.status(502).json({ error: 'AI provider error (status ' + upstreamRes.status + ')' });
        return;
      }
      var content = openaiJson && openaiJson.choices && openaiJson.choices[0] && openaiJson.choices[0].message && openaiJson.choices[0].message.content;
      var recipes = parseRecipesFromText(content || '');
      if (recipes) { res.status(200).json({ recipes: recipes }); return; }
      res.status(200).json({ text: content || '' });
      return;
    }
    // Anthropic
    upstreamBody = {
      model: body.model || 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: body.prompt }]
    };
    upstreamRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': envKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(upstreamBody),
      signal: controller.signal
    });
    var anthJson = await upstreamRes.json().catch(function () { return null; });
    if (!upstreamRes.ok) {
      res.status(502).json({ error: 'AI provider error (status ' + upstreamRes.status + ')' });
      return;
    }
    var text = anthJson && anthJson.content && anthJson.content[0] && anthJson.content[0].text;
    var recipes2 = parseRecipesFromText(text || '');
    if (recipes2) { res.status(200).json({ recipes: recipes2 }); return; }
    res.status(200).json({ text: text || '' });
  } catch (e) {
    if (e && e.name === 'AbortError') res.status(504).json({ error: 'AI request timed out' });
    else res.status(502).json({ error: 'Could not reach AI provider' });
  } finally {
    clearTimeout(timer);
  }
};
