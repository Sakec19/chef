/* Fridge Chef — AI proxy template (ALTERNATIVE to Vercel api/ai.js).
 * Netlify-Function-style handler. No dependencies. No hardcoded keys.
 *
 * The Vercel function at api/ai.js is the PRIMARY path (see DEPLOY-VERCEL.md).
 * This file is an alternative for Netlify / other hosts. It is NOT part of
 * the PWA bundle and is NOT cached by sw.js.
 *
 * Env vars: OPENAI_API_KEY and/or ANTHROPIC_API_KEY (on the host only).
 * Optional: ALLOWED_ORIGIN to restrict the calling Origin.
 *
 * Request (POST JSON): { provider, model, prompt, diet, meal, count, ingredients, servings }
 * Response: { recipes: [...] } or { text: "..." }.
 * NEVER accept a key from the client — reject bodies containing apiKey/key/aiKey.
 * NEVER log keys.
 *
 * Netlify: place in netlify/functions/ai.js and call it from the app with
 *   provider = Custom proxy, endpoint = /.netlify/functions/ai
 * Cloudflare Workers: adapt the handler signature to (request, env) and read
 *   env.OPENAI_API_KEY / env.ANTHROPIC_API_KEY; CORS: allow only the user's origin.
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
  } catch (e) {}
  return null;
}

exports.handler = async function (event, context) {
  var headers = { 'Content-Type': 'application/json' };
  var allowedOrigin = process.env.ALLOWED_ORIGIN || process.env.CORS_ORIGIN || '';
  var origin = (event.headers && (event.headers.origin || event.headers.Origin)) || '';
  if (allowedOrigin && origin && origin !== allowedOrigin) {
    return { statusCode: 403, headers: headers, body: JSON.stringify({ error: 'Origin not allowed' }) };
  }
  headers['Access-Control-Allow-Origin'] = allowedOrigin || origin || '*';
  headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
  headers['Access-Control-Allow-Headers'] = 'Content-Type';
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: headers, body: JSON.stringify({ error: 'Method not allowed — use POST' }) };

  var body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return { statusCode: 400, headers: headers, body: JSON.stringify({ error: 'Invalid JSON body' }) }; }
  if (body.apiKey || body.key || body.aiKey || body.api_key) {
    return { statusCode: 400, headers: headers, body: JSON.stringify({ error: 'Do not send an API key from the client — the key lives on the host.' }) };
  }
  if (!body.prompt || typeof body.prompt !== 'string') {
    return { statusCode: 400, headers: headers, body: JSON.stringify({ error: 'Missing prompt' }) };
  }
  var requested = String(body.provider || 'auto').toLowerCase();
  var provider = requested;
  if (provider === 'custom' || provider === 'auto' || provider === '') {
    if (process.env.OPENAI_API_KEY) provider = 'openai';
    else if (process.env.ANTHROPIC_API_KEY) provider = 'anthropic';
    else return { statusCode: 500, headers: headers, body: JSON.stringify({ error: 'AI key not configured on host' }) };
  }
  if (provider !== 'openai' && provider !== 'anthropic') {
    return { statusCode: 400, headers: headers, body: JSON.stringify({ error: 'Unknown provider: ' + requested }) };
  }
  var envKey = provider === 'openai' ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY;
  if (!envKey) return { statusCode: 500, headers: headers, body: JSON.stringify({ error: 'AI key not configured on host' }) };

  try {
    var res, data;
    if (provider === 'openai') {
      res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + envKey },
        body: JSON.stringify({
          model: body.model || 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are a recipe generator. Return ONLY valid JSON array, no markdown.' },
            { role: 'user', content: body.prompt }
          ],
          temperature: 0.7,
          response_format: { type: 'json_object' }
        })
      });
      data = await res.json().catch(function () { return null; });
      if (!res.ok) return { statusCode: 502, headers: headers, body: JSON.stringify({ error: 'AI provider error (status ' + res.status + ')' }) };
      var content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      var recipes = parseRecipesFromText(content || '');
      return { statusCode: 200, headers: headers, body: JSON.stringify(recipes ? { recipes: recipes } : { text: content || '' }) };
    }
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': envKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: body.model || 'claude-sonnet-4-20250514', max_tokens: 4000, messages: [{ role: 'user', content: body.prompt }] })
    });
    data = await res.json().catch(function () { return null; });
    if (!res.ok) return { statusCode: 502, headers: headers, body: JSON.stringify({ error: 'AI provider error (status ' + res.status + ')' }) };
    var text = data && data.content && data.content[0] && data.content[0].text;
    var recipes2 = parseRecipesFromText(text || '');
    return { statusCode: 200, headers: headers, body: JSON.stringify(recipes2 ? { recipes: recipes2 } : { text: text || '' }) };
  } catch (e) {
    return { statusCode: 502, headers: headers, body: JSON.stringify({ error: 'Could not reach AI provider' }) };
  }
};
