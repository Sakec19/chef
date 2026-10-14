# Fridge Chef — Testing

## Automated tests

```bash
node test-pwa.js
node --check app.js
node --check recipes.js
```

`test-pwa.js` (Node, no dependencies) checks:

- Diet filter never leaks disallowed ingredients across all 48 recipes (meat/fish/egg/dairy/honey keyword scan + diets array).
- Recipe counts: ≥12 per diet class, ≥12 per diet in `diets`, balanced breakfast/lunch/dinner, every recipe has id/title/meal/ingredients/steps/nutrition/estCost.
- Quantity parser: `2 cups rice`, `500g rice`, `eggs 6`, `rice 500 g`, `6 eggs`, `1.5 kg chicken breast`, bare `salt`.
- Inventory check math: exact, partial shortfall, missing item, unit conversion (1 kg vs 500 g), incompatible-unit handling.
- Shopping-list aggregation: required − on-hand, grouping, cost math.
- Budget total math.
- Monthly plan: correct day count for the month, restaurant nights count, total cost = sum of dinners, over-budget flag.
- Calendar day toggle: pure function toggles on/off, sorts.
- Manifest is valid JSON with required PWA fields.
- Every `getElementById('…')` / `$('…')` in app.js exists as `id="…"` in index.html.
- Every asset in `sw.js` exists on disk.
- Dark mode: `resolveTheme` (system/light/dark/invalid), pre-paint script before stylesheet, `#themeSeg` options, every used CSS variable defined in both light and dark blocks, no hardcoded light backgrounds in component rules, `sw.js` cache is `fridge-chef-v3`, version `v1.2.0`.
- Chosen-days + preference mode: `scoreRecipeByIngredients` (matches + extras), preference ranking includes 0-match recipes, strict excludes them, cook-days generation (one per day, no repeats, diet still enforced), Also needs excludes pantry items, Cook section IDs + “preference, not a restriction” copy, no “do not use any other” wording.
- Hybrid AI (v1.3.0): `buildAIRecipePrompt` (diet forbiddens + JSON-only + schema), `validateAIRecipe` (accepts good, rejects missing fields / diet violation / bad qty-unit), `normalizeAIRecipes` (fenced JSON + array + `{recipes:[]}`, rejected counted), `mergeAiFirst` (AI-first, dedupe), backup excludes `aiKey` (export strips it, import never overwrites it), Settings + index.html AI controls and AI buttons exist, `sw.js` CACHE is `fridge-chef-v4`, version `v1.3.0`, Vercel `api/ai.js` reads env (not client key) + `vercel.json` + `.env.example` + `DEPLOY-VERCEL.md` exist, Custom proxy sends no Authorization from the browser, default endpoint is `/api/ai`.
- Dark mode: `resolveTheme` (system/light/dark/invalid), pre-paint script before stylesheet, `#themeSeg` options, every used CSS variable defined in both light and dark blocks, no hardcoded light backgrounds in component rules, `sw.js` cache is `fridge-chef-v4`, version `v1.3.0`.
- Polish: no empty-diet fragment, month text uses diet label, recipe cards have meal emoji/class + collapsible steps toggle, shopping progress helper, calendar dot + planned title, empty-state texts, offline banner wording.

Tests print PASS/FAIL per case and exit non-zero on any failure.

## Manual checks (do on a real iPhone — untested)

- [ ] Add to Home Screen from Safari, icon shows.
- [ ] First visit online, then Airplane Mode → app still opens, saved plans/pantry/recipes load.
- [ ] Cook: suggest dish, ingredients mode, pantry add/remove, browse search.
- [ ] Month: generate menu, check budget/overage message, restaurant nights appear, shopping list subtracts pantry.
- [ ] My days: tap days, generate B/L/D plan, check calories/macros show, shopping list builds.
- [ ] Saved: save dish, tick shopping items, share-as-text / copy, backup JSON round-trip, Save offline file opens in Files.
- [ ] Settings: change diet/budget/servings/units, reload, values persist.
- [ ] Bottom tab bar, 44px tap targets, no horizontal scroll, safe-area insets on notched iPhones.
- [ ] Offline banner appears when offline, hides when online.
- [ ] Dark mode: switch System / Light / Dark in Settings, reload, no light flash; cards, inputs, tab bar, calendar and pills all readable in dark.
- [ ] Recipe cards: meal accent + pills show, Show/Hide steps toggles.
- [ ] Shopping: tick items → “X of Y bought” + progress bar updates on all three lists.
- [ ] My-days calendar: planned days show dot + dinner title after generating a plan.
- [ ] Cook → Recipes for chosen days: quick-select Today / Tomorrow / This weekend / Next 3 / Next 7 / Clear updates the selection, Generate gives one recipe per day (or B/L/D for Full day), Uses / Also needs lines show, Send to shopping adds Also needs, share/copy text includes Uses / Also needs.
- [ ] Cook → Your-own-ingredients: default shows diet-allowed recipes ranked by overlap (including 0-match), checking “Only show recipes using my ingredients” filters to matches-only, Show all expands beyond top 8.
- [ ] My days: per-meal Uses your / Also needs lines show for hint ingredients.
- [ ] AI (needs Vercel deploy + key on host, online): Settings → AI provider = Custom proxy, endpoint `/api/ai`, no key in app → Suggest with AI returns new validated recipes with AI pill; Generate with AI on Cook / Month / My days merges AI-first + offline fallback; turning on Airplane Mode falls back to offline with a toast. AI cache survives reload and shows “AI • cached” in Browse; Clear AI cache empties it. Backup JSON contains no `aiKey`.
- [ ] Diet still strict in preference mode: vegan + wanted chicken shows no chicken recipes.
- [ ] AI (direct-key fallback, if used): OpenAI/Anthropic with a browser key works, key field is password type, key never appears in backup JSON.

## Known limits (by design)

- Prices / calories / nutrients are estimates.
- AI integration is **untested live** — no real API call was made during the build (no key available). It needs the user’s key/endpoint on Vercel + an online test. On-device AI visuals are untested.
- Real-iPhone behaviour is **untested** until someone verifies it on a device, including on-device dark-mode visuals.
