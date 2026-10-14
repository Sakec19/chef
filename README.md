# Fridge Chef — Standalone Offline PWA (v1.3.0)

Offline recipe and meal-planning app. No Claude sign-in, no account. 48 built-in
recipes always work offline; optional hybrid AI pulls NEW recipes when online.

## Hybrid AI (v1.3.0)

- **Offline first:** the 48 built-in recipes always work, with no key, no network.
- **When online AND AI is configured,** the “with AI” buttons (Suggest with AI,
  Find with AI, Generate with AI on Cook / Month / My days) pull NEW recipes
  from AI, validate them, diet-check them strictly, and merge them AI-first
  with offline recipes to fill the plan. If AI fails (offline, not configured,
  unauthorized, timeout, bad response), the app toasts
  “AI unavailable (reason) — using offline recipes” and falls back to the
  offline engine. No crash.
- **Caching:** AI recipes that pass validation are cached locally (max 100,
  deduped by title) and reused offline later. Browse shows them with an
  “AI • cached” badge; every AI card shows an **AI** pill +
  “Estimates only — AI recipe, check quantities”. Diet + pantry quantity
  checks apply to AI recipes exactly like offline ones.
- **Recommended path — Custom proxy (Vercel):** the API key lives **only on
  the host** (Vercel env vars). The app sends NO key. See `DEPLOY-VERCEL.md`:
  import to Vercel → add `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` in
  Dashboard → Settings → Environment Variables → redeploy → in the app set
  Settings → AI provider = Custom proxy, endpoint = `/api/ai` (same-origin),
  no key in the app. When running locally via `python3 -m http.server`,
  `/api/ai` 404s — the app shows “AI needs Vercel deploy — see
  DEPLOY-VERCEL.md” and falls back to offline.
- **Fallback — direct-key modes:** OpenAI-compatible / Anthropic with a key
  typed into Settings (password field, stored only in that device’s
  localStorage). These send the key from the browser to the provider and are
  labelled “browser key — less secure”. Use Custom proxy when possible.
- **Alternative proxy template:** `server/ai-proxy.js` is a Netlify-Function-style
  equivalent (same env vars, same no-client-key rule). Vercel `api/ai.js` is primary.
- **Costs are yours:** AI calls are billed to your provider account. AI recipes
  are estimates and still diet/quantity-checked. Offline always works.

## What it does

- **Cook** — Single-dish suggester, your-own-ingredients mode (preference by default, optional strict), **recipes for chosen days** (pick days + meal, one recipe per day or full B/L/D day), pantry/inventory, browse all recipes.
- **Month** — 30/31-day dinner menu, restaurant nights, under-$100 budget (keeps cheapest list found, asks how much over $100 you accept via the overage input), monthly shopping list.
- **My days** — Tap days on a calendar, list ingredients, get breakfast/lunch/dinner per day with calories, protein, carbs, fat and nutritional benefits.
- **Saved** — Saved dishes/plans, tickable shopping list, share-as-text for Notes, backup/restore (JSON), **Save offline file** (exports everything as one HTML file for the Files app).
- **Settings** — Appearance (System / Light / Dark, applied before first paint), default diet, budget, overage, servings, units, AI settings (provider / Use AI when online / key / model / endpoint / cache AI recipes, Clear AI cache), optional custom AI endpoint (off by default, never called unless you set it).

## Strict diet rule

Diet dropdown: Omnivore, Vegetarian (eggs OK), Vegetarian no eggs, Vegan.

The diet is a **strict rule**, enforced twice:
1. Each recipe declares which diets it is allowed for.
2. A code check scans ingredients for meat / fish / eggs / dairy / honey keywords (with word-boundary matching so “eggplant” ≠ egg, “peanut butter” ≠ dairy butter, plant milks ≠ dairy milk) and drops disallowed recipes. Disallowed recipes are never shown.

## Ingredient-quantity checking (new)

Pantry entries include quantities, e.g. `eggs 6`, `rice 500 g`, `milk 1 l`.

- Parser accepts `2 cups rice`, `500g rice`, `eggs 6`, `rice 500 g`, `6 eggs`.
- Every recipe shows **“You have enough”** or **“Missing: …”** with shortfall amounts.
- Shopping lists are **required − on-hand**: pantry stock is subtracted, including unit conversion (kg↔g, l↔ml, cups↔ml, etc.). Incompatible units (e.g. cups vs grams for the same item) are flagged as a unit mismatch and treated as missing rather than silently assumed.

## Ingredients are a preference, not a restriction (v1.2.0)

- Your listed ingredients now **rank** recipes — they do not restrict them. Recipes may use other ingredients.
- Every result shows **“Uses X of your ingredient(s)”** plus **“Also needs: …”** for ingredients not in your list and not already in your pantry. Also-needs items go into the shopping list.
- Optional strict checkboxes (“Only show recipes using my ingredients”) restore the old matches-only behaviour in Your-own-ingredients mode and in Recipes for chosen days. Default is unchecked (preference mode).
- **Diet stays a strict rule** — vegan / vegetarian / vegetarian-no-eggs / omnivore filtering is unchanged and never relaxed by preference mode.

## Recipes for chosen days (v1.2.0)

- New Cook section sharing the same selected-days state as the My Days calendar — picking in either place stays in sync.
- Quick-select: Today, Tomorrow, This weekend (next Sat + Sun), Next 3 days, Next 7 days, Clear, plus “Pick on calendar” to jump to My Days.
- Meal selector: Dinner / Breakfast / Lunch / Any single meal / Full day (B/L/D). One recipe per selected day (or B/L/D per day), no repeats while the pool allows it, with shopping (required − on-hand), share/copy, and persistence.

## UI polish (v1.1.0)

- Dark mode: System / Light / Dark in Settings, pre-paint script so there is no light flash, `theme-color` adapts, and the choice persists with your other settings.
- Recipe cards: meal emoji + meal-tinted top accent (🍳 breakfast / 🥗 lunch / 🍽️ dinner), pills for meal, diet, minutes, est. cost and calories, and collapsible steps (first 2 steps shown, “Show steps” reveals the rest).
- Shopping progress: “X of Y bought” + progress bar on the main, monthly, and my-days shopping lists; updates when you tick items.
- Calendar: days with a my-days plan show a dot + the dinner title under the day number.
- Friendly empty states for Saved, shopping, and Browse; offline banner now correctly says everything works offline.
- Month share text now shows the real diet label + restaurant-night count (previously an empty “Diet: ” line).

## Estimates disclaimer

**All prices, calories and nutrients are estimates** from the built-in offline recipe engine. They are not verified nutrition or store prices. The app cannot verify recipes stay within real store pack sizes — it checks against the quantities you enter.

## Files

- `index.html` — app shell + all views
- `styles.css` — calm, iPhone-friendly styles
- `app.js` — UI, storage, calendar, shopping, sharing, export
- `recipes.js` — 48 recipes + pure helpers (diet filter, quantity parser, inventory check, shopping aggregation, monthly plan, calendar toggle) + AI prompt / validate / normalize / merge helpers (no network, no keys)
- `api/ai.js` — Vercel Serverless Function: AI proxy (key from host env vars only, never from client)
- `vercel.json` — routes `/api/*` to the function, everything else serves the static PWA
- `.env.example` — `OPENAI_API_KEY=` / `ANTHROPIC_API_KEY=` placeholders (no real values)
- `DEPLOY-VERCEL.md` — exact Vercel deploy steps
- `server/ai-proxy.js` — alternative Netlify-Function-style proxy template (not part of the PWA bundle, not cached by sw.js)
- `manifest.webmanifest`, `sw.js` — PWA install + offline cache (sw.js does NOT cache `api/` or `server/`)
- `manifest.webmanifest`, `sw.js` — PWA install + offline cache
- `icon.svg`, `icon-192.png`, `icon-512.png` — original icons (no brand logos)
- `test-pwa.js` — Node tests, no dependencies

## Run locally

```bash
cd fridge-chef-pwa
python3 -m http.server 8000
# open http://localhost:8000/
node test-pwa.js
```

## Untested on real device

Not tested on a real iPhone. See `TESTING.md`. Tested in Node (`test-pwa.js`) and by code inspection only. In particular: Add to Home Screen flow, true offline loading on iOS, visual layout on a real phone, and on-device dark-mode appearance are **untested** — please verify on your phone before relying on it. **AI integration is untested live: no real API call was made during this build** (no key was available, and none was requested). Live AI needs the user’s key/endpoint + an online test (see `DEPLOY-VERCEL.md`); on-device AI visuals are also untested.

## Privacy

Everything stays on the device (localStorage key `fridgechef.v1`) unless you tap Share / Export / Save offline file. No analytics. **Your API key is never included in backups, in the offline HTML export, or in chat.** In Custom proxy mode no key is stored in the app at all — it lives only on the host (Vercel env vars) and is sent only from the host to the provider. In direct-key mode the key is stored only in that device’s localStorage and sent only from your browser to the provider you chose. AI prompts contain your diet / meal / ingredients for that request — nothing else leaves the device.
