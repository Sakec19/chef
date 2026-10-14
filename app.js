/* Fridge Chef — app logic. All local. No network calls except service worker registration (in index.html).
 * Prices / nutrition are ESTIMATES. Diet is a strict rule enforced by recipes.js.
 */
(function () {
  'use strict';
  var FC = (typeof window !== 'undefined' && window.FridgeChef) ? window.FridgeChef : null;
  var LS_KEY = 'fridgechef.v1';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function money(n) { return '$' + (Math.round((Number(n) || 0) * 100) / 100).toFixed(2); }

  var state = {
    settings: { diet: 'omnivore', budget: 100, overage: 0, servings: 2, units: 'metric', aiEndpoint: '/api/ai', theme: 'system', aiProvider: 'custom', aiEnabled: true, aiKey: '', aiModel: 'gpt-4o-mini', aiCache: true },
    aiRecipes: [],
    pantry: [],
    saved: [],
    shopping: [],
    shoppingTicks: {},
    selectedDays: [],
    myDaysYear: new Date().getFullYear(),
    myDaysMonth: new Date().getMonth(),
    monthPlan: null,
    myDaysPlan: null,
    myDaysHint: [],
    monthShopping: [],
    myDaysShopping: [],
    cookDaysPlan: null,
    cookDaysShopping: [],
    cookDaysWanted: []
  };
  var lastCookScored = null;
  var cookShowAll = false;

  function load() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      var d = JSON.parse(raw);
      if (d.settings) {
        state.settings = Object.assign(state.settings, d.settings);
        if (['system', 'light', 'dark'].indexOf(state.settings.theme) === -1) state.settings.theme = 'system';
        // Migrate pre-v1.3.0 settings: no AI provider stored -> Custom proxy (Vercel) default.
        if (!d.settings.aiProvider) state.settings.aiProvider = 'custom';
        if (typeof state.settings.aiEndpoint !== 'string' || !state.settings.aiEndpoint) state.settings.aiEndpoint = '/api/ai';
        if (typeof state.settings.aiEnabled !== 'boolean') state.settings.aiEnabled = true;
        if (typeof state.settings.aiCache !== 'boolean') state.settings.aiCache = true;
        if (!state.settings.aiModel) state.settings.aiModel = FC.AI_DEFAULT_MODELS[state.settings.aiProvider] || 'gpt-4o-mini';
      }
      if (Array.isArray(d.aiRecipes)) state.aiRecipes = d.aiRecipes;
      if (Array.isArray(d.pantry)) state.pantry = d.pantry;
      if (Array.isArray(d.saved)) state.saved = d.saved;
      if (Array.isArray(d.shopping)) state.shopping = d.shopping;
      if (d.shoppingTicks) state.shoppingTicks = d.shoppingTicks;
      if (Array.isArray(d.selectedDays)) state.selectedDays = d.selectedDays;
      if (d.monthPlan) state.monthPlan = d.monthPlan;
      if (d.myDaysPlan) state.myDaysPlan = d.myDaysPlan;
      if (Array.isArray(d.myDaysHint)) state.myDaysHint = d.myDaysHint;
      if (Array.isArray(d.monthShopping)) state.monthShopping = d.monthShopping;
      if (Array.isArray(d.myDaysShopping)) state.myDaysShopping = d.myDaysShopping;
      if (d.cookDaysPlan) state.cookDaysPlan = d.cookDaysPlan;
      if (Array.isArray(d.cookDaysShopping)) state.cookDaysShopping = d.cookDaysShopping;
      if (Array.isArray(d.cookDaysWanted)) state.cookDaysWanted = d.cookDaysWanted;
    } catch (e) { /* corrupted storage: start fresh */ }
  }
  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) {}
  }

  /* ---------------- AI (v1.3.0, hybrid) ----------------
   * Offline engine always works. AI is used only when the user taps an
   * "with AI" button, is online, and AI is configured. The API key is NEVER
   * logged, never sent in Custom proxy mode, and never included in backups. */
  function aiProviderLabel(p) {
    return p === 'openai' ? 'OpenAI' : p === 'anthropic' ? 'Anthropic' : p === 'custom' ? 'Custom proxy' : 'Off';
  }
  function aiEndpointFor(provider) {
    var ep = (state.settings.aiEndpoint || '').trim();
    if (ep) return ep;
    return (FC.AI_DEFAULT_ENDPOINTS && FC.AI_DEFAULT_ENDPOINTS[provider]) || '/api/ai';
  }
  function aiConfigured() {
    if (!state.settings.aiEnabled) return false;
    var p = state.settings.aiProvider || 'off';
    if (p === 'off') return false;
    if (p === 'custom') return !!aiEndpointFor('custom');
    // Direct-key modes need a key.
    return !!(state.settings.aiKey && state.settings.aiKey.trim()) && !!aiEndpointFor(p);
  }
  function aiStatusText() {
    var p = state.settings.aiProvider || 'off';
    if (!state.settings.aiEnabled || p === 'off') return 'AI: off';
    if (p === 'custom') return 'AI: ready (Custom proxy) — will use AI when online';
    if (state.settings.aiKey && state.settings.aiKey.trim()) return 'AI: ready (' + aiProviderLabel(p) + ') — will use AI when online';
    return 'AI: not configured — using offline recipes';
  }
  function refreshAiStatus() {
    var t = aiStatusText();
    var main = $('aiStatus');
    if (main) main.textContent = t;
    document.querySelectorAll('.ai-status-line').forEach(function (el) { el.textContent = t; });
    return t;
  }
  function mergeAiCache(newRecipes) {
    if (!state.settings.aiCache) return;
    var merged = FC.dedupeAiRecipes((state.aiRecipes || []).concat(newRecipes || []));
    state.aiRecipes = merged.slice(-100);
    save();
  }
  function findRecipeById(id) {
    var r = FC.RECIPES.find(function (x) { return x.id === id; });
    if (r) return r;
    r = (state.aiRecipes || []).find(function (x) { return x.id === id; });
    if (r) return r;
    var pools = [];
    if (state.cookDaysPlan) state.cookDaysPlan.forEach(function (d) { Object.keys(d.meals || {}).forEach(function (m) { if (d.meals[m]) pools.push(d.meals[m]); }); });
    if (state.myDaysPlan) state.myDaysPlan.forEach(function (d) { ['breakfast', 'lunch', 'dinner'].forEach(function (m) { if (d.meals[m]) pools.push(d.meals[m]); }); });
    if (state.monthPlan) state.monthPlan.days.forEach(function (d) { if (d.recipe) pools.push(d.recipe); });
    return pools.find(function (x) { return x.id === id; }) || null;
  }
  function stripAiKeyFromState(obj) {
    var copy = JSON.parse(JSON.stringify(obj || {}));
    if (copy.settings) delete copy.settings.aiKey;
    return copy;
  }
  async function fetchAIRecipes(opts) {
    opts = opts || {};
    if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error('offline — you are offline, using offline recipes');
    if (!state.settings.aiEnabled || (state.settings.aiProvider || 'off') === 'off') throw new Error('not-configured — AI is off');
    var provider = state.settings.aiProvider || 'custom';
    var endpoint = aiEndpointFor(provider);
    if (provider !== 'custom' && (!state.settings.aiKey || !state.settings.aiKey.trim())) throw new Error('not-configured — no API key set in Settings');
    if (!endpoint) throw new Error('not-configured — no AI endpoint set in Settings');
    var diet = opts.diet || state.settings.diet;
    var meal = opts.meal || 'any';
    var count = opts.count != null ? opts.count : 3;
    var servings = opts.servings != null ? opts.servings : state.settings.servings;
    var ingredients = opts.ingredients || [];
    var prompt = FC.buildAIRecipePrompt({ diet: diet, meal: meal, count: count, ingredients: ingredients, servings: servings, days: opts.days || [] });
    var model = (state.settings.aiModel || '').trim() || (FC.AI_DEFAULT_MODELS[provider] || 'gpt-4o-mini');
    var controller = null, timeoutId = null;
    try { controller = new AbortController(); } catch (e) { controller = null; }
    if (controller) timeoutId = setTimeout(function () { try { controller.abort(); } catch (e) {} }, 30000);
    var res, data;
    try {
      var headers = { 'Content-Type': 'application/json' };
      var body;
      if (provider === 'openai') {
        headers['Authorization'] = 'Bearer ' + state.settings.aiKey;
        body = { model: model, messages: [{ role: 'system', content: 'You are a recipe generator. Return ONLY valid JSON array, no markdown.' }, { role: 'user', content: prompt }], temperature: 0.7 };
        if (endpoint.indexOf('api.openai.com') !== -1) body.response_format = { type: 'json_object' };
      } else if (provider === 'anthropic') {
        headers['x-api-key'] = state.settings.aiKey;
        headers['anthropic-version'] = '2023-06-01';
        body = { model: model, max_tokens: 4000, messages: [{ role: 'user', content: prompt }] };
      } else {
        // Custom proxy (Vercel): NEVER send a key from the browser. Key lives on the host.
        body = { provider: provider, model: model, prompt: prompt, diet: diet, meal: meal, count: count, ingredients: ingredients, servings: servings };
      }
      var fetchOpts = { method: 'POST', headers: headers, body: JSON.stringify(body) };
      if (controller) fetchOpts.signal = controller.signal;
      res = await fetch(endpoint, fetchOpts);
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('timeout — AI request timed out after 30s');
      if (e && /Failed to fetch|NetworkError|Load failed/i.test(String(e && e.message || e))) throw new Error('bad-response — could not reach the AI endpoint');
      throw e;
    } finally { if (timeoutId) clearTimeout(timeoutId); }
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) throw new Error('unauthorized — API key rejected (check key / host env var)');
      if ((res.status === 404 || res.status === 501) && provider === 'custom') throw new Error('AI needs Vercel deploy — see DEPLOY-VERCEL.md');
      var errText = '';
      try { var ej = await res.json(); errText = (ej && (ej.error || ej.message)) || ''; } catch (e) {}
      if (errText && /AI key not configured on host/i.test(errText)) throw new Error('not-configured — AI key not configured on host (add it in Vercel > Settings > Environment Variables)');
      throw new Error('bad-response — AI endpoint returned status ' + res.status + (errText ? ': ' + String(errText).slice(0, 120) : ''));
    }
    try { data = await res.json(); } catch (e) { throw new Error('bad-response — AI endpoint returned invalid JSON'); }
    var raw;
    if (provider === 'openai') raw = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    else if (provider === 'anthropic') raw = data && data.content && data.content[0] && data.content[0].text;
    else raw = (data && (data.recipes || data.text)) || data;
    var norm = FC.normalizeAIRecipes(raw, diet, { servings: servings });
    if (!norm.recipes.length) throw new Error('bad-response — AI returned no valid recipes' + (norm.rejected.length ? ' (' + norm.rejected.length + ' rejected)' : ''));
    mergeAiCache(norm.recipes);
    return norm.recipes;
  }
  if (typeof window !== 'undefined') {
    window.FridgeChefApp = window.FridgeChefApp || {};
    window.FridgeChefApp.aiStatusText = aiStatusText;
    window.FridgeChefApp.fetchAIRecipes = fetchAIRecipes;
    window.FridgeChefApp.stripAiKeyFromState = stripAiKeyFromState;
  }

  /* ---------------- theme ---------------- */
  function resolveTheme(setting, prefersDark) {
    if (setting === 'dark') return 'dark';
    if (setting === 'light') return 'light';
    return prefersDark ? 'dark' : 'light'; // 'system' or unknown falls back to device
  }
  function devicePrefersDark() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); }
    catch (e) { return false; }
  }
  function applyTheme() {
    var t = resolveTheme(state.settings.theme, devicePrefersDark());
    try {
      document.documentElement.dataset.theme = t;
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', t === 'dark' ? '#1C1A16' : '#4A7A5A');
    } catch (e) {}
  }
  function refreshThemeSeg() {
    var seg = document.querySelectorAll('#themeSeg button');
    if (!seg.length) return;
    seg.forEach(function (b) {
      var on = b.getAttribute('data-theme-opt') === state.settings.theme;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
  }
  if (typeof window !== 'undefined') window.FridgeChefApp = { resolveTheme: resolveTheme };

  function dietLabel(diet) {
    var map = {
      'omnivore': 'Omnivore',
      'vegetarian': 'Vegetarian (eggs OK)',
      'vegetarian-no-eggs': 'Vegetarian, no eggs',
      'vegan': 'Vegan'
    };
    return map[diet] || 'Omnivore';
  }

  function parseWantedItems(raw) {
    if (!raw) return [];
    return raw.split(/[\n,]+/).map(function (s) { return FC.parseQuantity(s.trim()).item; }).filter(Boolean);
  }
  function localISO(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function addDaysISO(isoOrDate, days) {
    var d = isoOrDate instanceof Date ? new Date(isoOrDate) : new Date(isoOrDate + 'T12:00:00');
    d.setDate(d.getDate() + days);
    return localISO(d);
  }
  // "Uses X of your ingredients" + "Also needs" lines for a recipe.
  // Also needs = recipe ingredients NOT in wanted AND NOT already in pantry.
  function usesAlsoHtml(recipe, wantedItems) {
    var wanted = wantedItems || [];
    if (!wanted.length) {
      var alsoOnly = FC.alsoNeedsExcludingPantry(recipe, [], state.pantry);
      if (!alsoOnly.length) return '<div class="sub">✓ All ingredients already in pantry.</div>';
      return '<div class="sub"><strong>Also needs:</strong> ' + esc(alsoOnly.map(function (e) { return e.item + ' ' + e.qty + ' ' + e.unit; }).join(', ')) + '</div>';
    }
    var used = FC.usedWantedItems(recipe, wanted);
    var also = FC.alsoNeedsExcludingPantry(recipe, wanted, state.pantry);
    var html = '<div class="sub"><strong>Uses ' + used.length + ' of your ingredient(s):</strong> ' + esc(used.length ? used.join(', ') : 'none yet — this is a preference, other ingredients will be listed below') + '</div>';
    if (also.length) html += '<div class="sub"><strong>Also needs:</strong> ' + esc(also.map(function (e) { return e.item + ' ' + e.qty + ' ' + e.unit; }).join(', ')) + '</div>';
    else html += '<div class="sub">✓ No extra ingredients needed beyond pantry / your list.</div>';
    return html;
  }

  function shoppingProgressHtml(list) {
    if (!list || !list.length) return '';
    var bought = 0;
    list.forEach(function (s) {
      if (state.shoppingTicks[s.item + '|' + s.unit]) bought++;
    });
    var pct = Math.round((bought / list.length) * 100);
    return '<div class="shop-progress"><div class="shop-progress-text">' + bought + ' of ' + list.length + ' bought</div>' +
      '<div class="shop-progress-bar"><div class="shop-progress-fill" style="width:' + pct + '%"></div></div>' +
      '<progress value="' + bought + '" max="' + list.length + '" aria-label="Shopping progress" style="display:none"></progress></div>';
  }

  var toastTimer = null;
  function toast(msg) {
    var el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.add('hidden'); }, 2600);
  }

  function scaledRecipe(recipe, servings) {
    var factor = (Number(servings) || 2) / 2;
    var copy = Object.assign({}, recipe);
    copy.ingredients = (recipe.ingredients || []).map(function (ing) {
      return { item: ing.item, qty: Math.round(ing.qty * factor * 100) / 100, unit: ing.unit };
    });
    copy.estCost = Math.round((recipe.estCost || 0) * factor * 100) / 100;
    copy.servingsUsed = servings;
    return copy;
  }

  function formatQty(qty, unit) {
    if (state.settings.units === 'us') {
      var n = FC.normalizeUnit(unit);
      if (n === 'g') return (Math.round((qty / 28.35) * 100) / 100) + ' oz';
      if (n === 'kg') return (Math.round((qty * 35.274) * 100) / 100) + ' oz';
      if (n === 'ml') return (Math.round((qty / 240) * 100) / 100) + ' cups';
      if (n === 'l') return (Math.round((qty * 4.227) * 100) / 100) + ' cups';
    }
    return qty + ' ' + unit;
  }

  function pantryStatusHtml(recipe, servings) {
    var scaled = scaledRecipe(recipe, servings);
    var check = FC.checkInventory(scaled, state.pantry);
    if (check.hasEnough) return '<span class="pill ok">✓ You have enough</span>';
    var missingText = check.missing.map(function (m) {
      return esc(m.item) + ' ' + esc(m.qty + ' ' + m.unit) + (m.unitMismatch ? ' (unit mismatch)' : '');
    }).join(', ');
    return '<span class="pill warn">Missing: ' + missingText + '</span>';
  }

  function recipeCardHtml(recipe, servings) {
    var s = scaledRecipe(recipe, servings || state.settings.servings);
    var meal = recipe.meal || 'dinner';
    var mealMeta = {
      'breakfast': { ico: '🍳', cls: 'meal-breakfast', label: 'Breakfast' },
      'lunch': { ico: '🥗', cls: 'meal-lunch', label: 'Lunch' },
      'dinner': { ico: '🍽️', cls: 'meal-dinner', label: 'Dinner' }
    };
    var mm = mealMeta[meal] || mealMeta['dinner'];
    var ings = s.ingredients.map(function (ing) {
      return '<li>' + esc(formatQty(ing.qty, ing.unit)) + ' ' + esc(ing.item) + '</li>';
    }).join('');
    var steps = (recipe.steps || []).map(function (st, i) {
      return '<li>' + esc(st) + '</li>';
    }).join('');
    var firstSteps = (recipe.steps || []).slice(0, 2).map(function (st) {
      return '<li>' + esc(st) + '</li>';
    }).join('');
    var hasMore = (recipe.steps || []).length > 2 || (s.ingredients || []).length > 4;
    var aiPill = recipe.source === 'ai' ? '<span class="pill ai-pill">' + (recipe.cachedAt ? 'AI • cached' : 'AI') + '</span>' : '';
    var aiNote = recipe.source === 'ai' ? '<div class="sub ai-note">Estimates only — AI recipe, check quantities</div>' : '';
    return '<div class="item recipe-card ' + mm.cls + '"><div class="main">' +
      '<div class="title"><span class="meal-ico" aria-hidden="true">' + mm.ico + '</span>' + esc(recipe.title) + '</div>' +
      '<div><span class="pill">' + mm.ico + ' ' + mm.label + '</span>' +
      aiPill +
      '<span class="pill">' + esc(dietLabel(recipe.dietClass)) + '</span>' +
      '<span class="pill">' + recipe.minutes + ' min</span>' +
      '<span class="pill">est ' + money(s.estCost) + '</span>' +
      '<span class="pill">' + recipe.calories + ' kcal</span></div>' +
      '<div class="sub">Calories ' + recipe.calories + ' · Protein ' + recipe.protein + 'g · Carbs ' + recipe.carbs + 'g · Fat ' + recipe.fat + 'g</div>' +
      '<div class="sub">' + esc(recipe.benefits || '') + '</div>' +
      aiNote +
      '<div style="margin-top:6px">' + pantryStatusHtml(recipe, servings || state.settings.servings) + '</div>' +
      '<ul class="recipe-meta recipe-ingredients" style="margin:8px 0 4px 18px; padding:0">' + ings + '</ul>' +
      '<ol class="recipe-meta recipe-steps" style="margin:4px 0 4px 18px; padding:0">' + firstSteps + '</ol>' +
      '<div class="recipe-more collapsed" style="display:none"><ol class="recipe-meta" style="margin:4px 0 4px 18px; padding:0">' + steps + '</ol></div>' +
      (hasMore ? '<button class="btn small" data-action="toggle-recipe-steps" aria-expanded="false">Show steps</button>' : '') +
      '<div class="btn-grid" style="margin-top:8px">' +
      '<button class="btn small" data-action="save-recipe" data-id="' + esc(recipe.id) + '">Save dish</button>' +
      '<button class="btn small" data-action="add-recipe-shopping" data-id="' + esc(recipe.id) + '">Add to shopping</button>' +
      '</div>' +
      '</div></div>';
  }

  function renderPantry() {
    var el = $('pantryList');
    var countEl = $('pantryCount');
    if (countEl) countEl.textContent = '(' + state.pantry.length + ' items)';
    if (!el) return;
    if (!state.pantry.length) { el.innerHTML = '<p class="empty">Pantry is empty. Add items like “eggs 6”.</p>'; return; }
    el.innerHTML = state.pantry.map(function (p, idx) {
      return '<div class="item"><div class="main"><div class="title">' + esc(p.item) + '</div><div class="sub">' + esc(p.qty + ' ' + p.unit) + '</div></div>' +
        '<button class="btn small" data-action="remove-pantry" data-index="' + idx + '">Remove</button></div>';
    }).join('');
  }

  function renderBrowse() {
    var el = $('recipeBrowseList');
    if (!el) return;
    var q = ($('recipeSearch') ? $('recipeSearch').value : '').toLowerCase().trim();
    var diet = $('cookDiet') ? $('cookDiet').value : state.settings.diet;
    var pool = FC.filterRecipesByDiet(FC.RECIPES.concat(state.aiRecipes || []), diet);
    if (q) {
      pool = pool.filter(function (r) {
        var hay = (r.title + ' ' + r.ingredients.map(function (i) { return i.item; }).join(' ')).toLowerCase();
        return hay.indexOf(q) !== -1;
      });
    }
    if (!pool.length) { el.innerHTML = '<p class="empty">No recipes match — try clearing the search.</p>'; return; }
    el.innerHTML = pool.slice(0, 30).map(function (r) { return recipeCardHtml(r, state.settings.servings); }).join('') +
      (pool.length > 30 ? '<p class="hint">Showing 30 of ' + pool.length + ' matching recipes.</p>' : '');
  }

  function renderShoppingListInto(el, list) {
    if (!list.length) { el.innerHTML = '<p class="empty">Shopping list is empty.</p>'; return; }
    el.innerHTML = shoppingProgressHtml(list) + list.map(function (s, idx) {
      var key = s.item + '|' + s.unit;
      var checked = state.shoppingTicks[key] ? 'checked' : '';
      var cls = state.shoppingTicks[key] ? 'done' : '';
      return '<div class="check-row item"><input type="checkbox" data-shopping-check="' + esc(key) + '" ' + checked + '>' +
        '<label class="' + cls + '">' + esc(s.item) + ' — ' + esc(s.qty + ' ' + s.unit) + ' · est ' + money(s.estCost || 0) + '</label>' +
        '<button class="btn small" data-action="remove-shopping" data-index="' + idx + '">✕</button></div>';
    }).join('');
  }

  function renderShopping() {
    var el = $('shoppingList');
    if (el) renderShoppingListInto(el, state.shopping);
    var totalEl = $('shoppingTotal');
    if (totalEl) totalEl.textContent = money(FC.computeShoppingCost(state.shopping));
    var textEl = $('shoppingText');
    if (textEl) textEl.value = formatShoppingText();
  }

  function formatShoppingText() {
    if (!state.shopping.length) return 'Fridge Chef — Shopping list (empty)\nEstimates only.';
    var lines = ['Fridge Chef — Shopping list', 'Estimates only. Required − on-hand.', ''];
    state.shopping.forEach(function (s) {
      var tick = state.shoppingTicks[s.item + '|' + s.unit] ? '[x]' : '[ ]';
      lines.push(tick + ' ' + s.item + ' — ' + s.qty + ' ' + s.unit + ' (est ' + money(s.estCost || 0) + ')');
    });
    lines.push('', 'Estimated total: ' + money(FC.computeShoppingCost(state.shopping)));
    return lines.join('\n');
  }

  function renderSaved() {
    var el = $('savedList');
    if (!el) return;
    if (!state.saved.length) { el.innerHTML = '<p class="empty">No saved dishes yet — tap Save on a recipe to keep it here.</p>'; return; }
    el.innerHTML = state.saved.map(function (s, idx) {
      var title = s.title || s.name || 'Saved item';
      var sub = s.kind === 'plan' ? ('Plan · ' + (s.days ? s.days.length + ' days' : '')) : ('Recipe · ' + (s.recipe ? s.recipe.meal : ''));
      return '<div class="item"><div class="main"><div class="title">' + esc(title) + '</div><div class="sub">' + esc(sub) + '</div></div>' +
        '<button class="btn small" data-action="load-saved" data-index="' + idx + '">View</button> ' +
        '<button class="btn small" data-action="remove-saved" data-index="' + idx + '">Remove</button></div>';
    }).join('');
  }

  function renderMyDaysCalendar() {
    var el = $('myDaysCalendar');
    if (!el) return;
    var year = state.myDaysYear, month = state.myDaysMonth;
    var firstDow = new Date(year, month, 1).getDay();
    var total = FC.daysInMonth(year, month);
    var monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    var html = '<div class="row-between"><button class="btn small" data-action="mydays-prev">‹ Prev</button><strong>' + monthNames[month] + ' ' + year + '</strong><button class="btn small" data-action="mydays-next">Next ›</button></div>';
    html += '<div class="cal-dow"><span>Su</span><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span></div><div class="cal-grid">';
    for (var i = 0; i < firstDow; i++) html += '<div class="cal-day empty"></div>';
    var todayStr = new Date().toISOString().slice(0, 10);
    for (var d = 1; d <= total; d++) {
      var iso = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      var sel = state.selectedDays.indexOf(iso) !== -1 ? ' selected' : '';
      var tod = iso === todayStr ? ' today' : '';
      var planTitle = '';
      if (state.myDaysPlan) {
        var pd = null;
        for (var pi = 0; pi < state.myDaysPlan.length; pi++) {
          if (state.myDaysPlan[pi].date === iso) { pd = state.myDaysPlan[pi]; break; }
        }
        if (pd && pd.meals) {
          var pick = pd.meals.dinner || pd.meals.lunch || pd.meals.breakfast;
          if (pick && pick.title) planTitle = String(pick.title).slice(0, 18);
        }
      }
      var dot = planTitle ? '<span class="cal-dot" aria-hidden="true"></span><span class="cal-plan">' + esc(planTitle) + '</span>' : '';
      html += '<button class="cal-day' + sel + tod + '" data-action="toggle-day" data-date="' + iso + '">' + d + dot + '</button>';
    }
    html += '</div>';
    el.innerHTML = html;
    var selEl = $('myDaysSelected');
    if (selEl) selEl.textContent = state.selectedDays.length ? ('Selected: ' + state.selectedDays.join(', ')) : 'No days selected yet.';
    renderCookDaysSelected();
  }

  function renderCookDaysSelected() {
    var el = $('cookDaysSelected');
    if (!el) return;
    el.textContent = state.selectedDays.length ? ('Selected days: ' + state.selectedDays.slice().sort().join(', ')) : 'No days selected yet.';
  }

  function renderCookDaysPlan() {
    var el = $('cookDaysResult');
    var shopEl = $('cookDaysShoppingList');
    if (!state.cookDaysPlan) {
      if (el) el.innerHTML = '<p class="empty">Generate recipes for chosen days to see them here.</p>';
      if (shopEl) shopEl.innerHTML = '<p class="empty">Chosen-days shopping will appear after you generate a plan.</p>';
      return;
    }
    if (el) {
      el.innerHTML = state.cookDaysPlan.map(function (day) {
        var meals = day.meals || {};
        var keys = Object.keys(meals);
        if (!keys.length) return '<div class="item"><div class="main"><div class="title">' + esc(day.date) + '</div><div class="sub">No recipe found for this day with the current diet / strict setting.</div></div></div>';
        var html = '<div class="item"><div class="main"><div class="title">' + esc(day.date) + '</div>';
        keys.forEach(function (meal) {
          var r = meals[meal];
          html += '<div class="sub"><strong>' + esc(meal) + ':</strong> ' + esc(r.title) + (r.source === 'ai' ? ' <span class="pill ai-pill">AI</span>' : '') + ' · ' + r.calories + ' kcal · P ' + r.protein + 'g · C ' + r.carbs + 'g · F ' + r.fat + 'g · est ' + money(r.estCost) + '</div>';
          html += usesAlsoHtml(r, state.cookDaysWanted || []);
          html += recipeCardHtml(r, state.settings.servings);
        });
        html += '</div></div>';
        return html;
      }).join('');
    }
    if (shopEl) {
      if (!state.cookDaysShopping.length) shopEl.innerHTML = '<p class="empty">No shopping needed — pantry covers it.</p>';
      else shopEl.innerHTML = shoppingProgressHtml(state.cookDaysShopping) + state.cookDaysShopping.map(function (s) {
        return '<div class="item"><div class="main"><div class="title">' + esc(s.item) + '</div><div class="sub">' + esc(s.qty + ' ' + s.unit) + ' · est ' + money(s.estCost) + '</div></div></div>';
      }).join('');
    }
  }

  function renderMonthPlan() {
    var resultEl = $('monthResult');
    var totalEl = $('monthTotal');
    var shopEl = $('monthShoppingList');
    if (!state.monthPlan) {
      if (resultEl) resultEl.innerHTML = '<p class="empty">Generate a monthly menu to see it here.</p>';
      if (shopEl) shopEl.innerHTML = '<p class="empty">Monthly shopping will appear after you generate a menu.</p>';
      return;
    }
    var p = state.monthPlan;
    if (totalEl) {
      var warn = p.overBudget ? '<span class="pill warn">Over budget by ' + money(p.totalCost - p.allowed) + ' (budget ' + money(p.budget) + ' + overage OK ' + money(p.overage) + ' = ' + money(p.allowed) + '). Cheapest menu kept.</span>' : '<span class="pill ok">Within budget (' + money(p.budget) + ' + ' + money(p.overage) + ' overage OK)</span>';
      totalEl.innerHTML = '<p><strong>Estimated total: ' + money(p.totalCost) + '</strong> for ' + p.days.length + ' days · ' + p.restaurantCount + ' restaurant nights</p>' + warn;
    }
    if (resultEl) {
      resultEl.innerHTML = p.days.map(function (day) {
        if (day.type === 'restaurant') return '<div class="item"><div class="main"><div class="title">Day ' + day.day + ' — 🍽️ Restaurant night</div><div class="sub">' + esc(day.date) + '</div></div></div>';
        return '<div class="item"><div class="main"><div class="title">Day ' + day.day + ' — ' + esc(day.recipe ? day.recipe.title : '') + (day.recipe && day.recipe.source === 'ai' ? ' <span class="pill ai-pill">AI</span>' : '') + '</div><div class="sub">' + esc(day.date) + ' · est ' + money(day.estCost) + ' · ' + (day.recipe ? day.recipe.calories + ' kcal' : '') + '</div></div></div>';
      }).join('');
    }
    if (shopEl) {
      if (!state.monthShopping.length) shopEl.innerHTML = '<p class="empty">No shopping needed — pantry covers it.</p>';
      else shopEl.innerHTML = shoppingProgressHtml(state.monthShopping) + state.monthShopping.map(function (s) {
        return '<div class="item"><div class="main"><div class="title">' + esc(s.item) + '</div><div class="sub">' + esc(s.qty + ' ' + s.unit) + ' · est ' + money(s.estCost) + '</div></div></div>';
      }).join('');
    }
  }

  function renderMyDaysPlan() {
    var el = $('myDaysResult');
    var shopEl = $('myDaysShoppingList');
    if (!state.myDaysPlan) {
      if (el) el.innerHTML = '<p class="empty">Generate a plan for selected days to see it here.</p>';
      if (shopEl) shopEl.innerHTML = '<p class="empty">My-days shopping will appear after you generate a plan.</p>';
      return;
    }
    if (el) {
      el.innerHTML = state.myDaysPlan.map(function (day) {
        var html = '<div class="item"><div class="main"><div class="title">' + esc(day.date) + '</div>';
        ['breakfast', 'lunch', 'dinner'].forEach(function (meal) {
          var r = day.meals[meal];
          if (r) {
            html += '<div class="sub"><strong>' + meal + ':</strong> ' + esc(r.title) + (r.source === 'ai' ? ' <span class="pill ai-pill">AI</span>' : '') + ' · ' + r.calories + ' kcal · P ' + r.protein + 'g · C ' + r.carbs + 'g · F ' + r.fat + 'g · est ' + money(r.estCost) + '</div><div class="sub">' + esc(r.benefits || '') + '</div>';
            html += usesAlsoHtml(r, state.myDaysHint || []);
          }
        });
        html += '</div></div>';
        return html;
      }).join('');
    }
    if (shopEl) {
      if (!state.myDaysShopping.length) shopEl.innerHTML = '<p class="empty">No shopping needed — pantry covers it.</p>';
      else shopEl.innerHTML = shoppingProgressHtml(state.myDaysShopping) + state.myDaysShopping.map(function (s) {
        return '<div class="item"><div class="main"><div class="title">' + esc(s.item) + '</div><div class="sub">' + esc(s.qty + ' ' + s.unit) + ' · est ' + money(s.estCost) + '</div></div></div>';
      }).join('');
    }
  }

  function renderAll() {
    renderPantry(); renderBrowse(); renderShopping(); renderSaved(); renderMyDaysCalendar(); renderMonthPlan(); renderMyDaysPlan(); renderCookDaysPlan(); renderCookDaysSelected();
  }

  function currentDiet(which) {
    var el = $(which);
    if (el && el.value) return el.value;
    return state.settings.diet;
  }

  function suggestDish(surprise) {
    var diet = currentDiet('cookDiet');
    var meal = $('cookMeal') ? $('cookMeal').value : 'any';
    var servings = $('cookServings') ? Number($('cookServings').value) || 2 : 2;
    var pool = FC.filterRecipesByDiet(FC.RECIPES.concat(state.aiRecipes || []), diet);
    if (meal !== 'any') pool = pool.filter(function (r) { return r.meal === meal; });
    if (!pool.length) { $('cookResult').innerHTML = '<p class="empty">No recipes for that diet / meal.</p>'; return; }
    var idx = surprise ? Math.floor(Math.random() * pool.length) : Math.floor(Math.random() * pool.length);
    // For non-surprise, prefer a recipe that uses pantry items when possible.
    if (!surprise) {
      var withPantry = pool.filter(function (r) {
        return r.ingredients.some(function (ing) {
          return state.pantry.some(function (p) { return FC.normalizeItem(p.item) === FC.normalizeItem(ing.item); });
        });
      });
      if (withPantry.length) pool = withPantry;
      idx = Math.floor(Math.random() * pool.length);
    }
    var recipe = pool[idx];
    $('cookResult').innerHTML = recipeCardHtml(recipe, servings);
    toast('Suggested: ' + recipe.title);
  }

  function renderCookFromIngredients() {
    var el = $('cookFromIngredientsResult');
    if (!el) return;
    if (!lastCookScored) { el.innerHTML = '<p class="empty">List at least one ingredient.</p>'; return; }
    var servings = $('cookServings') ? Number($('cookServings').value) || 2 : 2;
    var wanted = lastCookScored.wanted || [];
    var scored = lastCookScored.scored || [];
    var strict = !!lastCookScored.strict;
    if (!scored.length) {
      el.innerHTML = strict
        ? '<p class="empty">No recipes use only those ingredients with this diet. Uncheck “Only show recipes using my ingredients” to see all diet-allowed recipes ranked by overlap.</p>'
        : '<p class="empty">No recipes for this diet. Try another diet.</p>';
      return;
    }
    var showAll = cookShowAll;
    var shown = showAll ? scored : scored.slice(0, 8);
    var header = strict
      ? '<p class="hint">Strict mode: ' + scored.length + ' recipe(s) use your ingredients. Showing ' + shown.length + ' by ingredient overlap.</p>'
      : '<p class="hint">Preference mode: your ingredients are a preference, not a restriction. ' + scored.length + ' diet-allowed recipe(s) ranked by overlap. Showing ' + shown.length + '.</p>';
    var toggle = '';
    if (scored.length > 8) {
      toggle = '<button class="btn small" data-action="toggle-cook-show-all">' + (showAll ? 'Show top 8' : ('Show all ' + scored.length)) + '</button>';
    }
    el.innerHTML = header + toggle +
      shown.map(function (x) {
        return '<div style="margin-top:10px"><p class="hint" style="margin:0">Uses ' + x.matches + ' of your ingredient(s)</p>' + usesAlsoHtml(x.recipe, wanted) + recipeCardHtml(x.recipe, servings) + '</div>';
      }).join('');
  }

  function cookFromIngredients() {
    var raw = $('cookIngredientsInput') ? $('cookIngredientsInput').value : '';
    if (!raw.trim()) { lastCookScored = null; cookShowAll = false; $('cookFromIngredientsResult').innerHTML = '<p class="empty">List at least one ingredient.</p>'; return; }
    var wanted = parseWantedItems(raw);
    var diet = currentDiet('cookDiet');
    var strict = $('cookStrictOnly') ? !!$('cookStrictOnly').checked : false;
    var pool = FC.filterRecipesByDiet(FC.RECIPES.concat(state.aiRecipes || []), diet);
    var scored = FC.rankRecipesByIngredients(pool, wanted, strict);
    lastCookScored = { scored: scored, wanted: wanted, strict: strict };
    cookShowAll = false;
    renderCookFromIngredients();
  }

  // Fill plan slots with AI recipes first (matching meal when possible), keep
  // offline recipes for the rest. Dedupe by id + normalized title.
  function fillSlotsWithAi(slots, aiRecipes, getMeal) {
    var usedIds = {}, usedTitles = {};
    var aiPool = (aiRecipes || []).slice();
    slots.forEach(function (slot) {
      var cur = slot.get();
      if (cur) { usedIds[cur.id] = true; usedTitles[String(cur.title || '').toLowerCase().trim()] = true; }
    });
    var aiUsed = 0;
    slots.forEach(function (slot) {
      var wantMeal = getMeal(slot);
      var idx = -1;
      for (var i = 0; i < aiPool.length; i++) {
        var r = aiPool[i];
        if (usedIds[r.id]) continue;
        if (usedTitles[String(r.title || '').toLowerCase().trim()]) continue;
        if (wantMeal && wantMeal !== 'any' && r.meal !== wantMeal) continue;
        idx = i; break;
      }
      if (idx === -1 && wantMeal && wantMeal !== 'any') {
        for (var j = 0; j < aiPool.length; j++) {
          var r2 = aiPool[j];
          if (usedIds[r2.id] || usedTitles[String(r2.title || '').toLowerCase().trim()]) continue;
          idx = j; break;
        }
      }
      if (idx !== -1) {
        var pick = aiPool.splice(idx, 1)[0];
        slot.set(pick);
        usedIds[pick.id] = true;
        usedTitles[String(pick.title || '').toLowerCase().trim()] = true;
        aiUsed++;
      }
    });
    return aiUsed;
  }

  async function suggestDishAI() {
    try {
      var diet = currentDiet('cookDiet');
      var meal = $('cookMeal') ? $('cookMeal').value : 'any';
      var servings = $('cookServings') ? Number($('cookServings').value) || 2 : 2;
      var ai = await fetchAIRecipes({ diet: diet, meal: meal, count: 3, servings: servings });
      var pick = ai[0];
      if (!pick) throw new Error('bad-response — AI returned no valid recipes');
      $('cookResult').innerHTML = recipeCardHtml(pick, servings);
      toast('Suggested (AI): ' + pick.title);
    } catch (e) {
      toast('AI unavailable (' + String(e && e.message || e) + ') — using offline recipes');
      suggestDish(false);
    }
  }

  async function cookFromIngredientsAI() {
    var raw = $('cookIngredientsInput') ? $('cookIngredientsInput').value : '';
    if (!raw.trim()) { lastCookScored = null; cookShowAll = false; $('cookFromIngredientsResult').innerHTML = '<p class="empty">List at least one ingredient.</p>'; return; }
    try {
      var wanted = parseWantedItems(raw);
      var diet = currentDiet('cookDiet');
      var strict = $('cookStrictOnly') ? !!$('cookStrictOnly').checked : false;
      var ai = await fetchAIRecipes({ diet: diet, meal: 'any', count: 8, ingredients: wanted, servings: state.settings.servings });
      var aiScored = FC.rankRecipesByIngredients(ai, wanted, strict);
      var pool = FC.filterRecipesByDiet(FC.RECIPES.concat(state.aiRecipes || []), diet);
      var offlineScored = FC.rankRecipesByIngredients(pool, wanted, strict);
      var seen = {}, combined = [];
      aiScored.concat(offlineScored).forEach(function (x) {
        var key = String(x.recipe.id || '') + '|' + String(x.recipe.title || '').toLowerCase().trim();
        if (seen[key]) return; seen[key] = true; combined.push(x);
      });
      lastCookScored = { scored: combined, wanted: wanted, strict: strict };
      cookShowAll = false;
      renderCookFromIngredients();
      toast('Found ' + ai.length + ' AI recipe(s) + offline matches.');
    } catch (e) {
      toast('AI unavailable (' + String(e && e.message || e) + ') — using offline recipes');
      cookFromIngredients();
    }
  }

  function generateCookDays() {
    var dates = (state.selectedDays || []).slice().sort();
    if (!dates.length) { $('cookDaysResult').innerHTML = '<p class="empty">Pick at least one day — use the quick buttons or the My Days calendar.</p>'; return; }
    var mealMode = $('cookDaysMeal') ? $('cookDaysMeal').value : 'dinner';
    var raw = $('cookDaysIngredients') ? $('cookDaysIngredients').value : '';
    if (!raw.trim() && $('cookIngredientsInput') && $('cookIngredientsInput').value.trim()) raw = $('cookIngredientsInput').value;
    var wanted = parseWantedItems(raw);
    var strict = $('cookDaysStrict') ? !!$('cookDaysStrict').checked : false;
    var diet = currentDiet('cookDiet');
    var plan = FC.generateCookDaysPlan({ dates: dates, diet: diet, mealMode: mealMode, wantedItems: wanted, strict: strict, recipes: FC.RECIPES.concat(state.aiRecipes || []) });
    state.cookDaysPlan = plan;
    state.cookDaysWanted = wanted;
    var allRecipes = [];
    plan.forEach(function (d) {
      Object.keys(d.meals || {}).forEach(function (m) { if (d.meals[m]) allRecipes.push(d.meals[m]); });
    });
    state.cookDaysShopping = FC.aggregateShopping(allRecipes, state.pantry);
    save(); renderCookDaysPlan(); renderMyDaysCalendar();
    toast('Recipes generated for ' + plan.length + ' day(s).');
  }

  async function generateCookDaysAI() {
    var dates = (state.selectedDays || []).slice().sort();
    if (!dates.length) { $('cookDaysResult').innerHTML = '<p class="empty">Pick at least one day — use the quick buttons or the My Days calendar.</p>'; return; }
    var mealMode = $('cookDaysMeal') ? $('cookDaysMeal').value : 'dinner';
    var raw = $('cookDaysIngredients') ? $('cookDaysIngredients').value : '';
    if (!raw.trim() && $('cookIngredientsInput') && $('cookIngredientsInput').value.trim()) raw = $('cookIngredientsInput').value;
    var wanted = parseWantedItems(raw);
    var strict = $('cookDaysStrict') ? !!$('cookDaysStrict').checked : false;
    var diet = currentDiet('cookDiet');
    var mealsPerDay = mealMode === 'full' ? 3 : 1;
    try {
      var ai = await fetchAIRecipes({ diet: diet, meal: mealMode === 'full' ? 'any' : mealMode, count: dates.length * mealsPerDay, ingredients: wanted, servings: state.settings.servings, days: dates });
      var plan = FC.generateCookDaysPlan({ dates: dates, diet: diet, mealMode: mealMode, wantedItems: wanted, strict: strict, recipes: FC.RECIPES.concat(state.aiRecipes || []) });
      var slots = [];
      plan.forEach(function (day) {
        if (mealMode === 'full') {
          ['breakfast', 'lunch', 'dinner'].forEach(function (m) {
            slots.push({ get: function () { return day.meals[m]; }, set: function (r) { day.meals[m] = r; }, meal: m });
          });
        } else {
          var keys = Object.keys(day.meals || {});
          if (!keys.length) slots.push({ get: function () { return null; }, set: function (r) { day.meals[r.meal] = r; }, meal: mealMode });
          else keys.forEach(function (m) { slots.push({ get: function () { return day.meals[m]; }, set: function (r) { day.meals[m] = r; }, meal: m }); });
        }
      });
      var aiUsed = fillSlotsWithAi(slots, ai, function (s) { return s.meal; });
      state.cookDaysPlan = plan;
      state.cookDaysWanted = wanted;
      var all = [];
      plan.forEach(function (d) { Object.keys(d.meals || {}).forEach(function (m) { if (d.meals[m]) all.push(d.meals[m]); }); });
      state.cookDaysShopping = FC.aggregateShopping(all, state.pantry);
      save(); renderCookDaysPlan(); renderMyDaysCalendar();
      toast('AI recipes used for ' + aiUsed + ' slot(s), offline filled the rest.');
    } catch (e) {
      toast('AI unavailable (' + String(e && e.message || e) + ') — using offline recipes');
      generateCookDays();
    }
  }

  function formatCookDaysPlanText() {
    if (!state.cookDaysPlan) return 'Fridge Chef — Recipes for chosen days (not generated yet)\nEstimates only.';
    var lines = ['Fridge Chef — Recipes for chosen days', 'Estimates only. Diet: ' + dietLabel(currentDiet('cookDiet')) + ' · Ingredients are a preference, not a restriction.', ''];
    state.cookDaysPlan.forEach(function (d) {
      lines.push(d.date);
      Object.keys(d.meals || {}).forEach(function (m) {
        var r = d.meals[m];
        lines.push('  ' + m + ': ' + r.title + (r.source === 'ai' ? ' [AI]' : '') + ' — ' + r.calories + ' kcal, P ' + r.protein + 'g, C ' + r.carbs + 'g, F ' + r.fat + 'g, est ' + money(r.estCost) + ' — ' + (r.benefits || ''));
        var used = FC.usedWantedItems(r, state.cookDaysWanted || []);
        var also = FC.alsoNeedsExcludingPantry(r, state.cookDaysWanted || [], state.pantry);
        if (used.length) lines.push('    Uses your: ' + used.join(', '));
        if (also.length) lines.push('    Also needs: ' + also.map(function (e) { return e.item + ' ' + e.qty + ' ' + e.unit; }).join(', '));
      });
      lines.push('');
    });
    return lines.join('\n');
  }

  function generateMonth() {
    var year = Number($('monthYear').value) || new Date().getFullYear();
    var month = (Number($('monthMonth').value) || (new Date().getMonth() + 1)) - 1;
    var diet = currentDiet('monthDiet');
    var budget = Number($('monthBudget').value);
    if (isNaN(budget)) budget = state.settings.budget;
    var overage = Number($('monthOverage').value);
    if (isNaN(overage)) overage = state.settings.overage;
    var restCount = Number($('monthRestaurantCount').value);
    if (isNaN(restCount)) restCount = 0;
    var plan = FC.generateMonthlyPlan({ year: year, month: month, diet: diet, budget: budget, overage: overage, restaurantCount: restCount, recipes: FC.RECIPES.concat(state.aiRecipes || []) });
    state.monthPlan = plan;
    var dinnerRecipes = plan.days.filter(function (d) { return d.type === 'dinner' && d.recipe; }).map(function (d) { return d.recipe; });
    state.monthShopping = FC.aggregateShopping(dinnerRecipes, state.pantry);
    save(); renderMonthPlan();
    toast('Monthly menu generated: ' + money(plan.totalCost) + (plan.overBudget ? ' — over budget, cheapest kept' : ''));
  }

  async function generateMonthAI() {
    var year = Number($('monthYear').value) || new Date().getFullYear();
    var month = (Number($('monthMonth').value) || (new Date().getMonth() + 1)) - 1;
    var diet = currentDiet('monthDiet');
    var budget = Number($('monthBudget').value);
    if (isNaN(budget)) budget = state.settings.budget;
    var overage = Number($('monthOverage').value);
    if (isNaN(overage)) overage = state.settings.overage;
    var restCount = Number($('monthRestaurantCount').value);
    if (isNaN(restCount)) restCount = 0;
    var totalDays = FC.daysInMonth(year, month);
    var dinnerCount = Math.max(0, Math.min(31, totalDays - restCount));
    try {
      var ai = await fetchAIRecipes({ diet: diet, meal: 'dinner', count: dinnerCount, servings: state.settings.servings });
      var plan = FC.generateMonthlyPlan({ year: year, month: month, diet: diet, budget: budget, overage: overage, restaurantCount: restCount, recipes: FC.RECIPES.concat(state.aiRecipes || []) });
      var slots = [];
      plan.days.forEach(function (day) {
        if (day.type !== 'dinner') return;
        slots.push({ get: function () { return day.recipe; }, set: function (r) { day.recipe = r; day.estCost = r.estCost || 0; }, meal: 'dinner' });
      });
      var aiUsed = fillSlotsWithAi(slots, ai, function () { return 'dinner'; });
      plan.totalCost = Math.round(plan.days.filter(function (d) { return d.type === 'dinner'; }).reduce(function (a, d) { return a + (d.estCost || 0); }, 0) * 100) / 100;
      plan.overBudget = plan.totalCost > plan.allowed;
      state.monthPlan = plan;
      var dinnerRecipes = plan.days.filter(function (d) { return d.type === 'dinner' && d.recipe; }).map(function (d) { return d.recipe; });
      state.monthShopping = FC.aggregateShopping(dinnerRecipes, state.pantry);
      save(); renderMonthPlan();
      toast('AI dinners used for ' + aiUsed + ' night(s), offline filled the rest.');
    } catch (e) {
      toast('AI unavailable (' + String(e && e.message || e) + ') — using offline recipes');
      generateMonth();
    }
  }

  function buildMyDaysOfflinePlan(diet, hintItems) {
    var used = [];
    return state.selectedDays.slice().sort().map(function (iso) {
      var meals = {};
      ['breakfast', 'lunch', 'dinner'].forEach(function (meal) {
        var pool = FC.filterRecipesByDiet((FC.RECIPES.concat(state.aiRecipes || [])).filter(function (r) { return r.meal === meal; }), diet);
        if (!pool.length) pool = FC.filterRecipesByDiet(FC.RECIPES.concat(state.aiRecipes || []), diet);
        var preferred = pool;
        if (hintItems.length) {
          var withHint = pool.filter(function (r) {
            return r.ingredients.some(function (ing) { return hintItems.indexOf(FC.normalizeItem(ing.item)) !== -1; });
          });
          if (withHint.length) preferred = withHint;
        }
        var candidates = preferred.filter(function (r) { return used.indexOf(r.id) === -1; });
        if (!candidates.length) candidates = preferred;
        var pick = candidates[used.length % candidates.length];
        used.push(pick.id);
        meals[meal] = pick;
      });
      return { date: iso, meals: meals };
    });
  }

  function generateMyDays() {
    if (!state.selectedDays.length) { $('myDaysResult').innerHTML = '<p class="empty">Select at least one day first.</p>'; return; }
    var diet = currentDiet('myDaysDiet');
    var hintRaw = $('myDaysIngredients') ? $('myDaysIngredients').value : '';
    var hintItems = parseWantedItems(hintRaw);
    state.myDaysHint = hintItems;
    var plan = buildMyDaysOfflinePlan(diet, hintItems);
    state.myDaysPlan = plan;
    var allRecipes = [];
    plan.forEach(function (d) { ['breakfast', 'lunch', 'dinner'].forEach(function (m) { if (d.meals[m]) allRecipes.push(d.meals[m]); }); });
    state.myDaysShopping = FC.aggregateShopping(allRecipes, state.pantry);
    save(); renderMyDaysPlan(); renderMyDaysCalendar();
    toast('Plan generated for ' + plan.length + ' day(s).');
  }

  async function generateMyDaysAI() {
    if (!state.selectedDays.length) { $('myDaysResult').innerHTML = '<p class="empty">Select at least one day first.</p>'; return; }
    var diet = currentDiet('myDaysDiet');
    var hintRaw = $('myDaysIngredients') ? $('myDaysIngredients').value : '';
    var hintItems = parseWantedItems(hintRaw);
    state.myDaysHint = hintItems;
    try {
      var ai = await fetchAIRecipes({ diet: diet, meal: 'any', count: state.selectedDays.length * 3, ingredients: hintItems, servings: state.settings.servings, days: state.selectedDays.slice().sort() });
      var plan = buildMyDaysOfflinePlan(diet, hintItems);
      var slots = [];
      plan.forEach(function (day) {
        ['breakfast', 'lunch', 'dinner'].forEach(function (m) {
          slots.push({ get: function () { return day.meals[m]; }, set: function (r) { day.meals[m] = r; }, meal: m });
        });
      });
      var aiUsed = fillSlotsWithAi(slots, ai, function (s) { return s.meal; });
      state.myDaysPlan = plan;
      var all = [];
      plan.forEach(function (d) { ['breakfast', 'lunch', 'dinner'].forEach(function (m) { if (d.meals[m]) all.push(d.meals[m]); }); });
      state.myDaysShopping = FC.aggregateShopping(all, state.pantry);
      save(); renderMyDaysPlan(); renderMyDaysCalendar();
      toast('AI recipes used for ' + aiUsed + ' meal(s), offline filled the rest.');
    } catch (e) {
      toast('AI unavailable (' + String(e && e.message || e) + ') — using offline recipes');
      generateMyDays();
    }
  }

  function mergeIntoShopping(list) {
    list.forEach(function (s) {
      var existing = null;
      for (var i = 0; i < state.shopping.length; i++) {
        if (FC.normalizeItem(state.shopping[i].item) === FC.normalizeItem(s.item) && state.shopping[i].unit === s.unit) { existing = state.shopping[i]; break; }
      }
      if (existing) { existing.qty = Math.round((existing.qty + s.qty) * 100) / 100; existing.estCost = Math.round(((existing.estCost || 0) + (s.estCost || 0)) * 100) / 100; }
      else state.shopping.push({ item: s.item, qty: s.qty, unit: s.unit, estCost: s.estCost || 0 });
    });
    save(); renderShopping(); toast('Added to shopping list.');
  }

  function formatMonthPlanText() {
    if (!state.monthPlan) return 'Fridge Chef — Monthly menu (not generated yet)\nEstimates only.';
    var lines = ['Fridge Chef — Monthly menu', 'Estimates only. Diet: ' + dietLabel(state.monthPlan.diet) + ' · ' + state.monthPlan.restaurantCount + ' restaurant night(s)', 'Total est: ' + money(state.monthPlan.totalCost) + ' (budget ' + money(state.monthPlan.budget) + ' + overage OK ' + money(state.monthPlan.overage) + ')', ''];
    state.monthPlan.days.forEach(function (d) {
      if (d.type === 'restaurant') lines.push('Day ' + d.day + ' (' + d.date + ') — Restaurant night');
      else lines.push('Day ' + d.day + ' (' + d.date + ') — ' + d.recipe.title + (d.recipe.source === 'ai' ? ' [AI]' : '') + ' (est ' + money(d.estCost) + ')');
    });
    return lines.join('\n');
  }

  function formatMyDaysPlanText() {
    if (!state.myDaysPlan) return 'Fridge Chef — My-days plan (not generated yet)\nEstimates only.';
    var lines = ['Fridge Chef — My-days plan', 'Estimates only.', ''];
    state.myDaysPlan.forEach(function (d) {
      lines.push(d.date);
      ['breakfast', 'lunch', 'dinner'].forEach(function (m) {
        var r = d.meals[m];
        if (r) {
          lines.push('  ' + m + ': ' + r.title + (r.source === 'ai' ? ' [AI]' : '') + ' — ' + r.calories + ' kcal, P ' + r.protein + 'g, C ' + r.carbs + 'g, F ' + r.fat + 'g, est ' + money(r.estCost) + ' — ' + (r.benefits || ''));
          var used = FC.usedWantedItems(r, state.myDaysHint || []);
          var also = FC.alsoNeedsExcludingPantry(r, state.myDaysHint || [], state.pantry);
          if (used.length) lines.push('    Uses your: ' + used.join(', '));
          if (also.length) lines.push('    Also needs: ' + also.map(function (e) { return e.item + ' ' + e.qty + ' ' + e.unit; }).join(', '));
        }
      });
      lines.push('');
    });
    return lines.join('\n');
  }

  function shareText(text, fallbackEl) {
    if (navigator.share) {
      navigator.share({ text: text }).catch(function () { copyText(text, fallbackEl); });
    } else {
      copyText(text, fallbackEl);
    }
  }
  function copyText(text, fallbackEl) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('Copied to clipboard. Paste into Notes.'); }).catch(function () { showFallback(text, fallbackEl); });
    } else showFallback(text, fallbackEl);
  }
  function showFallback(text, fallbackEl) {
    if (fallbackEl) { fallbackEl.value = text; fallbackEl.select(); }
    toast('Copy the text shown — share was not available.');
  }

  function saveOfflineFile() {
    var safeSettings = stripAiKeyFromState({ settings: state.settings }).settings;
    var data = {
      settings: safeSettings, pantry: state.pantry, saved: state.saved, shopping: state.shopping,
      monthPlan: state.monthPlan, myDaysPlan: state.myDaysPlan, cookDaysPlan: state.cookDaysPlan,
      cookDaysWanted: state.cookDaysWanted, exportedAt: new Date().toISOString()
    };
    var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fridge Chef — Offline Export</title>' +
      '<style>body{font-family:-apple-system,system-ui,sans-serif;max-width:640px;margin:0 auto;padding:16px;background:#FAF7F1;color:#2C2A25}h1{font-size:20px}h2{font-size:16px;margin-top:24px}.card{background:#fff;border:1px solid #E7E0D2;border-radius:12px;padding:14px;margin-bottom:12px}small{color:#8A8375}</style></head><body>' +
      '<h1>Fridge Chef — Offline Export</h1><p><small>Exported ' + esc(data.exportedAt) + ' · Prices / nutrition are estimates.</small></p>' +
      '<h2>Pantry</h2><div class="card">' + (data.pantry.length ? data.pantry.map(function (p) { return esc(p.item) + ' — ' + esc(p.qty + ' ' + p.unit) + '<br>'; }).join('') : 'Pantry empty.') + '</div>' +
      '<h2>Shopping</h2><div class="card">' + (data.shopping.length ? data.shopping.map(function (s) { return esc(s.item) + ' — ' + esc(s.qty + ' ' + s.unit) + ' (est $' + (s.estCost || 0) + ')<br>'; }).join('') : 'Shopping empty.') + '</div>' +
      '<h2>Saved</h2><div class="card">' + (data.saved.length ? data.saved.map(function (s) { return esc(s.title || s.name || 'Saved') + '<br>'; }).join('') : 'Nothing saved.') + '</div>' +
      '<h2>Monthly menu</h2><div class="card"><pre style="white-space:pre-wrap">' + esc(formatMonthPlanText()) + '</pre></div>' +
      '<h2>My-days plan</h2><div class="card"><pre style="white-space:pre-wrap">' + esc(formatMyDaysPlanText()) + '</pre></div>' +
      '<h2>Recipes for chosen days</h2><div class="card"><pre style="white-space:pre-wrap">' + esc(formatCookDaysPlanText()) + '</pre></div>' +
      '<h2>Raw data (JSON)</h2><div class="card"><pre style="white-space:pre-wrap">' + esc(JSON.stringify(data, null, 2)) + '</pre></div>' +
      '</body></html>';
    var blob = new Blob([html], { type: 'text/html' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'fridge-chef-offline.html';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('Offline file downloaded — keep it in Files.');
  }

  function downloadJson() {
    var safeState = stripAiKeyFromState(state);
    var blob = new Blob([JSON.stringify(safeState, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'fridge-chef-backup.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('Backup downloaded.');
  }

  function init() {
    if (!FC) { document.body.innerHTML = '<p style="padding:20px">Recipe engine failed to load. Reload the app.</p>'; return; }
    load();
    applyTheme();
    refreshThemeSeg();
    try {
      var mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
      if (mq && mq.addEventListener) mq.addEventListener('change', function () {
        if (state.settings.theme === 'system') applyTheme();
      });
      else if (mq && mq.addListener) mq.addListener(function () {
        if (state.settings.theme === 'system') applyTheme();
      });
    } catch (e) {}
    // Defaults into form fields
    var now = new Date();
    if ($('monthYear')) $('monthYear').value = now.getFullYear();
    if ($('monthMonth')) $('monthMonth').value = now.getMonth() + 1;
    if ($('cookDiet')) $('cookDiet').value = state.settings.diet;
    if ($('monthDiet')) $('monthDiet').value = state.settings.diet;
    if ($('myDaysDiet')) $('myDaysDiet').value = state.settings.diet;
    if ($('monthBudget')) $('monthBudget').value = state.settings.budget;
    if ($('monthOverage')) $('monthOverage').value = state.settings.overage;
    if ($('setDietDefault')) $('setDietDefault').value = state.settings.diet;
    if ($('setBudget')) $('setBudget').value = state.settings.budget;
    if ($('setOverage')) $('setOverage').value = state.settings.overage;
    if ($('setServings')) $('setServings').value = state.settings.servings;
    if ($('setUnits')) $('setUnits').value = state.settings.units;
    if ($('setAiProvider')) $('setAiProvider').value = state.settings.aiProvider || 'custom';
    if ($('setAiEnabled')) $('setAiEnabled').checked = !!state.settings.aiEnabled;
    if ($('setAiKey')) $('setAiKey').value = state.settings.aiKey || '';
    if ($('setAiModel')) $('setAiModel').value = state.settings.aiModel || (FC.AI_DEFAULT_MODELS[state.settings.aiProvider] || 'gpt-4o-mini');
    if ($('setAiEndpoint')) $('setAiEndpoint').value = state.settings.aiEndpoint || '/api/ai';
    if ($('setAiCache')) $('setAiCache').checked = state.settings.aiCache !== false;
    if ($('cookServings')) $('cookServings').value = state.settings.servings;

    // Tabs
    document.querySelectorAll('[data-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('[data-tab]').forEach(function (b) { b.classList.remove('on'); });
        btn.classList.add('on');
        document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('active'); });
        var target = $('view-' + btn.getAttribute('data-tab'));
        if (target) target.classList.add('active');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });

    // Offline banner
    function updateOnline() {
      var b = $('offlineBanner');
      if (b) b.classList.toggle('hidden', navigator.onLine);
    }
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    updateOnline();

    // Buttons
    if ($('btnSuggestDish')) $('btnSuggestDish').addEventListener('click', function () { suggestDish(false); });
    if ($('btnSuggestDishAI')) $('btnSuggestDishAI').addEventListener('click', suggestDishAI);
    if ($('btnSurpriseDish')) $('btnSurpriseDish').addEventListener('click', function () { suggestDish(true); });
    if ($('btnCookFromIngredients')) $('btnCookFromIngredients').addEventListener('click', cookFromIngredients);
    if ($('btnCookFromIngredientsAI')) $('btnCookFromIngredientsAI').addEventListener('click', cookFromIngredientsAI);
    if ($('btnGenerateCookDays')) $('btnGenerateCookDays').addEventListener('click', generateCookDays);
    if ($('btnGenerateCookDaysAI')) $('btnGenerateCookDaysAI').addEventListener('click', generateCookDaysAI);
    if ($('btnCookDaysToShopping')) $('btnCookDaysToShopping').addEventListener('click', function () { mergeIntoShopping(state.cookDaysShopping); });
    if ($('btnShareCookDaysPlan')) $('btnShareCookDaysPlan').addEventListener('click', function () { shareText(formatCookDaysPlanText(), null); });
    if ($('btnCopyCookDaysPlan')) $('btnCopyCookDaysPlan').addEventListener('click', function () { copyText(formatCookDaysPlanText(), null); });
    if ($('btnPickOnCalendar')) $('btnPickOnCalendar').addEventListener('click', function () {
      var tab = document.querySelector('[data-tab="mydays"]');
      if (tab) tab.click();
    });
    if ($('btnGenerateMonth')) $('btnGenerateMonth').addEventListener('click', generateMonth);
    if ($('btnGenerateMonthAI')) $('btnGenerateMonthAI').addEventListener('click', generateMonthAI);
    if ($('btnGenerateMyDays')) $('btnGenerateMyDays').addEventListener('click', generateMyDays);
    if ($('btnGenerateMyDaysAI')) $('btnGenerateMyDaysAI').addEventListener('click', generateMyDaysAI);
    if ($('btnAddPantry')) $('btnAddPantry').addEventListener('click', function () {
      var raw = $('pantryInput').value.trim();
      if (!raw) { toast('Type a pantry item first.'); return; }
      var parsed = FC.parseQuantity(raw);
      if (!parsed.item) { toast('Could not parse that item. Try “eggs 6”.'); return; }
      var existing = null;
      for (var i = 0; i < state.pantry.length; i++) {
        if (FC.normalizeItem(state.pantry[i].item) === parsed.item) { existing = state.pantry[i]; break; }
      }
      if (existing) {
        // Only merge if units are compatible (same dim); otherwise replace with new entry.
        var a = FC.toBase(existing.qty, existing.unit), b = FC.toBase(parsed.qty, parsed.unit);
        if (a.dim === b.dim) {
          var totalBase = a.base + b.base;
          var back = FC.fromBase(totalBase, a.dim);
          existing.qty = back.qty; existing.unit = back.unit;
        } else {
          existing.qty = parsed.qty; existing.unit = parsed.unit;
        }
      } else {
        state.pantry.push({ item: parsed.item, qty: parsed.qty, unit: parsed.unit });
      }
      $('pantryInput').value = '';
      save(); renderPantry(); renderBrowse(); renderMonthPlan(); renderMyDaysPlan();
      toast('Added ' + parsed.item + ' to pantry.');
    });
    if ($('btnClearPantry')) $('btnClearPantry').addEventListener('click', function () {
      state.pantry = []; save(); renderPantry(); renderBrowse(); toast('Pantry cleared.');
    });
    if ($('recipeSearch')) $('recipeSearch').addEventListener('input', renderBrowse);
    if ($('cookDiet')) $('cookDiet').addEventListener('change', renderBrowse);
    if ($('btnMonthToShopping')) $('btnMonthToShopping').addEventListener('click', function () { mergeIntoShopping(state.monthShopping); });
    if ($('btnMyDaysToShopping')) $('btnMyDaysToShopping').addEventListener('click', function () { mergeIntoShopping(state.myDaysShopping); });
    if ($('btnShareMonthPlan')) $('btnShareMonthPlan').addEventListener('click', function () { shareText(formatMonthPlanText(), null); });
    if ($('btnCopyMonthPlan')) $('btnCopyMonthPlan').addEventListener('click', function () { copyText(formatMonthPlanText(), null); });
    if ($('btnShareMyDaysPlan')) $('btnShareMyDaysPlan').addEventListener('click', function () { shareText(formatMyDaysPlanText(), null); });
    if ($('btnCopyMyDaysPlan')) $('btnCopyMyDaysPlan').addEventListener('click', function () { copyText(formatMyDaysPlanText(), null); });
    if ($('btnShareShopping')) $('btnShareShopping').addEventListener('click', function () { shareText(formatShoppingText(), $('shoppingText')); });
    if ($('btnCopyShopping')) $('btnCopyShopping').addEventListener('click', function () { copyText(formatShoppingText(), $('shoppingText')); });
    if ($('btnClearSaved')) $('btnClearSaved').addEventListener('click', function () { state.saved = []; save(); renderSaved(); toast('Saved cleared.'); });
    if ($('btnSaveOfflineFile')) $('btnSaveOfflineFile').addEventListener('click', saveOfflineFile);
    if ($('btnExportJson')) $('btnExportJson').addEventListener('click', downloadJson);
    if ($('btnWipeAll')) $('btnWipeAll').addEventListener('click', function () {
      if (!confirm('Erase all local Fridge Chef data?')) return;
      localStorage.removeItem(LS_KEY);
      state.pantry = []; state.saved = []; state.shopping = []; state.shoppingTicks = {}; state.selectedDays = []; state.monthPlan = null; state.myDaysPlan = null; state.myDaysHint = []; state.cookDaysPlan = null; state.cookDaysShopping = []; state.cookDaysWanted = [];
      state.aiRecipes = []; state.settings.aiKey = '';
      state.settings.theme = 'system';
      save(); applyTheme(); refreshThemeSeg(); renderAll(); refreshAiStatus(); toast('All local data erased.');
    });
    function saveAiSettingsFromForm() {
      if ($('setAiProvider')) state.settings.aiProvider = $('setAiProvider').value;
      if ($('setAiEnabled')) state.settings.aiEnabled = !!$('setAiEnabled').checked;
      if ($('setAiKey')) {
        // Custom proxy / Off: never store a browser key.
        if (state.settings.aiProvider === 'custom' || state.settings.aiProvider === 'off') state.settings.aiKey = '';
        else state.settings.aiKey = $('setAiKey').value;
      }
      if ($('setAiModel')) state.settings.aiModel = $('setAiModel').value.trim() || (FC.AI_DEFAULT_MODELS[state.settings.aiProvider] || 'gpt-4o-mini');
      if ($('setAiEndpoint')) state.settings.aiEndpoint = $('setAiEndpoint').value.trim() || (FC.AI_DEFAULT_ENDPOINTS[state.settings.aiProvider] || '/api/ai');
      if ($('setAiCache')) state.settings.aiCache = !!$('setAiCache').checked;
      save(); refreshAiStatus();
    }
    function applyAiProviderUi() {
      var p = $('setAiProvider') ? $('setAiProvider').value : state.settings.aiProvider;
      var keyRow = $('aiKeyRow'), keyNote = $('aiKeyNote');
      if (keyRow) keyRow.style.display = (p === 'openai' || p === 'anthropic') ? '' : 'none';
      if (keyNote) {
        keyNote.style.display = (p === 'custom') ? '' : 'none';
        if (p === 'custom') keyNote.textContent = 'Key lives on Vercel, not in this app. No key is sent from this browser.';
      }
      if ($('setAiModel')) {
        $('setAiModel').placeholder = FC.AI_DEFAULT_MODELS[p] || 'gpt-4o-mini';
      }
      if ($('setAiEndpoint')) {
        $('setAiEndpoint').placeholder = FC.AI_DEFAULT_ENDPOINTS[p] || '/api/ai';
      }
      var keyLabel = $('aiKeyLabel');
      if (keyLabel) keyLabel.textContent = p === 'openai' ? 'API key — browser key — less secure' : p === 'anthropic' ? 'API key — browser key — less secure' : 'API key';
    }
    if ($('btnSaveSettings')) $('btnSaveSettings').addEventListener('click', function () {
      state.settings.diet = $('setDietDefault').value;
      state.settings.budget = Number($('setBudget').value) || 100;
      state.settings.overage = Number($('setOverage').value) || 0;
      state.settings.servings = Number($('setServings').value) || 2;
      state.settings.units = $('setUnits').value;
      saveAiSettingsFromForm();
      if ($('monthBudget')) $('monthBudget').value = state.settings.budget;
      if ($('monthOverage')) $('monthOverage').value = state.settings.overage;
      if ($('cookServings')) $('cookServings').value = state.settings.servings;
      save(); renderAll();
      if ($('settingsStatus')) $('settingsStatus').textContent = 'Saved.';
      toast('Settings saved.');
    });
    if ($('btnSaveAiSettings')) $('btnSaveAiSettings').addEventListener('click', function () {
      saveAiSettingsFromForm();
      if ($('settingsStatus')) $('settingsStatus').textContent = 'AI settings saved.';
      toast('AI settings saved.');
    });
    if ($('setAiProvider')) $('setAiProvider').addEventListener('change', function () {
      var p = $('setAiProvider').value;
      var knownEndpoints = ['https://api.openai.com/v1/chat/completions', 'https://api.anthropic.com/v1/messages', '/api/ai', ''];
      var knownModels = ['gpt-4o-mini', 'claude-sonnet-4-20250514', ''];
      if ($('setAiEndpoint') && knownEndpoints.indexOf($('setAiEndpoint').value.trim()) !== -1) $('setAiEndpoint').value = FC.AI_DEFAULT_ENDPOINTS[p] || '/api/ai';
      if ($('setAiModel') && knownModels.indexOf($('setAiModel').value.trim()) !== -1) $('setAiModel').value = FC.AI_DEFAULT_MODELS[p] || 'gpt-4o-mini';
      applyAiProviderUi();
    });
    if ($('btnClearAiCache')) $('btnClearAiCache').addEventListener('click', function () {
      state.aiRecipes = []; save(); renderBrowse(); refreshAiStatus();
      toast('AI recipe cache cleared.');
    });
    document.querySelectorAll('#themeSeg button').forEach(function (b) {
      b.addEventListener('click', function () {
        state.settings.theme = b.getAttribute('data-theme-opt');
        applyTheme(); refreshThemeSeg(); save();
        toast('Appearance updated.');
      });
    });
    if ($('importFile')) $('importFile').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var d = JSON.parse(reader.result);
          var prevAiKey = state.settings.aiKey;
          if (d.settings) {
            state.settings = Object.assign(state.settings, d.settings);
            // NEVER overwrite the API key from a backup file — backups exclude it.
            state.settings.aiKey = prevAiKey;
            if (['system', 'light', 'dark'].indexOf(state.settings.theme) === -1) state.settings.theme = 'system';
            applyTheme(); refreshThemeSeg();
          }
          if (Array.isArray(d.aiRecipes)) state.aiRecipes = d.aiRecipes;
          if (Array.isArray(d.pantry)) state.pantry = d.pantry;
          if (Array.isArray(d.saved)) state.saved = d.saved;
          if (Array.isArray(d.shopping)) state.shopping = d.shopping;
          if (Array.isArray(d.selectedDays)) state.selectedDays = d.selectedDays;
          if (d.monthPlan) state.monthPlan = d.monthPlan;
          if (d.myDaysPlan) state.myDaysPlan = d.myDaysPlan;
          if (Array.isArray(d.myDaysHint)) state.myDaysHint = d.myDaysHint;
          if (Array.isArray(d.monthShopping)) state.monthShopping = d.monthShopping;
          if (Array.isArray(d.myDaysShopping)) state.myDaysShopping = d.myDaysShopping;
          if (d.cookDaysPlan) state.cookDaysPlan = d.cookDaysPlan;
          if (Array.isArray(d.cookDaysShopping)) state.cookDaysShopping = d.cookDaysShopping;
          if (Array.isArray(d.cookDaysWanted)) state.cookDaysWanted = d.cookDaysWanted;
          save(); renderAll(); toast('Backup restored.');
        } catch (err) { toast('That backup file could not be read.'); }
      };
      reader.readAsText(f);
      e.target.value = '';
    });

    // Delegated clicks for dynamic content
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.getAttribute('data-action');
      if (action === 'toggle-recipe-steps') {
        var card = btn.closest('.recipe-card');
        if (card) {
          var more = card.querySelector('.recipe-more');
          var preview = card.querySelector('.recipe-steps');
          var open = more && more.style.display !== 'none';
          if (more) more.style.display = open ? 'none' : 'block';
          if (preview) preview.style.display = open ? '' : 'none';
          btn.textContent = open ? 'Show steps' : 'Hide steps';
          btn.setAttribute('aria-expanded', String(!open));
        }
      } else if (action === 'save-recipe') {
        var rec = findRecipeById(btn.getAttribute('data-id'));
        if (rec) { state.saved.push({ kind: 'recipe', title: rec.title, recipe: rec, savedAt: new Date().toISOString() }); save(); renderSaved(); toast('Saved: ' + rec.title); }
      } else if (action === 'add-recipe-shopping') {
        var rec2 = findRecipeById(btn.getAttribute('data-id'));
        if (rec2) { var list = FC.aggregateShopping([scaledRecipe(rec2, state.settings.servings)], state.pantry); mergeIntoShopping(list); }
      } else if (action === 'remove-pantry') {
        var pi = Number(btn.getAttribute('data-index'));
        state.pantry.splice(pi, 1); save(); renderPantry(); renderBrowse();
      } else if (action === 'remove-saved') {
        state.saved.splice(Number(btn.getAttribute('data-index')), 1); save(); renderSaved();
      } else if (action === 'load-saved') {
        var s = state.saved[Number(btn.getAttribute('data-index'))];
        if (s && s.recipe) { $('cookResult').innerHTML = recipeCardHtml(s.recipe, state.settings.servings); document.querySelector('[data-tab="cook"]').click(); }
        else if (s && s.kind === 'plan') toast('Plan saved — view it in Month / My days.');
      } else if (action === 'remove-shopping') {
        state.shopping.splice(Number(btn.getAttribute('data-index')), 1); save(); renderShopping();
      } else if (action === 'toggle-cook-show-all') {
        cookShowAll = !cookShowAll;
        renderCookFromIngredients();
      } else if (action === 'cookdays-quick') {
        var range = btn.getAttribute('data-range');
        var today = new Date();
        var todayISO = localISO(today);
        var next = [];
        if (range === 'today') next = [todayISO];
        else if (range === 'tomorrow') next = [addDaysISO(todayISO, 1)];
        else if (range === 'weekend') {
          var dow = today.getDay();
          var untilSat = (6 - dow + 7) % 7;
          var sat = addDaysISO(todayISO, untilSat);
          next = [sat, addDaysISO(sat, 1)];
        }
        else if (range === 'next3') next = [todayISO, addDaysISO(todayISO, 1), addDaysISO(todayISO, 2)];
        else if (range === 'next7') { for (var i = 0; i < 7; i++) next.push(addDaysISO(todayISO, i)); }
        else if (range === 'clear') next = [];
        state.selectedDays = next.slice().sort();
        save(); renderMyDaysCalendar(); renderCookDaysSelected();
        toast(range === 'clear' ? 'Days cleared.' : ('Selected ' + state.selectedDays.join(', ')));
      } else if (action === 'toggle-day') {
        var iso = btn.getAttribute('data-date');
        state.selectedDays = FC.toggleDay(state.selectedDays, iso);
        save(); renderMyDaysCalendar();
      } else if (action === 'mydays-prev') {
        state.myDaysMonth--;
        if (state.myDaysMonth < 0) { state.myDaysMonth = 11; state.myDaysYear--; }
        renderMyDaysCalendar();
      } else if (action === 'mydays-next') {
        state.myDaysMonth++;
        if (state.myDaysMonth > 11) { state.myDaysMonth = 0; state.myDaysYear++; }
        renderMyDaysCalendar();
      }
    });

    document.addEventListener('change', function (e) {
      var cb = e.target.closest('[data-shopping-check]');
      if (!cb) return;
      var key = cb.getAttribute('data-shopping-check');
      state.shoppingTicks[key] = cb.checked;
      save(); renderShopping(); renderMonthPlan(); renderMyDaysPlan();
    });

    renderAll();
    if (typeof applyAiProviderUi === 'function') applyAiProviderUi();
    refreshAiStatus();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
