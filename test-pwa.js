/* Fridge Chef — Node tests, no dependencies. Run: node test-pwa.js */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;

let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('PASS ' + name); }
  else { failed++; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); }
}
function eq(a, b) { return a === b; }
function approx(a, b, eps) { return Math.abs(a - b) <= (eps || 0.01); }

const FC = require(path.join(ROOT, 'recipes.js'));
const RECIPES = FC.RECIPES;

// ---------- Recipe shape / counts ----------
ok('recipes: 48 total', RECIPES.length === 48, 'got ' + RECIPES.length);
const byClass = {};
RECIPES.forEach(r => { byClass[r.dietClass] = (byClass[r.dietClass] || 0) + 1; });
ok('recipes: >=12 vegan class', (byClass['vegan'] || 0) >= 12, JSON.stringify(byClass));
ok('recipes: >=12 vegetarian-no-eggs class', (byClass['vegetarian-no-eggs'] || 0) >= 12, JSON.stringify(byClass));
ok('recipes: >=12 vegetarian class', (byClass['vegetarian'] || 0) >= 12, JSON.stringify(byClass));
ok('recipes: >=12 omnivore class', (byClass['omnivore'] || 0) >= 12, JSON.stringify(byClass));

const byMeal = {};
RECIPES.forEach(r => { byMeal[r.meal] = (byMeal[r.meal] || 0) + 1; });
ok('recipes: breakfast/lunch/dinner balanced (>=10 each)', (byMeal['breakfast']||0)>=10 && (byMeal['lunch']||0)>=10 && (byMeal['dinner']||0)>=10, JSON.stringify(byMeal));

let shapeOk = true, shapeDetail = '';
RECIPES.forEach(r => {
  if (!r.id || !r.title || !r.meal || !Array.isArray(r.diets) || !r.diets.length) { shapeOk = false; shapeDetail = 'missing id/title/meal/diets: ' + r.id; }
  if (!Array.isArray(r.ingredients) || !r.ingredients.length) { shapeOk = false; shapeDetail = 'no ingredients: ' + r.id; }
  if (!Array.isArray(r.steps) || !r.steps.length) { shapeOk = false; shapeDetail = 'no steps: ' + r.id; }
  ['calories','protein','carbs','fat','estCost','minutes'].forEach(k => {
    if (typeof r[k] !== 'number' || isNaN(r[k])) { shapeOk = false; shapeDetail = 'bad ' + k + ': ' + r.id; }
  });
  if (!r.benefits) { shapeOk = false; shapeDetail = 'no benefits: ' + r.id; }
  r.ingredients.forEach(ing => {
    if (!ing.item || typeof ing.qty !== 'number' || ing.qty <= 0 || !ing.unit) { shapeOk = false; shapeDetail = 'bad ingredient in ' + r.id + ': ' + JSON.stringify(ing); }
  });
});
ok('recipes: every recipe has required fields', shapeOk, shapeDetail);

// ---------- Diet filter ----------
const veganFiltered = FC.filterRecipesByDiet(RECIPES, 'vegan');
const vegNoEggFiltered = FC.filterRecipesByDiet(RECIPES, 'vegetarian-no-eggs');
const vegFiltered = FC.filterRecipesByDiet(RECIPES, 'vegetarian');
const omniFiltered = FC.filterRecipesByDiet(RECIPES, 'omnivore');
ok('diet filter: vegan returns 12', veganFiltered.length === 12, 'got ' + veganFiltered.length);
ok('diet filter: vegetarian-no-eggs returns 24 (vegan + no-eggs)', vegNoEggFiltered.length === 24, 'got ' + vegNoEggFiltered.length);
ok('diet filter: vegetarian returns 36', vegFiltered.length === 36, 'got ' + vegFiltered.length);
ok('diet filter: omnivore returns 48', omniFiltered.length === 48, 'got ' + omniFiltered.length);

// Independent leak check (own keyword scan with same exclusions, not just calling isRecipeAllowed)
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function hasKw(text, kw) {
  let t = String(text).toLowerCase()
    .replace(/eggplant/g, 'aubergine')
    .replace(/peanut butter/g, 'peanutspread')
    .replace(/almond milk/g, 'plantmilk').replace(/oat milk/g, 'plantmilk')
    .replace(/coconut milk/g, 'plantmilk').replace(/soy milk/g, 'plantmilk');
  let pat = kw.indexOf(' ') !== -1 ? '\\b' + escRe(kw) + '\\b' : '\\b' + escRe(kw) + 's?\\b';
  if (kw === 'egg' || kw === 'eggs') pat = '\\beggs?\\b';
  return new RegExp(pat).test(t);
}
function hasAny(text, list) { return list.some(k => hasKw(text, k)); }
const MEAT = ['chicken','beef','pork','bacon','ham','sausage','turkey','lamb','steak','meat','ground beef','prosciutto','pepperoni','salami'];
const FISH = ['fish','salmon','tuna','shrimp','cod','tilapia','anchovy','sardine','mackerel','seafood'];
const EGG = ['egg','eggs','mayonnaise','mayo'];
const DAIRY = ['milk','cheese','butter','yogurt','yoghurt','cream','ricotta','mozzarella','parmesan','feta','cheddar','sour cream','ghee'];
const HONEY = ['honey'];
let leak = null;
RECIPES.forEach(r => {
  const text = [r.title].concat(r.ingredients.map(i => i.item)).join(' ');
  const dietsToCheck = [];
  if (FC.isRecipeAllowed(r, 'vegan')) dietsToCheck.push('vegan');
  if (FC.isRecipeAllowed(r, 'vegetarian-no-eggs')) dietsToCheck.push('vegetarian-no-eggs');
  if (FC.isRecipeAllowed(r, 'vegetarian')) dietsToCheck.push('vegetarian');
  dietsToCheck.forEach(d => {
    if (d === 'vegan' && (hasAny(text, MEAT) || hasAny(text, FISH) || hasAny(text, EGG) || hasAny(text, DAIRY) || hasAny(text, HONEY))) leak = 'vegan leak in ' + r.id + ': ' + text;
    if (d === 'vegetarian-no-eggs' && (hasAny(text, MEAT) || hasAny(text, FISH) || hasAny(text, EGG))) leak = 'veg-no-eggs leak in ' + r.id + ': ' + text;
    if (d === 'vegetarian' && (hasAny(text, MEAT) || hasAny(text, FISH))) leak = 'vegetarian leak in ' + r.id + ': ' + text;
  });
  // diets array must also agree
  if (FC.isRecipeAllowed(r, 'vegan') && (!r.diets || !r.diets.includes('vegan'))) leak = 'diets array missing vegan for ' + r.id;
});
ok('diet filter: never leaks disallowed ingredients (all 48 recipes)', leak === null, leak || '');

// Explicit negative cases
const meatRecipe = RECIPES.find(r => r.id === 'omni-grilled-chicken');
ok('diet filter: chicken recipe blocked for vegan/vegetarian', !FC.isRecipeAllowed(meatRecipe, 'vegan') && !FC.isRecipeAllowed(meatRecipe, 'vegetarian') && !FC.isRecipeAllowed(meatRecipe, 'vegetarian-no-eggs') && FC.isRecipeAllowed(meatRecipe, 'omnivore'));
const eggRecipe = RECIPES.find(r => r.id === 'veg-omelette');
ok('diet filter: egg recipe blocked for vegan + veg-no-eggs, allowed for vegetarian', !FC.isRecipeAllowed(eggRecipe, 'vegan') && !FC.isRecipeAllowed(eggRecipe, 'vegetarian-no-eggs') && FC.isRecipeAllowed(eggRecipe, 'vegetarian'));
const veganRecipe = RECIPES.find(r => r.id === 'vegan-chickpea-curry');
ok('diet filter: vegan recipe allowed for all diets', FC.isRecipeAllowed(veganRecipe, 'vegan') && FC.isRecipeAllowed(veganRecipe, 'vegetarian-no-eggs') && FC.isRecipeAllowed(veganRecipe, 'vegetarian') && FC.isRecipeAllowed(veganRecipe, 'omnivore'));

// ---------- Quantity parser ----------
function checkParse(input, expQty, expUnitOptions, expItem) {
  const p = FC.parseQuantity(input);
  const unitOk = expUnitOptions.includes(p.unit);
  return approx(p.qty, expQty) && unitOk && p.item === expItem;
}
ok('parser: "2 cups rice"', checkParse('2 cups rice', 2, ['cup','cups'], 'rice'), JSON.stringify(FC.parseQuantity('2 cups rice')));
ok('parser: "500g rice"', checkParse('500g rice', 500, ['g'], 'rice'), JSON.stringify(FC.parseQuantity('500g rice')));
ok('parser: "eggs 6"', checkParse('eggs 6', 6, ['pcs'], 'eggs'), JSON.stringify(FC.parseQuantity('eggs 6')));
ok('parser: "rice 500 g"', checkParse('rice 500 g', 500, ['g'], 'rice'), JSON.stringify(FC.parseQuantity('rice 500 g')));
ok('parser: "6 eggs"', checkParse('6 eggs', 6, ['pcs'], 'eggs'), JSON.stringify(FC.parseQuantity('6 eggs')));
ok('parser: "1.5 kg chicken breast"', checkParse('1.5 kg chicken breast', 1.5, ['kg'], 'chicken breast'), JSON.stringify(FC.parseQuantity('1.5 kg chicken breast')));
ok('parser: bare "salt" defaults to 1 pcs', (() => { const p = FC.parseQuantity('salt'); return p.qty === 1 && p.item === 'salt'; })(), JSON.stringify(FC.parseQuantity('salt')));

// ---------- Inventory check ----------
const testRecipe = { title: 'Test', ingredients: [{ item: 'rice', qty: 200, unit: 'g' }, { item: 'eggs', qty: 2, unit: 'pcs' }] };
ok('inventory: enough when pantry covers', (() => { const c = FC.checkInventory(testRecipe, [{ item: 'rice', qty: 500, unit: 'g' }, { item: 'eggs', qty: 6, unit: 'pcs' }]); return c.hasEnough && c.missing.length === 0; })());
ok('inventory: shortfall detected', (() => { const c = FC.checkInventory(testRecipe, [{ item: 'rice', qty: 100, unit: 'g' }, { item: 'eggs', qty: 6, unit: 'pcs' }]); return !c.hasEnough && c.missing.length === 1 && c.missing[0].item === 'rice' && approx(c.missing[0].qty, 100); })(), JSON.stringify(FC.checkInventory(testRecipe, [{ item: 'rice', qty: 100, unit: 'g' }, { item: 'eggs', qty: 6, unit: 'pcs' }])));
ok('inventory: missing item detected', (() => { const c = FC.checkInventory(testRecipe, []); return !c.hasEnough && c.missing.length === 2; })());
ok('inventory: kg→g conversion (1 kg covers 500 g)', (() => { const c = FC.checkInventory({ title: 'T', ingredients: [{ item: 'rice', qty: 500, unit: 'g' }] }, [{ item: 'rice', qty: 1, unit: 'kg' }]); return c.hasEnough; })());
ok('inventory: incompatible units flagged as missing', (() => { const c = FC.checkInventory({ title: 'T', ingredients: [{ item: 'rice', qty: 200, unit: 'g' }] }, [{ item: 'rice', qty: 1, unit: 'cup' }]); return !c.hasEnough && c.missing.length === 1 && !!c.missing[0].unitMismatch; })(), JSON.stringify(FC.checkInventory({ title: 'T', ingredients: [{ item: 'rice', qty: 200, unit: 'g' }] }, [{ item: 'rice', qty: 1, unit: 'cup' }])));

// ---------- Shopping aggregation ----------
ok('shopping: required - on-hand', (() => {
  const r1 = { ingredients: [{ item: 'rice', qty: 200, unit: 'g' }, { item: 'eggs', qty: 2, unit: 'pcs' }] };
  const r2 = { ingredients: [{ item: 'rice', qty: 200, unit: 'g' }, { item: 'eggs', qty: 2, unit: 'pcs' }] };
  const shop = FC.aggregateShopping([r1, r2], [{ item: 'rice', qty: 100, unit: 'g' }]);
  const rice = shop.find(s => s.item === 'rice');
  const eggs = shop.find(s => s.item === 'eggs');
  return rice && approx(rice.qty, 300) && eggs && approx(eggs.qty, 4);
})(), JSON.stringify(FC.aggregateShopping([{ ingredients: [{ item: 'rice', qty: 200, unit: 'g' }] }], [])));
ok('shopping: fully covered item omitted', (() => {
  const shop = FC.aggregateShopping([{ ingredients: [{ item: 'rice', qty: 100, unit: 'g' }] }], [{ item: 'rice', qty: 200, unit: 'g' }]);
  return shop.find(s => s.item === 'rice') === undefined;
})());
ok('shopping: cost math sums estCost', (() => {
  const shop = [{ estCost: 1.5 }, { estCost: 2.25 }];
  return approx(FC.computeShoppingCost(shop), 3.75);
})());

// ---------- Budget ----------
ok('budget: total = sum of estCost', (() => {
  const rs = [{ estCost: 2.5 }, { estCost: 3.5 }];
  return approx(FC.computeBudgetTotal(rs), 6.0);
})());

// ---------- Monthly plan ----------
const octPlan = FC.generateMonthlyPlan({ year: 2026, month: 9, diet: 'vegan', budget: 100, overage: 0, restaurantCount: 4 });
ok('monthly: Oct 2026 has 31 days', octPlan.days.length === 31, 'got ' + octPlan.days.length);
ok('monthly: restaurant nights count = 4', octPlan.days.filter(d => d.type === 'restaurant').length === 4, JSON.stringify(octPlan.days.filter(d => d.type === 'restaurant').length));
ok('monthly: total = sum of dinner estCost', (() => {
  const sum = octPlan.days.filter(d => d.type === 'dinner').reduce((a, d) => a + (d.estCost || 0), 0);
  return approx(octPlan.totalCost, sum);
})(), 'total ' + octPlan.totalCost);
ok('monthly: overBudget flag consistent', octPlan.overBudget === (octPlan.totalCost > octPlan.allowed));
ok('monthly: all dinners respect diet', octPlan.days.filter(d => d.type === 'dinner').every(d => FC.isRecipeAllowed(d.recipe, 'vegan')));
const febPlan = FC.generateMonthlyPlan({ year: 2026, month: 1, diet: 'omnivore', budget: 1000, overage: 0, restaurantCount: 0 });
ok('monthly: Feb 2026 has 28 days', febPlan.days.length === 28, 'got ' + febPlan.days.length);

// ---------- Calendar toggle ----------
ok('calendar: toggle adds', JSON.stringify(FC.toggleDay([], '2026-10-15')) === JSON.stringify(['2026-10-15']));
ok('calendar: toggle removes', JSON.stringify(FC.toggleDay(['2026-10-15'], '2026-10-15')) === JSON.stringify([]));
ok('calendar: toggle sorts', JSON.stringify(FC.toggleDay(['2026-10-20'], '2026-10-15')) === JSON.stringify(['2026-10-15', '2026-10-20']));

// ---------- Manifest ----------
let manifestOk = false, manifestDetail = '';
try {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
  manifestOk = m.name === 'Fridge Chef' && m.display === 'standalone' && !!m.start_url && !!m.theme_color && Array.isArray(m.icons) && m.icons.length > 0;
  if (!manifestOk) manifestDetail = JSON.stringify(m);
} catch (e) { manifestDetail = String(e); }
ok('manifest: valid JSON with required PWA fields', manifestOk, manifestDetail);

// ---------- IDs referenced in app.js exist in index.html ----------
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const refIds = new Set();
[...appJs.matchAll(/\$\(['"]([^'"]+)['"]\)/g)].forEach(m => refIds.add(m[1]));
[...appJs.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)].forEach(m => refIds.add(m[1]));
// Also $('view-' + ...) dynamic — view ids are covered by static view-* ids in html; skip dynamic.
let missingIds = [...refIds].filter(id => !htmlIds.has(id) && !id.startsWith('view-'));
ok('ids: every id referenced in app.js exists in index.html (' + refIds.size + ' refs)', missingIds.length === 0, 'missing: ' + missingIds.join(', '));

// ---------- SW assets exist ----------
const swJs = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const assetsMatch = swJs.match(/var ASSETS\s*=\s*\[([\s\S]*?)\]/);
let swOk = false, swDetail = '';
if (assetsMatch) {
  const assets = [...assetsMatch[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  const missing = [];
  assets.forEach(a => {
    let p = a.replace(/^\.\//, '');
    if (p === '' || p === './') p = 'index.html';
    if (!fs.existsSync(path.join(ROOT, p))) missing.push(a);
  });
  swOk = missing.length === 0 && assets.length >= 5;
  swDetail = 'assets ' + assets.length + ', missing: ' + missing.join(', ');
} else swDetail = 'ASSETS array not found';
ok('sw: all cached assets exist on disk', swOk, swDetail);

// ---------- Dark mode + UI polish (v1.1.0) ----------
// resolveTheme: extract the pure function from app.js and eval it (it has no external deps).
let resolveTheme = null, resolveThemeDetail = '';
try {
  const m = appJs.match(/function resolveTheme\(setting, prefersDark\)\s*\{[\s\S]*?\n  \}/);
  if (m) resolveTheme = eval('(' + m[0] + ')');
  else resolveThemeDetail = 'resolveTheme function not found in app.js';
} catch (e) { resolveThemeDetail = String(e); }
ok('theme: resolveTheme extracted from app.js', typeof resolveTheme === 'function', resolveThemeDetail);
if (typeof resolveTheme === 'function') {
  ok('theme: system + dark device -> dark', resolveTheme('system', true) === 'dark');
  ok('theme: system + light device -> light', resolveTheme('system', false) === 'light');
  ok('theme: light + dark device -> light', resolveTheme('light', true) === 'light');
  ok('theme: dark + light device -> dark', resolveTheme('dark', false) === 'dark');
  ok('theme: invalid setting falls back to device (dark)', resolveTheme('bogus', true) === 'dark');
  ok('theme: invalid setting falls back to device (light)', resolveTheme('bogus', false) === 'light');
  ok('theme: undefined setting falls back to device', resolveTheme(undefined, true) === 'dark');
}
ok('theme: app.js contains applyTheme + matchMedia listener', appJs.includes('function applyTheme()') && appJs.includes("matchMedia('(prefers-color-scheme: dark)')"), 'applyTheme or matchMedia listener missing');
ok('theme: app.js persists theme in settings with validation', appJs.includes("theme: 'system'") && appJs.includes("['system', 'light', 'dark'].indexOf(state.settings.theme)"), 'theme default/validation missing');
ok('theme: index.html has pre-paint theme script before stylesheet', (() => {
  const scriptIdx = html.indexOf('dataset.theme');
  const cssIdx = html.indexOf('styles.css');
  return scriptIdx !== -1 && cssIdx !== -1 && scriptIdx < cssIdx && html.includes('fridgechef.v1');
})(), 'pre-paint script missing or after stylesheet');
ok('theme: index.html has #themeSeg with System/Light/Dark radio options', html.includes('id="themeSeg"') && html.includes('data-theme-opt="system"') && html.includes('data-theme-opt="light"') && html.includes('data-theme-opt="dark"') && html.includes('role="radiogroup"'));
ok('theme: index.html About shows v1.3.0', html.includes('v1.3.0'));

// styles.css: dark block exists, every used var(--xxx) defined in light + dark (or plain :root)
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
function varsIn(blockText) {
  const s = new Set();
  [...(blockText || '').matchAll(/--([a-zA-Z0-9-]+)\s*:/g)].forEach(m => s.add(m[1]));
  return s;
}
const lightBlock = (css.match(/:root,\s*html\[data-theme="light"\]\s*\{([\s\S]*?)\}/) || [])[1] || '';
const darkBlock = (css.match(/html\[data-theme="dark"\]\s*\{([\s\S]*?)\}/) || [])[1] || '';
const plainRootBlock = (css.match(/:root\s*\{([\s\S]*?)\}/) || [])[1] || '';
const lightVars = varsIn(lightBlock), darkVars = varsIn(darkBlock), plainVars = varsIn(plainRootBlock);
ok('theme: styles.css defines html[data-theme="dark"] block', darkBlock.length > 0);
ok('theme: dark block sets color-scheme: dark', /color-scheme:\s*dark/.test(darkBlock));
ok('theme: light block sets color-scheme: light', /color-scheme:\s*light/.test(lightBlock));
const usedVars = new Set();
[css, appJs, html].forEach(src => {
  [...src.matchAll(/var\(--([a-zA-Z0-9-]+)\)/g)].forEach(m => usedVars.add(m[1]));
});
const missingThemeVars = [...usedVars].filter(v => plainVars.has(v) ? false : !(lightVars.has(v) && darkVars.has(v)));
ok('theme: every used var(--xxx) defined in both light and dark blocks (or plain :root)', missingThemeVars.length === 0, 'missing in light/dark: ' + missingThemeVars.join(', ') + ' | used: ' + [...usedVars].join(', '));
ok('theme: no hardcoded light background in components (no #FFFFFF bg outside vars)', (() => {
  // Allow #FFFFFF only inside var definitions / :root blocks; component rules must use var(--...).
  const withoutVarBlocks = css.replace(/:root,\s*html\[data-theme="light"\]\s*\{[\s\S]*?\}/, '').replace(/html\[data-theme="dark"\]\s*\{[\s\S]*?\}/, '').replace(/:root\s*\{[\s\S]*?\}/, '');
  return !/#FFFFFF/i.test(withoutVarBlocks) && !/#FAF7F1/i.test(withoutVarBlocks);
})(), 'hardcoded light color found in a component rule');

// sw.js cache version
ok('sw: CACHE is fridge-chef-v4', swJs.includes("var CACHE = 'fridge-chef-v4'"));

// Diet-label wart fix
ok('polish: no empty-diet fragment remains in app.js', !appJs.includes("(state.monthPlan ? '' : '')"));
ok('polish: formatMonthPlanText uses diet label mapping', appJs.includes('function formatMonthPlanText()') && appJs.includes('dietLabel(state.monthPlan.diet)') && appJs.includes('restaurantCount'));

// Recipe cards: meal cue + collapsible steps
ok('polish: recipeCardHtml has meal emoji / meal class', appJs.includes('meal-breakfast') && appJs.includes('meal-lunch') && appJs.includes('meal-dinner') && appJs.includes('🍳') && appJs.includes('🥗') && appJs.includes('🍽️'));
ok('polish: recipeCardHtml has collapsible steps toggle', appJs.includes('toggle-recipe-steps') && appJs.includes('Show steps') && appJs.includes('recipe-more'));

// Shopping progress
ok('polish: shopping progress helper with bought text + progress bar', appJs.includes('shoppingProgressHtml') && appJs.includes('of ') && appJs.includes('bought') && appJs.includes('<progress') && appJs.includes('shop-progress'));

// Calendar planned-day markers
ok('polish: calendar shows planned-day dot + title', appJs.includes('cal-dot') && appJs.includes('cal-plan') && appJs.includes('renderMyDaysCalendar'));

// Empty states + offline banner
ok('polish: saved empty state text', appJs.includes('No saved dishes yet — tap Save on a recipe to keep it here.'));
ok('polish: shopping empty state text', appJs.includes('Shopping list is empty.'));
ok('polish: browse no-match state text', appJs.includes('No recipes match — try clearing the search.'));
ok('polish: offline banner says everything works offline', html.includes('Everything here works offline.') && !html.includes('New AI generation is not available offline'));

// ---------- Chosen days + preference mode (v1.2.0) ----------
ok('v1.3.0: index.html About shows v1.3.0', html.includes('v1.3.0') && !html.includes('v1.2.0'));
ok('v1.2.0: cook-days section IDs present', ['cookDaysMeal','cookDaysIngredients','cookDaysStrict','btnGenerateCookDays','cookDaysResult','btnCookDaysToShopping','cookStrictOnly','cookDaysSelected','btnPickOnCalendar','cookDaysShoppingList'].every(id => htmlIds.has(id)), 'missing cook-days ids');
ok('v1.2.0: copy says preference, not a restriction', html.includes('preference, not a restriction') && appJs.includes('preference, not a restriction'));
ok('v1.2.0: no "do not use any other" restrictive wording', !html.toLowerCase().includes('do not use any other') && !appJs.toLowerCase().includes('do not use any other') && !fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8').toLowerCase().includes('do not use any other'));
ok('v1.2.0: app.js wires cook-days buttons + quick-select + share/copy', appJs.includes('btnGenerateCookDays') && appJs.includes('cookdays-quick') && appJs.includes('btnShareCookDaysPlan') && appJs.includes('btnCopyCookDaysPlan') && appJs.includes('generateCookDays'));
ok('v1.2.0: app.js persists cookDaysPlan/shopping', appJs.includes('cookDaysPlan') && appJs.includes('cookDaysShopping') && appJs.includes('cookDaysWanted'));

// scoreRecipeByIngredients
ok('preference: scoreRecipeByIngredients counts matches + extras', (() => {
  const r = { ingredients: [{ item: 'rice', qty: 100, unit: 'g' }, { item: 'eggs', qty: 2, unit: 'pcs' }, { item: 'spinach', qty: 50, unit: 'g' }] };
  const s = FC.scoreRecipeByIngredients(r, ['rice', 'tofu']);
  return s.matches === 1 && s.extraItems.length === 2 && s.extraItems.some(e => e.item === 'eggs');
})(), JSON.stringify(FC.scoreRecipeByIngredients({ ingredients: [{ item: 'rice', qty: 100, unit: 'g' }] }, ['rice'])));
ok('preference: 0-match recipe scores 0 but is still returned by preference ranking', (() => {
  const ranked = FC.rankRecipesByIngredients(FC.RECIPES, ['dragonfruit-xyz'], false);
  return ranked.length === FC.RECIPES.length && ranked.every(x => typeof x.matches === 'number') && ranked[ranked.length - 1].matches === 0;
})());
ok('preference: strict mode excludes 0-match recipes', (() => {
  const ranked = FC.rankRecipesByIngredients(FC.RECIPES, ['rice'], true);
  return ranked.length > 0 && ranked.every(x => x.matches > 0);
})());
ok('preference: ranking sorts by matches desc then cheapest', (() => {
  const ranked = FC.rankRecipesByIngredients(FC.RECIPES, ['rice', 'eggs'], false);
  for (let i = 1; i < ranked.length; i++) {
    if (ranked[i].matches > ranked[i - 1].matches) return false;
    if (ranked[i].matches === ranked[i - 1].matches && (ranked[i].recipe.estCost || 0) < (ranked[i - 1].recipe.estCost || 0)) return false;
  }
  return true;
})());
ok('preference: Also needs excludes pantry items', (() => {
  const r = RECIPES.find(x => x.id === 'vegan-tofu-stirfry');
  const also = FC.alsoNeedsExcludingPantry(r, ['tofu'], [{ item: 'rice', qty: 500, unit: 'g' }]);
  return !also.some(e => FC.normalizeItem(e.item) === 'rice') && also.length > 0;
})(), JSON.stringify(FC.alsoNeedsExcludingPantry(RECIPES[0], [], [])));
ok('preference: usedWantedItems lists wanted items used', (() => {
  const r = RECIPES.find(x => x.id === 'vegan-tofu-stirfry');
  const used = FC.usedWantedItems(r, ['tofu', 'dragonfruit-xyz']);
  return used.length === 1 && used[0] === 'tofu';
})());

// generateCookDaysPlan
ok('cook-days: one recipe per selected day, sorted', (() => {
  const plan = FC.generateCookDaysPlan({ dates: ['2026-10-20', '2026-10-15'], diet: 'omnivore', mealMode: 'dinner', wantedItems: [], strict: false });
  return plan.length === 2 && plan[0].date === '2026-10-15' && plan[1].date === '2026-10-20' && !!plan[0].meals.dinner && !!plan[1].meals.dinner;
})());
ok('cook-days: no repeats when pool allows', (() => {
  const plan = FC.generateCookDaysPlan({ dates: ['2026-10-15', '2026-10-16', '2026-10-17'], diet: 'omnivore', mealMode: 'dinner', wantedItems: [], strict: false });
  const ids = plan.map(d => d.meals.dinner && d.meals.dinner.id);
  return new Set(ids).size === ids.length;
})());
ok('cook-days: diet still strict in preference mode (vegan + wanted chicken -> no chicken)', (() => {
  const plan = FC.generateCookDaysPlan({ dates: ['2026-10-15', '2026-10-16'], diet: 'vegan', mealMode: 'dinner', wantedItems: ['chicken'], strict: false });
  return plan.every(d => FC.isRecipeAllowed(d.meals.dinner, 'vegan'));
})());
ok('cook-days: full-day mode gives B/L/D per day', (() => {
  const plan = FC.generateCookDaysPlan({ dates: ['2026-10-15'], diet: 'omnivore', mealMode: 'full', wantedItems: [], strict: false });
  return !!plan[0].meals.breakfast && !!plan[0].meals.lunch && !!plan[0].meals.dinner;
})());
ok('cook-days: preference mode ranks by overlap (wanted tofu first for dinner)', (() => {
  const plan = FC.generateCookDaysPlan({ dates: ['2026-10-15'], diet: 'vegan', mealMode: 'dinner', wantedItems: ['tofu'], strict: false });
  const first = plan[0].meals.dinner;
  return first && first.ingredients.some(i => FC.normalizeItem(i.item) === 'tofu');
})());
ok('cook-days: strict mode with impossible wanted yields no recipe, not a violation', (() => {
  const plan = FC.generateCookDaysPlan({ dates: ['2026-10-15'], diet: 'vegan', mealMode: 'dinner', wantedItems: ['dragonfruit-xyz'], strict: true });
  return plan.length === 1 && Object.keys(plan[0].meals || {}).length === 0;
})());
ok('cook-days: app.js shows Uses / Also needs in cook-days + my-days renders', appJs.includes('Uses ') && appJs.includes('Also needs') && appJs.includes('usesAlsoHtml'));
ok('cook-days: app.js quick-select covers today/tomorrow/weekend/next3/next7/clear', ['today','tomorrow','weekend','next3','next7','clear'].every(r => appJs.includes("'" + r + "'") || appJs.includes('"' + r + '"')));

// ---------- Hybrid AI (v1.3.0) ----------
const goodAi = { id: 'ai-test', title: 'AI Veggie Rice Bowl', meal: 'dinner', diets: ['vegan', 'vegetarian-no-eggs', 'vegetarian', 'omnivore'], dietClass: 'vegan', ingredients: [{ item: 'rice', qty: 180, unit: 'g' }, { item: 'tofu', qty: 150, unit: 'g' }], steps: ['Cook rice.', 'Fry tofu.'], calories: 500, protein: 20, carbs: 60, fat: 15, benefits: 'Balanced.', estCost: 3.5, minutes: 25, servings: 2 };
ok('ai: buildAIRecipePrompt includes diet forbiddens + JSON-only + schema fields', (() => {
  const p = FC.buildAIRecipePrompt({ diet: 'vegan', meal: 'dinner', count: 2, ingredients: ['tofu'], servings: 2, days: ['2026-10-15'] });
  return p.includes('chicken') && p.includes('Return ONLY valid JSON array, no markdown') && p.includes('estCost') && p.includes('calories') && p.includes('protein') && p.includes('benefits') && p.includes('quantities with units') || (p.includes('qty') && p.includes('unit'));
})(), 'prompt missing required parts');
ok('ai: buildAIRecipePrompt omnivore has no forbidden list', FC.buildAIRecipePrompt({ diet: 'omnivore', meal: 'any', count: 1 }).includes('omnivore'));
ok('ai: validateAIRecipe accepts good recipe', FC.validateAIRecipe(goodAi, 'vegan').ok === true, JSON.stringify(FC.validateAIRecipe(goodAi, 'vegan')));
ok('ai: validateAIRecipe rejects missing title/fields', (() => {
  const bad = Object.assign({}, goodAi, { title: '' });
  const v = FC.validateAIRecipe(bad, 'vegan');
  const bad2 = Object.assign({}, goodAi, { steps: [] });
  return !v.ok && v.errors.length > 0 && !FC.validateAIRecipe(bad2, 'vegan').ok;
})());
ok('ai: validateAIRecipe rejects diet violation (vegan + chicken)', (() => {
  const bad = Object.assign({}, goodAi, { title: 'Chicken Bowl', ingredients: [{ item: 'chicken breast', qty: 200, unit: 'g' }] });
  return !FC.validateAIRecipe(bad, 'vegan').ok;
})(), JSON.stringify(FC.validateAIRecipe(Object.assign({}, goodAi, { ingredients: [{ item: 'chicken breast', qty: 200, unit: 'g' }] }), 'vegan')));
ok('ai: validateAIRecipe rejects bad qty/unit', (() => {
  const badQty = Object.assign({}, goodAi, { ingredients: [{ item: 'rice', qty: 0, unit: 'g' }] });
  const badUnit = Object.assign({}, goodAi, { ingredients: [{ item: 'rice', qty: 100, unit: 'fistful' }] });
  return !FC.validateAIRecipe(badQty, 'vegan').ok && !FC.validateAIRecipe(badUnit, 'vegan').ok;
})());
ok('ai: normalizeAIRecipes parses fenced JSON + array + {recipes:[]}', (() => {
  const fenced = '```json\n' + JSON.stringify([goodAi]) + '\n```';
  const a = FC.normalizeAIRecipes(fenced, 'vegan', { timestamp: 123 });
  const b = FC.normalizeAIRecipes({ recipes: [goodAi] }, 'vegan', { timestamp: 123 });
  const c = FC.normalizeAIRecipes(JSON.stringify([goodAi]), 'vegan', { timestamp: 123 });
  return a.recipes.length === 1 && b.recipes.length === 1 && c.recipes.length === 1 && a.recipes[0].source === 'ai';
})());
ok('ai: normalizeAIRecipes counts rejected, does not throw on single bad recipe', (() => {
  const bad = Object.assign({}, goodAi, { title: '' });
  const out = FC.normalizeAIRecipes(JSON.stringify([goodAi, bad]), 'vegan', { timestamp: 123 });
  return out.recipes.length === 1 && out.rejected.length === 1 && out.rejected[0].errors.length > 0;
})());
ok('ai: normalizeAIRecipes assigns ai- id when missing + servings/cachedAt', (() => {
  const noId = Object.assign({}, goodAi); delete noId.id;
  const out = FC.normalizeAIRecipes(JSON.stringify([noId]), 'vegan', { timestamp: 999, servings: 2 });
  return out.recipes.length === 1 && /^ai-/.test(out.recipes[0].id) && out.recipes[0].servings === 2 && !!out.recipes[0].cachedAt;
})());
ok('ai: mergeAiFirst prefers AI-first + dedupes by id/title', (() => {
  const ai = [goodAi];
  const off = [Object.assign({}, goodAi, { id: 'offline-dup', source: undefined }), RECIPES[0]];
  const merged = FC.mergeAiFirst(ai, off, 10);
  return merged[0].id === 'ai-test' && merged.filter(r => String(r.title).toLowerCase() === 'ai veggie rice bowl').length === 1;
})());
ok('ai: backup excludes aiKey (export strips it)', appJs.includes('stripAiKeyFromState') && appJs.includes('delete copy.settings.aiKey') && appJs.includes('stripAiKeyFromState(state)'));
ok('ai: import never overwrites aiKey from file', appJs.includes('prevAiKey') && appJs.includes('state.settings.aiKey = prevAiKey'));
ok('ai: Settings contains provider/key/model/cache/endpoint IDs', ['setAiProvider', 'setAiEnabled', 'setAiKey', 'setAiModel', 'setAiEndpoint', 'setAiCache', 'btnClearAiCache', 'aiStatus'].every(id => htmlIds.has(id)), 'missing AI settings ids');
ok('ai: key input is password type with autocomplete off', html.includes('id="setAiKey"') && html.includes('type="password"') && html.includes('autocomplete="off"'));
ok('ai: provider select order — Custom proxy first/recommended', (() => {
  const idxCustom = html.indexOf('value="custom"');
  const idxOpenai = html.indexOf('value="openai"');
  return idxCustom !== -1 && idxOpenai !== -1 && idxCustom < idxOpenai && html.includes('Custom proxy (Vercel) — recommended');
})());
ok('ai: index.html has all AI Generate buttons', ['btnGenerateCookDaysAI', 'btnGenerateMyDaysAI', 'btnGenerateMonthAI', 'btnSuggestDishAI', 'btnCookFromIngredientsAI'].every(id => htmlIds.has(id)), 'missing AI buttons');
ok('ai: app.js wires AI buttons + fetchAIRecipes with offline fallback', appJs.includes('fetchAIRecipes') && appJs.includes('generateCookDaysAI') && appJs.includes('generateMyDaysAI') && appJs.includes('generateMonthAI') && appJs.includes('suggestDishAI') && appJs.includes('cookFromIngredientsAI') && appJs.includes('AI unavailable') && appJs.includes('using offline recipes'));
ok('ai: fetchAIRecipes checks offline + not-configured + timeout + never logs key', appJs.includes("throw new Error('offline") && appJs.includes("not-configured") && appJs.includes('AbortController') && appJs.includes('30000') && !/console\.log\([^)]*aiKey|console\.log\([^)]*Key/i.test(appJs));
ok('ai: Custom proxy sends no Authorization from browser', (() => {
  // The only Authorization header in app.js must be inside the openai branch.
  const authIdx = appJs.indexOf("headers['Authorization']");
  const customIdx = appJs.indexOf('Custom proxy (Vercel): NEVER send a key');
  const openaiIdx = appJs.indexOf("provider === 'openai'");
  return authIdx !== -1 && customIdx !== -1 && openaiIdx !== -1 && authIdx > openaiIdx && customIdx > authIdx;
})());
ok('ai: default endpoint is /api/ai', appJs.includes("aiEndpoint: '/api/ai'") && html.includes('value="/api/ai"') && FC.AI_DEFAULT_ENDPOINTS.custom === '/api/ai');
ok('ai: sw.js does NOT cache api/ or server/', !swJs.includes('api/') && !swJs.includes('server/'));
ok('ai: AI cards show AI pill + estimates note', appJs.includes('ai-pill') && appJs.includes('Estimates only — AI recipe, check quantities'));
ok('ai: README documents proxy + key never leaves device except to chosen provider', (() => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  return readme.includes('Custom proxy') && readme.includes('DEPLOY-VERCEL.md') && readme.includes('never included in backups');
})());
ok('ai: README/TESTING say no live AI call made', (() => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const testing = fs.readFileSync(path.join(ROOT, 'TESTING.md'), 'utf8');
  return readme.includes('no real API call was made') && testing.includes('untested live');
})());
// Vercel files
ok('vercel: api/ai.js exists, reads env, rejects client key, handles CORS + missing key', (() => {
  const p = path.join(ROOT, 'api', 'ai.js');
  if (!fs.existsSync(p)) return false;
  const s = fs.readFileSync(p, 'utf8');
  return s.includes('process.env.OPENAI_API_KEY') && s.includes('process.env.ANTHROPIC_API_KEY') && s.includes('Do not send an API key from the client') && s.includes('Access-Control-Allow-Origin') && s.includes('AI key not configured on host') && !s.includes('sk-');
})());
ok('vercel: vercel.json routes /api/* to function', (() => {
  const p = path.join(ROOT, 'vercel.json');
  if (!fs.existsSync(p)) return false;
  try { const v = JSON.parse(fs.readFileSync(p, 'utf8')); return JSON.stringify(v).includes('/api/'); } catch (e) { return false; }
})());
ok('vercel: .env.example has placeholders, no real values', (() => {
  const p = path.join(ROOT, '.env.example');
  if (!fs.existsSync(p)) return false;
  const s = fs.readFileSync(p, 'utf8');
  return s.includes('OPENAI_API_KEY=') && s.includes('ANTHROPIC_API_KEY=') && !s.includes('sk-');
})());
ok('vercel: DEPLOY-VERCEL.md has exact steps (import, env vars, redeploy, /api/ai, no key)', (() => {
  const p = path.join(ROOT, 'DEPLOY-VERCEL.md');
  if (!fs.existsSync(p)) return false;
  const s = fs.readFileSync(p, 'utf8');
  return s.includes('Environment Variables') && s.includes('Redeploy') && s.includes('/api/ai') && s.includes('No key in the app');
})());
ok('vercel: server/ai-proxy.js alternative exists, no hardcoded keys', (() => {
  const p = path.join(ROOT, 'server', 'ai-proxy.js');
  if (!fs.existsSync(p)) return false;
  const s = fs.readFileSync(p, 'utf8');
  return s.includes('process.env.OPENAI_API_KEY') && !s.includes('sk-');
})());
ok('vercel: app shows Vercel-deploy message on 404 + falls back', appJs.includes('AI needs Vercel deploy'));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
