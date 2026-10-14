# Deploy Fridge Chef to Vercel (AI proxy)

The PWA is static files + one serverless function (`api/ai.js`). The API key
lives **only on Vercel** — never in the app, never in a backup, never in chat.

## Steps

1. **Import the project**
   - Go to [vercel.com/new](https://vercel.com/new) → Import.
   - Upload the `fridge-chef-pwa` folder (or the zip), or import from git.
   - Framework Preset: **Other**. Root Directory: the folder containing
     `index.html` (the `fridge-chef-pwa` folder itself).
   - Build Command: leave empty (static). Output Directory: leave empty / `.`
   - Click **Deploy** once (it will deploy without a key; AI will report
     “not configured” until step 2 — the offline app still works).

2. **Add the API key on the host**
   - Vercel Dashboard → your project → **Settings → Environment Variables**.
   - Add **one** (or both):
     - `OPENAI_API_KEY` = your OpenAI key
     - `ANTHROPIC_API_KEY` = your Anthropic key
   - Scope: Production (and Preview if you want preview deploys to have AI).
   - Optional: `ALLOWED_ORIGIN` = `https://<your-app>.vercel.app` to restrict
     which Origin may call `/api/ai`. Leave unset for same-origin default.
   - **Never** paste the key into the app, into `Settings`, or into any file
     in this folder.

3. **Redeploy**
   - Dashboard → **Deployments** → ⋯ on the latest deployment → **Redeploy**.
   - Env vars only take effect on a fresh deployment.

4. **Configure the app (on your device)**
   - Open your deployed URL → **Settings → AI recipes**.
   - Provider: **Custom proxy (Vercel) — recommended**
   - Endpoint: **`/api/ai`** (same-origin default — no CORS setup needed)
   - **No key in the app.** The key field is hidden in Custom proxy mode.
   - “Use AI when online” checked, “Cache AI recipes for offline” checked.
   - Tap **Save AI settings**. Status should read:
     `AI: ready (Custom proxy) — will use AI when online`

5. **Test**
   - Online: tap any **“with AI”** button (e.g. Cook → Suggest with AI).
     New recipes appear with an **AI** pill and are cached for offline reuse.
   - Offline (Airplane Mode): the same buttons fall back to the 48 built-in
     recipes with a toast saying AI is unavailable. No crash.
   - Browse shows cached AI recipes with an **AI • cached** badge.

## Local development note

Running locally with `python3 -m http.server` has **no** `/api/ai` — the
function only exists on Vercel. The app detects the 404 and shows:

> “AI needs Vercel deploy — see DEPLOY-VERCEL.md”

then falls back to offline recipes. That is expected, not a bug. To test
the proxy locally, use `npx vercel dev` (requires the Vercel CLI + env vars)
instead of `python3 -m http.server`.

## Costs

AI calls are billed to **your** provider account (OpenAI / Anthropic), not to
the app. The proxy adds no markup. Each “with AI” tap makes one provider call.

## Alternative: Netlify

If you prefer Netlify over Vercel, `server/ai-proxy.js` is the equivalent
Netlify-Function-style template (same env vars, same no-client-key rule).
It is an alternative — the Vercel `api/ai.js` above is the primary path.
