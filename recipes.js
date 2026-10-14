/* Fridge Chef — offline recipe engine + pure helpers.
 * No network, no API keys. All prices / nutrition are ESTIMATES.
 * Works in browser (window.FridgeChef) and Node (module.exports) for tests.
 */
(function (global) {
  'use strict';

  // ---------- Diet keyword lists (for strict enforcement) ----------
  var MEAT_KEYWORDS = ['chicken', 'beef', 'pork', 'bacon', 'ham', 'sausage', 'turkey', 'lamb', 'steak', 'meat', 'ground beef', 'prosciutto', 'pepperoni', 'salami'];
  var FISH_KEYWORDS = ['fish', 'salmon', 'tuna', 'shrimp', 'cod', 'tilapia', 'anchovy', 'sardine', 'mackerel', 'seafood'];
  var EGG_KEYWORDS = ['egg', 'eggs', 'mayonnaise', 'mayo'];
  var DAIRY_KEYWORDS = ['milk', 'cheese', 'butter', 'yogurt', 'yoghurt', 'cream', 'ricotta', 'mozzarella', 'parmesan', 'feta', 'cheddar', 'sour cream', 'ghee'];
  var HONEY_KEYWORDS = ['honey'];

  function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // Word-boundary match: "egg" must not match "eggplant", "milk" must not match plant milks, etc.
  function containsAny(text, list) {
    var t = String(text || '').toLowerCase();
    // Neutralise look-alikes before matching: eggplant is not egg, peanut butter is not dairy butter,
    // plant milks (almond/oat/coconut/soy) are not dairy milk.
    t = t.replace(/eggplant/g, 'aubergine');
    t = t.replace(/peanut butter/g, 'peanutspread');
    t = t.replace(/almond milk/g, 'plantmilk').replace(/oat milk/g, 'plantmilk')
         .replace(/coconut milk/g, 'plantmilk').replace(/soy milk/g, 'plantmilk');
    for (var i = 0; i < list.length; i++) {
      var kw = list[i];
      var pattern;
      if (kw === 'egg' || kw === 'eggs') pattern = '\\beggs?\\b';
      else pattern = '\\b' + escapeRegExp(kw) + 's?\\b';
      // For multi-word keywords the trailing s? would be wrong; handle them exactly.
      if (kw.indexOf(' ') !== -1) pattern = '\\b' + escapeRegExp(kw) + '\\b';
      var re = new RegExp(pattern);
      if (re.test(t)) return true;
    }
    return false;
  }

  function recipeText(recipe) {
    var parts = [recipe.title || ''];
    (recipe.ingredients || []).forEach(function (ing) { parts.push(ing.item || ''); });
    return parts.join(' ').toLowerCase();
  }

  // Strict diet check: BOTH the diets array AND the ingredient keyword scan must pass.
  function isRecipeAllowed(recipe, diet) {
    if (!recipe) return false;
    if (diet === 'omnivore') return true;
    var text = recipeText(recipe);
    if (diet === 'vegan') {
      if (containsAny(text, MEAT_KEYWORDS) || containsAny(text, FISH_KEYWORDS) || containsAny(text, EGG_KEYWORDS) || containsAny(text, DAIRY_KEYWORDS) || containsAny(text, HONEY_KEYWORDS)) return false;
    } else if (diet === 'vegetarian-no-eggs') {
      if (containsAny(text, MEAT_KEYWORDS) || containsAny(text, FISH_KEYWORDS) || containsAny(text, EGG_KEYWORDS)) return false;
    } else if (diet === 'vegetarian') {
      if (containsAny(text, MEAT_KEYWORDS) || containsAny(text, FISH_KEYWORDS)) return false;
    } else {
      return false;
    }
    // Also respect the declared diets array when present.
    if (Array.isArray(recipe.diets) && recipe.diets.length) {
      if (recipe.diets.indexOf(diet) === -1) return false;
    }
    return true;
  }

  function filterRecipesByDiet(recipes, diet) {
    return (recipes || []).filter(function (r) { return isRecipeAllowed(r, diet); });
  }

  // ---------- Units / normalisation ----------
  var UNIT_TO_BASE = {
    g: { dim: 'weight', factor: 1 },
    kg: { dim: 'weight', factor: 1000 },
    mg: { dim: 'weight', factor: 0.001 },
    oz: { dim: 'weight', factor: 28.35 },
    lb: { dim: 'weight', factor: 453.592 },
    lbs: { dim: 'weight', factor: 453.592 },
    ml: { dim: 'volume', factor: 1 },
    l: { dim: 'volume', factor: 1000 },
    liter: { dim: 'volume', factor: 1000 },
    litres: { dim: 'volume', factor: 1000 },
    cup: { dim: 'volume', factor: 240 },
    cups: { dim: 'volume', factor: 240 },
    tbsp: { dim: 'volume', factor: 15 },
    tablespoon: { dim: 'volume', factor: 15 },
    tablespoons: { dim: 'volume', factor: 15 },
    tsp: { dim: 'volume', factor: 5 },
    teaspoon: { dim: 'volume', factor: 5 },
    teaspoons: { dim: 'volume', factor: 5 },
    pcs: { dim: 'count', factor: 1 },
    piece: { dim: 'count', factor: 1 },
    pieces: { dim: 'count', factor: 1 },
    slice: { dim: 'count', factor: 1 },
    slices: { dim: 'count', factor: 1 },
    clove: { dim: 'count', factor: 1 },
    cloves: { dim: 'count', factor: 1 },
    can: { dim: 'count', factor: 1 },
    cans: { dim: 'count', factor: 1 },
    bunch: { dim: 'count', factor: 1 },
    pinch: { dim: 'volume', factor: 0.5 },
    dash: { dim: 'volume', factor: 0.5 }
  };

  var KNOWN_UNITS = Object.keys(UNIT_TO_BASE);

  function normalizeUnit(u) {
    var s = String(u || 'pcs').toLowerCase().trim();
    if (!s) return 'pcs';
    if (UNIT_TO_BASE[s]) return s;
    // singular fallback
    if (s.charAt(s.length - 1) === 's' && UNIT_TO_BASE[s.slice(0, -1)]) return s.slice(0, -1);
    return 'pcs';
  }

  function unitDim(unit) {
    var n = normalizeUnit(unit);
    return UNIT_TO_BASE[n] ? UNIT_TO_BASE[n].dim : 'count';
  }

  function toBase(qty, unit) {
    var n = normalizeUnit(unit);
    var info = UNIT_TO_BASE[n] || { factor: 1, dim: 'count' };
    return { base: Number(qty || 0) * info.factor, dim: info.dim };
  }

  function fromBase(base, dim) {
    if (dim === 'weight') {
      if (base >= 1000) return { qty: Math.round((base / 1000) * 100) / 100, unit: 'kg' };
      return { qty: Math.round(base * 100) / 100, unit: 'g' };
    }
    if (dim === 'volume') {
      if (base >= 1000) return { qty: Math.round((base / 1000) * 100) / 100, unit: 'l' };
      return { qty: Math.round(base * 100) / 100, unit: 'ml' };
    }
    return { qty: Math.round(base * 100) / 100, unit: 'pcs' };
  }

  var ITEM_ALIASES = {
    'egg': 'eggs', 'eggs': 'eggs',
    'tomato': 'tomatoes', 'tomatoes': 'tomatoes',
    'potato': 'potatoes', 'potatoes': 'potatoes',
    'onion': 'onions', 'onions': 'onions',
    'carrot': 'carrots', 'carrots': 'carrots',
    'pepper': 'bell peppers', 'bell pepper': 'bell peppers', 'bell peppers': 'bell peppers',
    'chicken breast': 'chicken breast', 'chicken breasts': 'chicken breast',
    'rice': 'rice', 'brown rice': 'brown rice',
    'bread': 'bread', 'tortilla': 'tortillas', 'tortillas': 'tortillas'
  };

  function normalizeItem(name) {
    var s = String(name || '').toLowerCase().trim().replace(/\s+/g, ' ');
    s = s.replace(/^of\s+/, '');
    if (ITEM_ALIASES[s]) return ITEM_ALIASES[s];
    return s;
  }

  // ---------- Quantity parser ----------
  // Accepts: "2 cups rice", "500g rice", "500 g rice", "eggs 6", "rice 500 g", "6 eggs", "1.5 kg chicken breast", "salt"
  function parseQuantity(text) {
    var raw = String(text || '').trim();
    if (!raw) return { qty: 0, unit: 'pcs', item: '' };
    var lower = raw.toLowerCase().trim();

    // Pattern A: number first, optional unit, then item — "2 cups rice", "500g rice", "6 eggs"
    var mA = lower.match(/^([\d]+(?:\.[\d]+)?)\s*([a-z]*)\s+(.+)$/);
    if (mA) {
      var qtyA = parseFloat(mA[1]);
      var maybeUnit = mA[2];
      var restA = mA[3].trim();
      if (maybeUnit && KNOWN_UNITS.indexOf(maybeUnit) !== -1) {
        return { qty: qtyA, unit: normalizeUnit(maybeUnit), item: normalizeItem(restA) };
      }
      if (maybeUnit && normalizeUnit(maybeUnit) !== 'pcs' && UNIT_TO_BASE[maybeUnit]) {
        return { qty: qtyA, unit: normalizeUnit(maybeUnit), item: normalizeItem(restA) };
      }
      // unit token was actually part of item, e.g. "6 eggs" -> item "eggs"
      var itemA = maybeUnit ? (maybeUnit + ' ' + restA).trim() : restA;
      return { qty: qtyA, unit: 'pcs', item: normalizeItem(itemA) };
    }
    // Pattern B: number+unit glued, no item separation handled above; also "500g" alone
    var mGlued = lower.match(/^([\d]+(?:\.[\d]+)?)\s*([a-z]+)$/);
    if (mGlued && KNOWN_UNITS.indexOf(mGlued[2]) !== -1) {
      return { qty: parseFloat(mGlued[1]), unit: normalizeUnit(mGlued[2]), item: '' };
    }
    // Pattern C: item first, then number + optional unit — "eggs 6", "rice 500 g", "chicken 1.5 kg"
    var mC = lower.match(/^(.+?)\s+([\d]+(?:\.[\d]+)?)\s*([a-z]*)\s*$/);
    if (mC) {
      var itemC = mC[1].trim();
      var qtyC = parseFloat(mC[2]);
      var unitC = mC[3];
      // Guard: if item part itself starts with a number, Pattern A already handled; this is item-first.
      // Also avoid treating "2 cups" as item "2" — Pattern A covers that.
      if (!/^[\d]/.test(itemC)) {
        var uC = unitC && UNIT_TO_BASE[unitC] ? normalizeUnit(unitC) : 'pcs';
        return { qty: qtyC, unit: uC, item: normalizeItem(itemC) };
      }
    }
    // No number: assume 1 pcs
    return { qty: 1, unit: 'pcs', item: normalizeItem(lower) };
  }

  // ---------- Prices (per base unit: per g / per ml / per pcs) — ESTIMATES ----------
  var PRICES = {
    'rice': 0.004, 'brown rice': 0.005, 'oats': 0.004, 'rolled oats': 0.004, 'quinoa': 0.012,
    'pasta': 0.005, 'penne pasta': 0.005, 'spaghetti': 0.005, 'lasagna sheets': 0.008, 'pasta shells': 0.008,
    'bread': 0.45, 'tortillas': 0.45, 'flour tortillas': 0.45, 'corn tortillas': 0.4, 'bagel': 0.9,
    'eggs': 0.35, 'milk': 0.0012, 'almond milk': 0.002, 'oat milk': 0.002, 'greek yogurt': 0.006,
    'cheese': 0.012, 'cheddar cheese': 0.012, 'mozzarella cheese': 0.012, 'mozzarella': 0.012,
    'parmesan cheese': 0.025, 'parmesan': 0.025, 'feta cheese': 0.018, 'feta': 0.018, 'ricotta cheese': 0.01,
    'ricotta': 0.01, 'cream cheese': 0.01, 'butter': 0.012, 'cream': 0.004, 'sour cream': 0.006,
    'honey': 0.01, 'maple syrup': 0.012, 'peanut butter': 0.008, 'granola': 0.01,
    'chicken breast': 0.012, 'chicken': 0.011, 'ground beef': 0.011, 'beef': 0.014, 'sausage': 0.01,
    'bacon': 0.014, 'turkey slices': 0.012, 'turkey': 0.012, 'salmon': 0.02, 'tuna': 0.008,
    'shrimp': 0.018, 'smoked salmon': 0.03,
    'tofu': 0.008, 'tempeh': 0.01, 'chickpeas': 0.004, 'black beans': 0.004, 'kidney beans': 0.004,
    'lentils': 0.005, 'red lentils': 0.005,
    'tomatoes': 0.004, 'tomato sauce': 0.003, 'canned tomatoes': 0.003, 'tomato paste': 0.008,
    'onions': 0.002, 'garlic': 0.015, 'carrots': 0.002, 'bell peppers': 0.005, 'spinach': 0.008,
    'kale': 0.008, 'broccoli': 0.006, 'cauliflower': 0.005, 'zucchini': 0.004, 'mushrooms': 0.009,
    'eggplant': 0.005, 'cucumber': 0.003, 'lettuce': 0.004, 'avocado': 1.1, 'bananas': 0.3,
    'banana': 0.3, 'berries': 0.008, 'mixed berries': 0.008, 'strawberries': 0.008, 'mango': 0.009,
    'lemon': 0.5, 'lime': 0.4, 'apples': 0.6, 'apple': 0.6,
    'olive oil': 0.008, 'vegetable oil': 0.004, 'soy sauce': 0.004, 'coconut milk': 0.004,
    'curry powder': 0.02, 'cumin': 0.02, 'paprika': 0.02, 'salt': 0.001, 'black pepper': 0.03,
    'salsa': 0.005, 'corn': 0.004, 'corn kernels': 0.004, 'green beans': 0.005,
    'chia seeds': 0.015, 'walnuts': 0.02, 'almonds': 0.02, 'peanuts': 0.01, 'sunflower seeds': 0.012,
    'coconut flakes': 0.01, 'cocoa powder': 0.015, 'vanilla extract': 0.05,
    'vegetable broth': 0.002, 'chicken broth': 0.002, 'salsa verde': 0.005,
    'caesar dressing': 0.008, 'mayonnaise': 0.006, 'mustard': 0.004, 'ketchup': 0.003,
    'canned tuna': 0.008, 'canned chickpeas': 0.004, 'canned black beans': 0.004
  };

  function pricePerBase(item) {
    var n = normalizeItem(item);
    if (PRICES[n] !== undefined) return PRICES[n];
    return 0.006;
  }

  function estimateRecipeCost(recipe, servings) {
    var mult = servings || 1;
    var total = 0;
    (recipe.ingredients || []).forEach(function (ing) {
      var b = toBase(ing.qty, ing.unit);
      total += b.base * pricePerBase(ing.item);
    });
    return Math.round(total * mult * 100) / 100;
  }

  // ---------- Inventory / shopping ----------
  // pantry: [{item, qty, unit}]
  function checkInventory(recipe, pantry) {
    var missing = [];
    var list = pantry || [];
    (recipe.ingredients || []).forEach(function (ing) {
      var needItem = normalizeItem(ing.item);
      var need = toBase(ing.qty, ing.unit);
      var found = null;
      for (var i = 0; i < list.length; i++) {
        if (normalizeItem(list[i].item) === needItem) { found = list[i]; break; }
      }
      if (!found) {
        missing.push({ item: needItem, qty: ing.qty, unit: normalizeUnit(ing.unit), needed: ing.qty, have: 0, neededBase: need.base, dim: need.dim });
        return;
      }
      var have = toBase(found.qty, found.unit);
      if (have.dim !== need.dim) {
        // Incompatible units (e.g. cups vs grams) — cannot verify, treat as missing.
        missing.push({ item: needItem, qty: ing.qty, unit: normalizeUnit(ing.unit), needed: ing.qty, have: found.qty, neededBase: need.base, dim: need.dim, unitMismatch: true });
        return;
      }
      if (have.base + 1e-9 < need.base) {
        var shortBase = need.base - have.base;
        var back = fromBase(shortBase, need.dim);
        // Prefer to report shortfall in the recipe's original unit when dims match and conversion is simple.
        // For g/kg and ml/l we convert back to the recipe unit for readability.
        var shortInRecipeUnit;
        var recipeInfo = UNIT_TO_BASE[normalizeUnit(ing.unit)];
        if (recipeInfo) shortInRecipeUnit = shortBase / recipeInfo.factor;
        else shortInRecipeUnit = back.qty;
        missing.push({ item: needItem, qty: Math.round(shortInRecipeUnit * 100) / 100, unit: normalizeUnit(ing.unit), needed: ing.qty, have: found.qty, neededBase: need.base, dim: need.dim });
      }
    });
    return { hasEnough: missing.length === 0, missing: missing };
  }

  function aggregateShopping(recipes, pantry) {
    // Sum required across recipes, subtract pantry, group by item+dim in base units.
    var required = {}; // key: item|dim -> {item, dim, base}
    (recipes || []).forEach(function (r) {
      (r.ingredients || []).forEach(function (ing) {
        var item = normalizeItem(ing.item);
        var b = toBase(ing.qty, ing.unit);
        var key = item + '|' + b.dim;
        if (!required[key]) required[key] = { item: item, dim: b.dim, base: 0 };
        required[key].base += b.base;
      });
    });
    (pantry || []).forEach(function (p) {
      var item = normalizeItem(p.item);
      var b = toBase(p.qty, p.unit);
      var key = item + '|' + b.dim;
      if (required[key]) required[key].base -= b.base;
    });
    var out = [];
    Object.keys(required).sort().forEach(function (key) {
      var e = required[key];
      if (e.base <= 0.001) return;
      var disp = fromBase(e.base, e.dim);
      out.push({ item: e.item, qty: disp.qty, unit: disp.unit, base: Math.round(e.base * 100) / 100, dim: e.dim, estCost: Math.round(e.base * pricePerBase(e.item) * 100) / 100 });
    });
    return out;
  }

  function computeShoppingCost(shoppingList) {
    var total = 0;
    (shoppingList || []).forEach(function (s) { total += s.estCost || 0; });
    return Math.round(total * 100) / 100;
  }

  function computeBudgetTotal(recipes) {
    var total = 0;
    (recipes || []).forEach(function (r) { total += (typeof r.estCost === 'number' ? r.estCost : estimateRecipeCost(r, 1)); });
    return Math.round(total * 100) / 100;
  }

  // ---------- Monthly plan (pure) ----------
  function daysInMonth(year, monthZeroBased) {
    return new Date(year, monthZeroBased + 1, 0).getDate();
  }

  function toggleDay(selectedDays, isoDate) {
    var arr = (selectedDays || []).slice();
    var idx = arr.indexOf(isoDate);
    if (idx === -1) arr.push(isoDate);
    else arr.splice(idx, 1);
    arr.sort();
    return arr;
  }

  function generateMonthlyPlan(opts) {
    opts = opts || {};
    var year = opts.year != null ? opts.year : new Date().getFullYear();
    var month = opts.month != null ? opts.month : new Date().getMonth();
    var diet = opts.diet || 'omnivore';
    var restaurantCount = opts.restaurantCount != null ? opts.restaurantCount : 0;
    var budget = opts.budget != null ? opts.budget : 100;
    var overage = opts.overage != null ? opts.overage : 0;
    var dinners = filterRecipesByDiet((opts.recipes || RECIPES).filter(function (r) { return r.meal === 'dinner'; }), diet);
    if (!dinners.length) dinners = filterRecipesByDiet(opts.recipes || RECIPES, diet);
    // Cheapest-first ordering for budget compliance, with rotation to keep variety.
    var sorted = dinners.slice().sort(function (a, b) { return (a.estCost || 0) - (b.estCost || 0); });
    var totalDays = daysInMonth(year, month);
    var days = [];
    var totalCost = 0;
    // Decide restaurant nights: pick Fri/Sat first, then fill to count.
    var restaurantSet = {};
    if (restaurantCount > 0) {
      var friSat = [];
      var others = [];
      for (var d = 1; d <= totalDays; d++) {
        var dow = new Date(year, month, d).getDay();
        if (dow === 5 || dow === 6) friSat.push(d);
        else others.push(d);
      }
      var picked = friSat.slice(0, restaurantCount);
      if (picked.length < restaurantCount) picked = picked.concat(others.slice(0, restaurantCount - picked.length));
      picked.forEach(function (dd) { restaurantSet[dd] = true; });
    }
    for (var day = 1; day <= totalDays; day++) {
      if (restaurantSet[day]) {
        days.push({ day: day, date: year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0'), type: 'restaurant', recipe: null, estCost: 0 });
        continue;
      }
      // Rotate through sorted dinners, avoid immediate repeat.
      var idx = (day - 1) % sorted.length;
      var recipe = sorted[idx];
      // If over budget and we still have cheaper options, prefer cheapest for remaining days — already sorted rotation keeps cost low.
      days.push({ day: day, date: year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0'), type: 'dinner', recipe: recipe, estCost: recipe.estCost || 0 });
      totalCost += recipe.estCost || 0;
    }
    var allowed = budget + overage;
    return { year: year, month: month, days: days, totalCost: Math.round(totalCost * 100) / 100, budget: budget, overage: overage, allowed: allowed, overBudget: totalCost > allowed, restaurantCount: restaurantCount };
  }

  // ---------- Ingredient preference scoring ----------
  // wantedItems: array of item names (normalized inside). Returns matches + extra
  // ingredients (recipe ingredients NOT matching any wanted item). Preference mode
  // keeps 0-match recipes; strict mode filters them out in rankRecipesByIngredients.
  function scoreRecipeByIngredients(recipe, wantedItems) {
    var wanted = (wantedItems || []).map(function (w) { return normalizeItem(w); }).filter(Boolean);
    var matches = 0;
    var extraItems = [];
    (recipe.ingredients || []).forEach(function (ing) {
      var n = normalizeItem(ing.item);
      var matched = wanted.some(function (w) { return n === w || n.indexOf(w) !== -1 || w.indexOf(n) !== -1; });
      if (matched) matches++;
      else extraItems.push({ item: ing.item, qty: ing.qty, unit: ing.unit });
    });
    return { matches: matches, extraItems: extraItems };
  }
  // Extra ingredients the user still needs, excluding anything already in the pantry.
  function alsoNeedsExcludingPantry(recipe, wantedItems, pantry) {
    var scored = scoreRecipeByIngredients(recipe, wantedItems);
    var pantryNorm = (pantry || []).map(function (p) { return normalizeItem(p.item); });
    return scored.extraItems.filter(function (e) { return pantryNorm.indexOf(normalizeItem(e.item)) === -1; });
  }
  // Wanted items actually used by a recipe (for "Uses X of your ingredients" lines).
  function usedWantedItems(recipe, wantedItems) {
    var wanted = (wantedItems || []).map(function (w) { return normalizeItem(w); }).filter(Boolean);
    return wanted.filter(function (w) {
      return (recipe.ingredients || []).some(function (ing) {
        var n = normalizeItem(ing.item);
        return n === w || n.indexOf(w) !== -1 || w.indexOf(n) !== -1;
      });
    });
  }
  // Rank recipes by ingredient overlap (matches desc, then cheapest first).
  // strict=true keeps only matches>0; strict=false (preference mode) keeps all.
  function rankRecipesByIngredients(recipes, wantedItems, strict) {
    var scored = (recipes || []).map(function (r) {
      var s = scoreRecipeByIngredients(r, wantedItems);
      return { recipe: r, matches: s.matches, extraItems: s.extraItems };
    });
    if (strict) scored = scored.filter(function (x) { return x.matches > 0; });
    scored.sort(function (a, b) { return b.matches - a.matches || ((a.recipe.estCost || 0) - (b.recipe.estCost || 0)); });
    return scored;
  }
  // One recipe per selected day (or B/L/D per day for mealMode 'full').
  // Diet is still strictly enforced. No repeats while the pool allows it.
  function generateCookDaysPlan(opts) {
    opts = opts || {};
    var dates = (opts.dates || []).slice().sort();
    var diet = opts.diet || 'omnivore';
    var mealMode = opts.mealMode || 'dinner';
    var wanted = opts.wantedItems || [];
    var strict = !!opts.strict;
    var allRecipes = opts.recipes || RECIPES;
    var used = [];
    function pickForMeal(meal) {
      var pool = filterRecipesByDiet(allRecipes.filter(function (r) { return r.meal === meal; }), diet);
      var ranked = rankRecipesByIngredients(pool, wanted, strict);
      if (!ranked.length) return null;
      var pick = null;
      for (var i = 0; i < ranked.length; i++) {
        if (used.indexOf(ranked[i].recipe.id) === -1) { pick = ranked[i].recipe; break; }
      }
      if (!pick) pick = ranked[0].recipe;
      used.push(pick.id);
      return pick;
    }
    return dates.map(function (iso) {
      if (mealMode === 'full') {
        var meals = {};
        ['breakfast', 'lunch', 'dinner'].forEach(function (meal) {
          var p = pickForMeal(meal);
          if (p) meals[meal] = p;
        });
        return { date: iso, meals: meals };
      }
      var mealFilter = mealMode === 'any' ? null : mealMode;
      var pool = filterRecipesByDiet(mealFilter ? allRecipes.filter(function (r) { return r.meal === mealFilter; }) : allRecipes, diet);
      var ranked = rankRecipesByIngredients(pool, wanted, strict);
      if (!ranked.length) return { date: iso, meals: {}, recipe: null, meal: mealFilter };
      var chosen = null;
      for (var j = 0; j < ranked.length; j++) {
        if (used.indexOf(ranked[j].recipe.id) === -1) { chosen = ranked[j].recipe; break; }
      }
      if (!chosen) chosen = ranked[0].recipe;
      used.push(chosen.id);
      var m = {};
      m[chosen.meal] = chosen;
      return { date: iso, meals: m, recipe: chosen, meal: chosen.meal };
    });
  }

  function pickRecipeForMeal(meal, diet, avoidIds) {
    avoidIds = avoidIds || [];
    var pool = filterRecipesByDiet(RECIPES.filter(function (r) { return r.meal === meal; }), diet);
    if (!pool.length) pool = filterRecipesByDiet(RECIPES, diet);
    var candidates = pool.filter(function (r) { return avoidIds.indexOf(r.id) === -1; });
    if (!candidates.length) candidates = pool;
    // Deterministic-ish: pick cheapest candidate not recently used, else first.
    candidates.sort(function (a, b) { return (a.estCost || 0) - (b.estCost || 0); });
    // Rotate by day-of-year to vary: use avoidIds length as offset
    var idx = avoidIds.length % candidates.length;
    return candidates[idx % candidates.length];
  }

  // ---------- AI helpers (v1.3.0, pure — no network, no keys) ----------
  // Forbidden ingredients per diet, for the AI prompt + validation.
  var AI_DIET_FORBIDDEN = {
    'vegan': MEAT_KEYWORDS.concat(FISH_KEYWORDS, EGG_KEYWORDS, DAIRY_KEYWORDS, HONEY_KEYWORDS),
    'vegetarian-no-eggs': MEAT_KEYWORDS.concat(FISH_KEYWORDS, EGG_KEYWORDS),
    'vegetarian': MEAT_KEYWORDS.concat(FISH_KEYWORDS),
    'omnivore': []
  };
  var AI_DEFAULT_ENDPOINTS = {
    'openai': 'https://api.openai.com/v1/chat/completions',
    'anthropic': 'https://api.anthropic.com/v1/messages',
    'custom': '/api/ai'
  };
  var AI_DEFAULT_MODELS = {
    'openai': 'gpt-4o-mini',
    'anthropic': 'claude-sonnet-4-20250514',
    'custom': 'gpt-4o-mini'
  };
  var AI_ALLOWED_UNITS = ['pcs', 'g', 'ml', 'l', 'kg', 'cup', 'tbsp', 'tsp'];
  function aiSlug(title) {
    var s = String(title || 'recipe').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return s || 'recipe';
  }
  function buildAIRecipePrompt(opts) {
    opts = opts || {};
    var diet = opts.diet || 'omnivore';
    var meal = opts.meal || 'any';
    var count = opts.count != null ? opts.count : 3;
    var servings = opts.servings != null ? opts.servings : 2;
    var ingredients = opts.ingredients || [];
    var days = opts.days || [];
    var forbidden = AI_DIET_FORBIDDEN[diet] || [];
    var dietLine = diet === 'omnivore'
      ? 'Diet: omnivore — any ingredients are allowed.'
      : 'Diet: ' + diet + ' — STRICT RULE. NEVER use these forbidden ingredients: ' + (forbidden.length ? forbidden.join(', ') : 'none') + '. ' +
        'If a recipe would need a forbidden ingredient, do not include it. Check every ingredient against this list.';
    var mealLine = (meal === 'any' || !meal)
      ? 'Meal: any (breakfast, lunch, or dinner — set each recipe\'s "meal" field correctly).'
      : 'Meal: ' + meal + ' — every recipe must have "meal": "' + meal + '".';
    var ingLine = ingredients.length
      ? 'Preferred ingredients (a PREFERENCE, not a restriction — prefer recipes that use some of these, but other ingredients are allowed): ' + ingredients.join(', ') + '.'
      : 'No preferred ingredients — choose varied recipes.';
    var daysLine = days.length ? 'Days: ' + days.join(', ') + ' (one recipe per day/meal as requested).' : '';
    return [
      'You are a recipe generator for a home meal-planning app.',
      dietLine,
      mealLine,
      'Generate exactly ' + count + ' NEW, distinct recipes for ' + servings + ' servings each.',
      ingLine,
      daysLine,
      'Each recipe must have: id (short slug), title, meal (breakfast/lunch/dinner), diets (array of allowed diet names), dietClass, ingredients (array of {item, qty, unit}), steps (array of non-empty strings), calories (number, kcal), protein (number, g), carbs (number, g), fat (number, g), benefits (one-sentence nutritional benefit), estCost (number, estimated cost in $ for the servings), minutes (number, total minutes), servings (number).',
      'Quantities with units: every ingredient must have a numeric qty greater than 0 and a unit. Use only known units: pcs, g, ml, l, kg, cup, tbsp, tsp. Give quantities with units (e.g. 200 g rice, 2 pcs eggs, 150 ml milk).',
      'Numbers must be realistic estimates: calories/protein/carbs/fat, benefits, estCost in $, minutes. Do not invent brand names.',
      'Return ONLY valid JSON array, no markdown. No code fences, no explanation, no prose before or after the JSON. The output must parse as JSON.',
      'Example shape: [{"id":"ai-example","title":"Example","meal":"dinner","diets":["omnivore"],"dietClass":"omnivore","ingredients":[{"item":"rice","qty":180,"unit":"g"}],"steps":["Cook rice."],"calories":500,"protein":20,"carbs":60,"fat":15,"benefits":"Balanced energy.","estCost":3.5,"minutes":25,"servings":2}]'
    ].join('\n');
  }
  function validateAIRecipe(recipe, diet) {
    var errors = [];
    if (!recipe || typeof recipe !== 'object') return { ok: false, errors: ['recipe is not an object'] };
    // id is optional here — normalizeAIRecipes assigns one when missing.
    if (!recipe.title || typeof recipe.title !== 'string' || !recipe.title.trim()) errors.push('missing or empty title');
    if (['breakfast', 'lunch', 'dinner'].indexOf(recipe.meal) === -1) errors.push('meal must be breakfast, lunch, or dinner');
    if (!Array.isArray(recipe.ingredients) || !recipe.ingredients.length) errors.push('ingredients must be a non-empty array');
    else {
      recipe.ingredients.forEach(function (ing, i) {
        if (!ing || typeof ing !== 'object') { errors.push('ingredient ' + i + ' is not an object'); return; }
        if (!ing.item || typeof ing.item !== 'string' || !ing.item.trim()) errors.push('ingredient ' + i + ' missing item');
        if (typeof ing.qty !== 'number' || !isFinite(ing.qty) || ing.qty <= 0) errors.push('ingredient ' + i + ' qty must be a number > 0');
        if (!ing.unit || typeof ing.unit !== 'string') errors.push('ingredient ' + i + ' missing unit');
        else if (!UNIT_TO_BASE[String(ing.unit).toLowerCase().trim()]) errors.push('ingredient ' + i + ' has unknown unit "' + ing.unit + '"');
      });
    }
    if (!Array.isArray(recipe.steps) || !recipe.steps.length) errors.push('steps must be a non-empty array');
    else recipe.steps.forEach(function (s, i) { if (!s || typeof s !== 'string' || !s.trim()) errors.push('step ' + i + ' is empty'); });
    ['calories', 'protein', 'carbs', 'fat', 'estCost', 'minutes'].forEach(function (k) {
      if (typeof recipe[k] !== 'number' || !isFinite(recipe[k]) || recipe[k] < 0) errors.push(k + ' must be a number >= 0');
    });
    if (typeof recipe.calories === 'number' && recipe.calories <= 0) errors.push('calories must be > 0');
    if (typeof recipe.minutes === 'number' && recipe.minutes <= 0) errors.push('minutes must be > 0');
    if (!recipe.benefits || typeof recipe.benefits !== 'string' || !recipe.benefits.trim()) errors.push('missing benefits');
    if (!errors.length) {
      var checkDiet = diet || recipe.dietClass || 'omnivore';
      // Diet check: keyword scan + diets array. Use a copy with diets filled from
      // the requested diet when the AI omitted diets, so a keyword-clean recipe passes.
      var probe = Object.assign({}, recipe);
      if (!Array.isArray(probe.diets) || !probe.diets.length) probe.diets = [checkDiet];
      if (!isRecipeAllowed(probe, checkDiet)) errors.push('recipe violates diet "' + checkDiet + '"');
    }
    return { ok: errors.length === 0, errors: errors };
  }
  function stripJsonFences(text) {
    var t = String(text == null ? '' : text).trim();
    t = t.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
    return t;
  }
  function normalizeAIRecipes(jsonTextOrObj, diet, opts) {
    opts = opts || {};
    var servings = opts.servings != null ? opts.servings : 2;
    var timestamp = opts.timestamp != null ? opts.timestamp : Date.now();
    var cachedAt = opts.cachedAt || new Date(timestamp).toISOString();
    var recipes = [];
    var rejected = [];
    var parsed = null;
    var parseError = null;
    try {
      if (typeof jsonTextOrObj === 'string') parsed = JSON.parse(stripJsonFences(jsonTextOrObj));
      else parsed = jsonTextOrObj;
    } catch (e) { parseError = String(e && e.message || e); }
    if (parseError) return { recipes: [], rejected: [{ index: -1, errors: ['invalid JSON: ' + parseError], reasons: ['invalid JSON: ' + parseError] }] };
    var list = null;
    if (Array.isArray(parsed)) list = parsed;
    else if (parsed && Array.isArray(parsed.recipes)) list = parsed.recipes;
    else if (parsed && typeof parsed.text === 'string') {
      try { var inner = JSON.parse(stripJsonFences(parsed.text)); list = Array.isArray(inner) ? inner : (inner && Array.isArray(inner.recipes) ? inner.recipes : null); }
      catch (e) { return { recipes: [], rejected: [{ index: -1, errors: ['invalid JSON in text field'], reasons: ['invalid JSON in text field'] }] }; }
    }
    else if (parsed && typeof parsed === 'object' && parsed.title) list = [parsed];
    if (!list) return { recipes: [], rejected: [{ index: -1, errors: ['expected a JSON array or {recipes: [...]}'], reasons: ['expected a JSON array or {recipes: [...]}'] }] };
    list.forEach(function (entry, i) {
      if (!entry || typeof entry !== 'object') { rejected.push({ index: i, errors: ['entry is not an object'], reasons: ['entry is not an object'] }); return; }
      var copy = Object.assign({}, entry);
      if (!copy.id || typeof copy.id !== 'string' || !copy.id.trim()) copy.id = 'ai-' + aiSlug(copy.title) + '-' + timestamp + '-' + i;
      copy.source = 'ai';
      copy.cachedAt = cachedAt;
      copy.servings = servings;
      if (Array.isArray(copy.ingredients)) {
        copy.ingredients = copy.ingredients.map(function (ing) {
          if (!ing || typeof ing !== 'object') return ing;
          return { item: typeof ing.item === 'string' ? ing.item.trim() : ing.item, qty: ing.qty, unit: typeof ing.unit === 'string' ? ing.unit.toLowerCase().trim() : ing.unit };
        });
      }
      // Fill diets/dietClass from the keyword scan when the AI omitted them.
      if (!Array.isArray(copy.diets) || !copy.diets.length) {
        copy.diets = ['vegan', 'vegetarian-no-eggs', 'vegetarian', 'omnivore'].filter(function (d) {
          var probe = Object.assign({}, copy, { diets: [d] });
          return isRecipeAllowed(probe, d);
        });
      }
      if (!copy.dietClass || typeof copy.dietClass !== 'string') copy.dietClass = diet || 'omnivore';
      var v = validateAIRecipe(copy, diet || 'omnivore');
      if (!v.ok) { rejected.push({ index: i, errors: v.errors, reasons: v.errors }); return; }
      recipes.push(copy);
    });
    return { recipes: recipes, rejected: rejected };
  }
  function mergeAiFirst(aiRecipes, offlineRecipes, count) {
    var seenId = {}, seenTitle = {}, out = [];
    function push(r) {
      if (!r) return;
      var id = String(r.id || '');
      var title = String(r.title || '').toLowerCase().trim();
      if (id && seenId[id]) return;
      if (title && seenTitle[title]) return;
      if (id) seenId[id] = true;
      if (title) seenTitle[title] = true;
      out.push(r);
    }
    (aiRecipes || []).forEach(push);
    (offlineRecipes || []).forEach(push);
    if (count != null) return out.slice(0, count);
    return out;
  }
  function dedupeAiRecipes(recipes) {
    var seen = {}, out = [];
    (recipes || []).forEach(function (r) {
      var key = String(r && r.title || '').toLowerCase().trim();
      if (key && seen[key]) return;
      if (key) seen[key] = true;
      out.push(r);
    });
    return out;
  }

  // ---------- Recipes (48) ----------
  function R(id, title, meal, dietClass, diets, ingredients, steps, calories, protein, carbs, fat, benefits, estCost, minutes) {
    return { id: id, title: title, meal: meal, dietClass: dietClass, diets: diets, ingredients: ingredients, steps: steps, calories: calories, protein: protein, carbs: carbs, fat: fat, benefits: benefits, estCost: estCost, minutes: minutes, servings: 2 };
  }
  function I(item, qty, unit) { return { item: item, qty: qty, unit: unit }; }

  var RECIPES = [
    // ---- VEGAN (12) ----
    R('vegan-overnight-oats', 'Overnight Oats with Berries', 'breakfast', 'vegan', ['vegan', 'vegetarian-no-eggs', 'vegetarian', 'omnivore'],
      [I('oats', 80, 'g'), I('almond milk', 200, 'ml'), I('chia seeds', 15, 'g'), I('berries', 100, 'g'), I('maple syrup', 15, 'ml')],
      ['Mix oats, almond milk, chia and maple syrup in a jar.', 'Refrigerate overnight.', 'Top with berries and serve.'],
      340, 9, 58, 9, 'High-fibre oats + berries for antioxidants and steady energy.', 2.4, 5),
    R('vegan-tofu-scramble', 'Tofu Scramble & Avocado Toast', 'breakfast', 'vegan', ['vegan', 'vegetarian-no-eggs', 'vegetarian', 'omnivore'],
      [I('tofu', 200, 'g'), I('bread', 2, 'pcs'), I('avocado', 1, 'pcs'), I('spinach', 40, 'g'), I('olive oil', 10, 'ml'), I('turmeric', 2, 'g')],
      ['Crumble tofu and cook with oil, turmeric and spinach.', 'Toast bread.', 'Top toast with avocado and tofu scramble.'],
      420, 18, 38, 22, 'Tofu provides complete protein; avocado adds healthy fats.', 3.2, 15),
    R('vegan-smoothie-bowl', 'Banana Peanut Butter Smoothie Bowl', 'breakfast', 'vegan', ['vegan', 'vegetarian-no-eggs', 'vegetarian', 'omnivore'],
      [I('banana', 2, 'pcs'), I('peanut butter', 30, 'g'), I('almond milk', 150, 'ml'), I('oats', 30, 'g'), I('berries', 60, 'g')],
      ['Blend banana, peanut butter, almond milk and oats until thick.', 'Pour into bowl and top with berries.'],
      380, 11, 52, 14, 'Potassium from banana; protein and healthy fats from peanut butter.', 2.6, 5),
    R('vegan-chia-pudding', 'Chia Pudding with Mango', 'breakfast', 'vegan', ['vegan', 'vegetarian-no-eggs', 'vegetarian', 'omnivore'],
      [I('chia seeds', 40, 'g'), I('coconut milk', 200, 'ml'), I('mango', 150, 'g'), I('maple syrup', 10, 'ml')],
      ['Stir chia into coconut milk with maple syrup.', 'Chill 4 hours or overnight.', 'Top with mango.'],
      320, 7, 38, 18, 'Chia is rich in omega-3s and fibre; mango adds vitamin C.', 2.8, 5),
    R('vegan-chickpea-sandwich', 'Chickpea Salad Sandwich', 'lunch', 'vegan', ['vegan', 'vegetarian-no-eggs', 'vegetarian', 'omnivore'],
      [I('chickpeas', 200, 'g'), I('bread', 2, 'pcs'), I('cucumber', 60, 'g'), I('lettuce', 30, 'g'), I('mayonnaise', 0, 'g')],
      ['Mash chickpeas (see note: use vegan mayo — listed as plant mayo).', 'Mix with diced cucumber.', 'Serve on bread with lettuce.'],
      410, 13, 58, 12, 'Chickpeas give fibre and plant protein.', 2.2, 10),
    R('vegan-lentil-soup', 'Lentil Soup with Kale', 'lunch', 'vegan', ['vegan', 'vegetarian-no-eggs', 'vegetarian', 'omnivore'],
      [I('lentils', 180, 'g'), I('kale', 60, 'g'), I('carrots', 100, 'g'), I('onions', 80, 'g'), I('vegetable broth', 500, 'ml'), I('olive oil', 10, 'ml')],
      ['Saute onion and carrots in oil.', 'Add lentils and broth, simmer 25 min.', 'Stir in kale until wilted.'],
      360, 17, 52, 7, 'Lentils + kale: iron, folate and fibre.', 2.3, 35),
    R('vegan-buddha-bowl', 'Quinoa Buddha Bowl', 'lunch', 'vegan', ['vegan', 'vegetarian-no-eggs', 'vegetarian', 'omnivore'],
      [I('quinoa', 150, 'g'), I('chickpeas', 150, 'g'), I('sweet potato', 150, 'g'), I('spinach', 50, 'g'), I('avocado', 0.5, 'pcs')],
      ['Cook quinoa.', 'Roast sweet potato.', 'Assemble bowl with chickpeas, spinach and avocado.'],
      480, 16, 62, 18, 'Balanced bowl: whole grain + legume + greens.', 3.4, 25),
    R('vegan-black-bean-tacos', 'Black Bean Tacos with Corn Salsa', 'lunch', 'vegan', ['vegan', 'vegetarian-no-eggs', 'vegetarian', 'omnivore'],
      [I('black beans', 200, 'g'), I('tortillas', 3, 'pcs'), I('corn', 100, 'g'), I('tomatoes', 120, 'g'), I('avocado', 0.5, 'pcs')],
      ['Warm beans with cumin.', 'Mix corn and tomatoes for salsa.', 'Fill tortillas with beans, salsa and avocado.'],
      440, 14, 60, 14, 'Beans + corn: complementary proteins and fibre.', 2.7, 15),
    R('vegan-tofu-stirfry', 'Vegetable Stir-Fry with Tofu & Rice', 'dinner', 'vegan', ['vegan', 'vegetarian-no-eggs', 'vegetarian', 'omnivore'],
      [I('tofu', 220, 'g'), I('rice', 180, 'g'), I('bell peppers', 150, 'g'), I('broccoli', 150, 'g'), I('soy sauce', 25, 'ml'), I('garlic', 10, 'g')],
      ['Cook rice.', 'Stir-fry tofu until golden.', 'Add vegetables, garlic and soy sauce, cook 5 min. Serve over rice.'],
      520, 22, 68, 14, 'Tofu + vegetables: protein, fibre, vitamin C.', 3.5, 25),
    R('vegan-veg-pasta', 'Pasta with Roasted Vegetables & Tomato Sauce', 'dinner', 'vegan', ['vegan', 'vegetarian-no-eggs', 'vegetarian', 'omnivore'],
      [I('pasta', 200, 'g'), I('zucchini', 150, 'g'), I('bell peppers', 120, 'g'), I('tomato sauce', 250, 'ml'), I('olive oil', 15, 'ml')],
      ['Roast zucchini and peppers.', 'Cook pasta.', 'Toss with tomato sauce and roasted vegetables.'],
      560, 14, 88, 13, 'Whole vegetables + tomato lycopene.', 2.9, 30),
    R('vegan-chickpea-curry', 'Coconut Chickpea Curry with Rice', 'dinner', 'vegan', ['vegan', 'vegetarian-no-eggs', 'vegetarian', 'omnivore'],
      [I('chickpeas', 250, 'g'), I('coconut milk', 250, 'ml'), I('rice', 180, 'g'), I('onions', 80, 'g'), I('curry powder', 10, 'g'), I('spinach', 60, 'g')],
      ['Saute onion and curry powder.', 'Add chickpeas and coconut milk, simmer 15 min.', 'Stir in spinach, serve over rice.'],
      580, 16, 72, 20, 'Chickpeas + coconut: protein and healthy fats.', 3.3, 30),
    R('vegan-stuffed-peppers', 'Stuffed Bell Peppers with Lentil & Rice', 'dinner', 'vegan', ['vegan', 'vegetarian-no-eggs', 'vegetarian', 'omnivore'],
      [I('bell peppers', 4, 'pcs'), I('lentils', 150, 'g'), I('rice', 120, 'g'), I('tomato sauce', 200, 'ml'), I('onions', 60, 'g')],
      ['Cook lentils and rice.', 'Mix with tomato sauce and onion.', 'Stuff peppers, bake 25 min.'],
      460, 15, 68, 8, 'Lentils + peppers: iron, fibre, vitamin C.', 3.0, 40),

    // ---- VEGETARIAN NO EGGS (dairy ok, no eggs/meat) (12) ----
    R('vegnoegg-yogurt-parfait', 'Greek Yogurt Parfait with Granola', 'breakfast', 'vegetarian-no-eggs', ['vegetarian-no-eggs', 'vegetarian', 'omnivore'],
      [I('greek yogurt', 200, 'g'), I('granola', 50, 'g'), I('berries', 100, 'g'), I('honey', 15, 'ml')],
      ['Layer yogurt, granola and berries.', 'Drizzle honey.'],
      340, 16, 44, 9, 'Greek yogurt: high protein; berries: antioxidants.', 2.8, 5),
    R('vegnoegg-cheese-toast', 'Cheese & Tomato Toast with Fruit', 'breakfast', 'vegetarian-no-eggs', ['vegetarian-no-eggs', 'vegetarian', 'omnivore'],
      [I('bread', 2, 'pcs'), I('cheese', 60, 'g'), I('tomatoes', 100, 'g'), I('apple', 1, 'pcs')],
      ['Toast bread, top with cheese and tomato.', 'Serve with sliced apple.'],
      380, 14, 48, 14, 'Cheese provides calcium and protein.', 2.5, 8),
    R('vegnoegg-oatmeal-honey', 'Oatmeal with Milk, Honey & Walnuts', 'breakfast', 'vegetarian-no-eggs', ['vegetarian-no-eggs', 'vegetarian', 'omnivore'],
      [I('oats', 80, 'g'), I('milk', 200, 'ml'), I('honey', 15, 'ml'), I('walnuts', 25, 'g')],
      ['Cook oats in milk.', 'Top with honey and walnuts.'],
      390, 11, 58, 14, 'Oats + walnuts: fibre and omega-3s.', 1.9, 10),
    R('vegnoegg-ricotta-toast', 'Ricotta Toast with Honey & Berries', 'breakfast', 'vegetarian-no-eggs', ['vegetarian-no-eggs', 'vegetarian', 'omnivore'],
      [I('bread', 2, 'pcs'), I('ricotta cheese', 120, 'g'), I('berries', 80, 'g'), I('honey', 10, 'ml')],
      ['Spread ricotta on toast.', 'Top with berries and honey.'],
      360, 13, 48, 12, 'Ricotta: calcium and protein.', 2.9, 5),
    R('vegnoegg-caprese', 'Caprese Sandwich', 'lunch', 'vegetarian-no-eggs', ['vegetarian-no-eggs', 'vegetarian', 'omnivore'],
      [I('bread', 2, 'pcs'), I('mozzarella cheese', 100, 'g'), I('tomatoes', 120, 'g'), I('olive oil', 10, 'ml')],
      ['Layer mozzarella and tomato on bread.', 'Drizzle oil.'],
      450, 16, 44, 22, 'Mozzarella + tomato: protein and lycopene.', 3.1, 8),
    R('vegnoegg-mac-cheese', 'Mac and Cheese with Broccoli', 'lunch', 'vegetarian-no-eggs', ['vegetarian-no-eggs', 'vegetarian', 'omnivore'],
      [I('pasta', 200, 'g'), I('cheddar cheese', 120, 'g'), I('milk', 150, 'ml'), I('broccoli', 150, 'g'), I('butter', 15, 'g')],
      ['Cook pasta and broccoli.', 'Make cheese sauce with milk, butter and cheddar.', 'Combine.'],
      620, 22, 68, 24, 'Broccoli adds fibre and vitamin C to a comfort dish.', 3.2, 25),
    R('vegnoegg-quesadilla', 'Cheese Quesadilla with Black Beans & Salsa', 'lunch', 'vegetarian-no-eggs', ['vegetarian-no-eggs', 'vegetarian', 'omnivore'],
      [I('tortillas', 2, 'pcs'), I('cheese', 100, 'g'), I('black beans', 150, 'g'), I('salsa', 80, 'g')],
      ['Fill tortilla with cheese and beans.', 'Cook until cheese melts.', 'Serve with salsa.'],
      520, 20, 56, 18, 'Beans + cheese: protein and fibre.', 2.8, 12),
    R('vegnoegg-tomato-soup', 'Tomato Soup with Grilled Cheese', 'lunch', 'vegetarian-no-eggs', ['vegetarian-no-eggs', 'vegetarian', 'omnivore'],
      [I('tomato sauce', 400, 'ml'), I('bread', 2, 'pcs'), I('cheese', 70, 'g'), I('butter', 10, 'g'), I('cream', 40, 'ml')],
      ['Warm tomato sauce with cream.', 'Grill cheese sandwich.', 'Serve together.'],
      540, 16, 54, 26, 'Tomato: vitamin C and lycopene.', 2.9, 20),
    R('vegnoegg-veg-lasagna', 'Vegetable Lasagna with Ricotta & Mozzarella', 'dinner', 'vegetarian-no-eggs', ['vegetarian-no-eggs', 'vegetarian', 'omnivore'],
      [I('lasagna sheets', 200, 'g'), I('ricotta cheese', 200, 'g'), I('mozzarella cheese', 120, 'g'), I('zucchini', 150, 'g'), I('tomato sauce', 300, 'ml'), I('spinach', 80, 'g')],
      ['Layer sheets, ricotta, vegetables and sauce.', 'Top with mozzarella.', 'Bake 35 min.'],
      640, 26, 72, 24, 'Ricotta + spinach: calcium, protein, iron.', 4.2, 50),
    R('vegnoegg-mushroom-risotto', 'Mushroom Risotto with Parmesan', 'dinner', 'vegetarian-no-eggs', ['vegetarian-no-eggs', 'vegetarian', 'omnivore'],
      [I('rice', 180, 'g'), I('mushrooms', 200, 'g'), I('parmesan cheese', 50, 'g'), I('butter', 20, 'g'), I('vegetable broth', 500, 'ml'), I('onions', 60, 'g')],
      ['Saute onion and mushrooms.', 'Add rice, stir in broth gradually.', 'Finish with butter and parmesan.'],
      580, 15, 78, 18, 'Mushrooms: B vitamins; parmesan: calcium.', 3.8, 40),
    R('vegnoegg-stuffed-shells', 'Cheese & Spinach Stuffed Pasta Shells', 'dinner', 'vegetarian-no-eggs', ['vegetarian-no-eggs', 'vegetarian', 'omnivore'],
      [I('pasta shells', 200, 'g'), I('ricotta cheese', 200, 'g'), I('spinach', 100, 'g'), I('mozzarella cheese', 80, 'g'), I('tomato sauce', 250, 'ml')],
      ['Mix ricotta and spinach.', 'Stuff shells, top with sauce and mozzarella.', 'Bake 25 min.'],
      600, 24, 70, 20, 'Spinach + ricotta: iron and calcium.', 3.9, 40),
    R('vegnoegg-bean-burrito', 'Bean & Cheese Burritos with Rice', 'dinner', 'vegetarian-no-eggs', ['vegetarian-no-eggs', 'vegetarian', 'omnivore'],
      [I('tortillas', 2, 'pcs'), I('black beans', 200, 'g'), I('rice', 120, 'g'), I('cheese', 80, 'g'), I('salsa', 80, 'g')],
      ['Cook rice.', 'Warm beans.', 'Fill tortillas with rice, beans, cheese and salsa.'],
      580, 20, 74, 16, 'Beans + rice: complete protein.', 2.7, 20),

    // ---- VEGETARIAN WITH EGGS (12) ----
    R('veg-omelette', 'Veggie Omelette with Toast', 'breakfast', 'vegetarian', ['vegetarian', 'omnivore'],
      [I('eggs', 3, 'pcs'), I('bell peppers', 60, 'g'), I('spinach', 30, 'g'), I('cheese', 30, 'g'), I('bread', 1, 'pcs'), I('butter', 10, 'g')],
      ['Whisk eggs.', 'Cook vegetables, pour in eggs.', 'Add cheese, fold, serve with toast.'],
      420, 22, 28, 28, 'Eggs: complete protein and choline.', 2.6, 12),
    R('veg-egg-avocado-toast', 'Egg & Avocado Toast', 'breakfast', 'vegetarian', ['vegetarian', 'omnivore'],
      [I('eggs', 2, 'pcs'), I('bread', 2, 'pcs'), I('avocado', 1, 'pcs')],
      ['Toast bread, mash avocado.', 'Fry or boil eggs.', 'Top toast with avocado and eggs.'],
      430, 16, 34, 26, 'Egg + avocado: protein and healthy fats.', 2.9, 10),
    R('veg-egg-muffins', 'Spinach & Feta Egg Muffins', 'breakfast', 'vegetarian', ['vegetarian', 'omnivore'],
      [I('eggs', 6, 'pcs'), I('spinach', 80, 'g'), I('feta cheese', 70, 'g'), I('milk', 60, 'ml')],
      ['Whisk eggs with milk.', 'Add spinach and feta.', 'Bake in muffin tin 18 min.'],
      310, 20, 6, 22, 'Make-ahead protein breakfast.', 3.1, 25),
    R('veg-pancakes', 'Pancakes with Berries & Maple Syrup', 'breakfast', 'vegetarian', ['vegetarian', 'omnivore'],
      [I('oats', 100, 'g'), I('eggs', 1, 'pcs'), I('milk', 150, 'ml'), I('berries', 100, 'g'), I('maple syrup', 25, 'ml'), I('butter', 10, 'g')],
      ['Mix oats, egg and milk into batter.', 'Cook pancakes.', 'Top with berries and syrup.'],
      460, 13, 68, 14, 'Oats + berries: fibre and antioxidants.', 2.4, 20),
    R('veg-egg-salad', 'Egg Salad Sandwich', 'lunch', 'vegetarian', ['vegetarian', 'omnivore'],
      [I('eggs', 3, 'pcs'), I('bread', 2, 'pcs'), I('mayonnaise', 30, 'g'), I('lettuce', 20, 'g')],
      ['Boil and chop eggs.', 'Mix with mayonnaise.', 'Serve on bread with lettuce.'],
      480, 18, 36, 28, 'Eggs: protein and B12.', 2.3, 12),
    R('veg-egg-fried-rice', 'Fried Egg & Veggie Fried Rice', 'lunch', 'vegetarian', ['vegetarian', 'omnivore'],
      [I('eggs', 2, 'pcs'), I('rice', 180, 'g'), I('carrots', 80, 'g'), I('bell peppers', 80, 'g'), I('soy sauce', 20, 'ml'), I('olive oil', 10, 'ml')],
      ['Cook rice.', 'Stir-fry vegetables.', 'Add rice, soy sauce and fried egg on top.'],
      520, 16, 68, 16, 'Rice + egg + veg: balanced lunch.', 2.2, 18),
    R('veg-shakshuka', 'Shakshuka with Feta & Bread', 'lunch', 'vegetarian', ['vegetarian', 'omnivore'],
      [I('eggs', 4, 'pcs'), I('tomato sauce', 400, 'ml'), I('bell peppers', 100, 'g'), I('feta cheese', 60, 'g'), I('bread', 2, 'pcs')],
      ['Simmer tomato sauce with peppers.', 'Crack in eggs, cover until set.', 'Top with feta, serve with bread.'],
      470, 21, 42, 22, 'Tomato + eggs: vitamin C, protein, lycopene.', 3.4, 25),
    R('veg-egg-burrito', 'Egg & Cheese Breakfast Burrito', 'lunch', 'vegetarian', ['vegetarian', 'omnivore'],
      [I('eggs', 3, 'pcs'), I('tortillas', 1, 'pcs'), I('cheese', 50, 'g'), I('salsa', 60, 'g')],
      ['Scramble eggs.', 'Fill tortilla with eggs, cheese and salsa.', 'Roll and serve.'],
      480, 23, 34, 28, 'Portable protein-rich lunch.', 2.5, 12),
    R('veg-veg-fried-rice-egg', 'Vegetable Fried Rice with Egg', 'dinner', 'vegetarian', ['vegetarian', 'omnivore'],
      [I('rice', 200, 'g'), I('eggs', 2, 'pcs'), I('broccoli', 100, 'g'), I('carrots', 80, 'g'), I('soy sauce', 25, 'ml')],
      ['Cook rice.', 'Stir-fry vegetables.', 'Add rice, soy sauce, scramble in eggs.'],
      540, 17, 74, 15, 'Veg + egg: fibre and protein.', 2.3, 22),
    R('veg-eggplant-parm', 'Eggplant Parmesan with Egg', 'dinner', 'vegetarian', ['vegetarian', 'omnivore'],
      [I('eggplant', 300, 'g'), I('eggs', 1, 'pcs'), I('mozzarella cheese', 120, 'g'), I('parmesan cheese', 40, 'g'), I('tomato sauce', 300, 'ml')],
      ['Slice eggplant, dip in beaten egg.', 'Bake slices.', 'Layer with sauce and cheese, bake 20 min.'],
      560, 24, 42, 28, 'Eggplant + cheese: fibre and calcium.', 4.0, 45),
    R('veg-egg-curry', 'Spinach & Egg Curry with Rice', 'dinner', 'vegetarian', ['vegetarian', 'omnivore'],
      [I('eggs', 4, 'pcs'), I('spinach', 150, 'g'), I('rice', 180, 'g'), I('tomato sauce', 250, 'ml'), I('onions', 70, 'g'), I('curry powder', 8, 'g')],
      ['Boil eggs.', 'Cook onion, tomato sauce and curry powder.', 'Add spinach and halved eggs, serve over rice.'],
      560, 22, 64, 18, 'Eggs + spinach: protein and iron.', 3.0, 30),
    R('veg-quiche', 'Veggie Quiche with Cheese & Eggs', 'dinner', 'vegetarian', ['vegetarian', 'omnivore'],
      [I('eggs', 4, 'pcs'), I('milk', 150, 'ml'), I('cheese', 90, 'g'), I('spinach', 100, 'g'), I('mushrooms', 100, 'g')],
      ['Whisk eggs and milk.', 'Add vegetables and cheese.', 'Bake 30 min.'],
      520, 24, 14, 36, 'Quiche: protein-rich dinner.', 3.6, 40),

    // ---- OMNIVORE (12) ----
    R('omni-sausage-eggs', 'Sausage & Egg Scramble', 'breakfast', 'omnivore', ['omnivore'],
      [I('sausage', 150, 'g'), I('eggs', 3, 'pcs'), I('bread', 1, 'pcs'), I('butter', 10, 'g')],
      ['Cook sausage.', 'Scramble eggs in same pan.', 'Serve with toast.'],
      520, 26, 26, 36, 'High-protein start.', 3.5, 15),
    R('omni-chicken-wrap', 'Chicken & Egg Breakfast Wrap', 'breakfast', 'omnivore', ['omnivore'],
      [I('chicken breast', 120, 'g'), I('eggs', 2, 'pcs'), I('tortillas', 1, 'pcs'), I('cheese', 30, 'g'), I('salsa', 40, 'g')],
      ['Cook chicken and slice.', 'Scramble eggs.', 'Fill tortilla with chicken, eggs, cheese and salsa.'],
      480, 32, 32, 20, 'Chicken + egg: lean protein.', 3.4, 15),
    R('omni-salmon-bagel', 'Smoked Salmon & Cream Cheese Bagel', 'breakfast', 'omnivore', ['omnivore'],
      [I('smoked salmon', 100, 'g'), I('bagel', 1, 'pcs'), I('cream cheese', 40, 'g'), I('cucumber', 40, 'g'), I('lemon', 0.5, 'pcs')],
      ['Toast bagel.', 'Spread cream cheese.', 'Top with salmon, cucumber and lemon.'],
      450, 22, 44, 18, 'Salmon: omega-3s.', 4.2, 8),
    R('omni-beef-hash', 'Beef & Potato Hash with Eggs', 'breakfast', 'omnivore', ['omnivore'],
      [I('ground beef', 150, 'g'), I('potatoes', 200, 'g'), I('eggs', 2, 'pcs'), I('onions', 60, 'g'), I('olive oil', 10, 'ml')],
      ['Cook beef and potatoes with onion.', 'Fry eggs.', 'Top hash with eggs.'],
      580, 28, 48, 30, 'Hearty protein + iron.', 3.8, 30),
    R('omni-chicken-caesar', 'Chicken Caesar Salad', 'lunch', 'omnivore', ['omnivore'],
      [I('chicken breast', 180, 'g'), I('lettuce', 120, 'g'), I('parmesan cheese', 30, 'g'), I('caesar dressing', 40, 'ml'), I('bread', 1, 'pcs')],
      ['Grill chicken and slice.', 'Toss lettuce with dressing.', 'Top with chicken, parmesan and croutons.'],
      520, 36, 22, 28, 'Chicken: lean protein.', 4.1, 20),
    R('omni-tuna-salad', 'Tuna Salad Sandwich', 'lunch', 'omnivore', ['omnivore'],
      [I('tuna', 150, 'g'), I('bread', 2, 'pcs'), I('mayonnaise', 30, 'g'), I('lettuce', 20, 'g'), I('tomatoes', 60, 'g')],
      ['Mix tuna with mayonnaise.', 'Serve on bread with lettuce and tomato.'],
      460, 24, 40, 20, 'Tuna: omega-3s and protein.', 2.8, 10),
    R('omni-turkey-club', 'Turkey & Cheese Club Sandwich', 'lunch', 'omnivore', ['omnivore'],
      [I('turkey slices', 120, 'g'), I('bread', 3, 'pcs'), I('cheese', 40, 'g'), I('lettuce', 30, 'g'), I('tomatoes', 60, 'g'), I('mayonnaise', 20, 'g')],
      ['Layer turkey, cheese, lettuce and tomato.', 'Spread mayo, stack and slice.'],
      540, 28, 46, 22, 'Turkey: lean protein.', 3.2, 10),
    R('omni-beef-soup', 'Beef & Vegetable Soup', 'lunch', 'omnivore', ['omnivore'],
      [I('ground beef', 200, 'g'), I('carrots', 120, 'g'), I('potatoes', 150, 'g'), I('onions', 70, 'g'), I('vegetable broth', 500, 'ml'), I('tomato sauce', 150, 'ml')],
      ['Brown beef with onion.', 'Add vegetables, broth and tomato sauce.', 'Simmer 30 min.'],
      480, 26, 42, 18, 'Beef + vegetables: iron and fibre.', 3.6, 40),
    R('omni-grilled-chicken', 'Grilled Chicken with Roasted Vegetables & Rice', 'dinner', 'omnivore', ['omnivore'],
      [I('chicken breast', 200, 'g'), I('rice', 180, 'g'), I('broccoli', 150, 'g'), I('carrots', 100, 'g'), I('olive oil', 12, 'ml')],
      ['Cook rice.', 'Grill chicken.', 'Roast vegetables, serve together.'],
      580, 38, 62, 14, 'Chicken + veg: lean protein and fibre.', 4.0, 30),
    R('omni-salmon-quinoa', 'Salmon with Lemon & Quinoa', 'dinner', 'omnivore', ['omnivore'],
      [I('salmon', 200, 'g'), I('quinoa', 150, 'g'), I('spinach', 80, 'g'), I('lemon', 0.5, 'pcs'), I('olive oil', 10, 'ml')],
      ['Cook quinoa.', 'Pan-sear salmon with lemon.', 'Serve with spinach.'],
      560, 34, 48, 24, 'Salmon + quinoa: omega-3s and complete protein.', 5.2, 25),
    R('omni-beef-stirfry', 'Beef Stir-Fry with Rice', 'dinner', 'omnivore', ['omnivore'],
      [I('beef', 220, 'g'), I('rice', 180, 'g'), I('bell peppers', 150, 'g'), I('broccoli', 120, 'g'), I('soy sauce', 25, 'ml'), I('garlic', 10, 'g')],
      ['Cook rice.', 'Stir-fry beef.', 'Add vegetables, garlic and soy sauce, serve over rice.'],
      620, 34, 66, 20, 'Beef + veg: iron and protein.', 4.4, 25),
    R('omni-shrimp-pasta', 'Shrimp Pasta with Garlic & Tomatoes', 'dinner', 'omnivore', ['omnivore'],
      [I('shrimp', 220, 'g'), I('pasta', 200, 'g'), I('tomatoes', 200, 'g'), I('garlic', 12, 'g'), I('olive oil', 15, 'ml')],
      ['Cook pasta.', 'Saute garlic and tomatoes.', 'Add shrimp, cook until pink, toss with pasta.'],
      600, 32, 68, 18, 'Shrimp: lean protein, low fat.', 5.0, 22)
  ];

  // Fix vegan chickpea sandwich: replace mayonnaise (egg) with explicit plant alternative.
  // We keep the ingredient name plant-based to avoid egg keyword leak; correct the stored entry.
  RECIPES.forEach(function (r) {
    if (r.id === 'vegan-chickpea-sandwich') {
      r.ingredients = r.ingredients.map(function (ing) {
        if (ing.item === 'mayonnaise') return { item: 'hummus', qty: 40, unit: 'g' };
        return ing;
      });
    }
    // Ensure estCost is present; if missing, estimate.
    if (typeof r.estCost !== 'number') r.estCost = estimateRecipeCost(r, 1);
  });
  // Add hummus price fallback
  PRICES['hummus'] = 0.008;
  PRICES['sweet potato'] = 0.004;
  PRICES['turmeric'] = 0.02;
  PRICES['eggplant'] = 0.005;

  var api = {
    RECIPES: RECIPES, PRICES: PRICES,
    MEAT_KEYWORDS: MEAT_KEYWORDS, FISH_KEYWORDS: FISH_KEYWORDS, EGG_KEYWORDS: EGG_KEYWORDS,
    DAIRY_KEYWORDS: DAIRY_KEYWORDS, HONEY_KEYWORDS: HONEY_KEYWORDS,
    isRecipeAllowed: isRecipeAllowed, filterRecipesByDiet: filterRecipesByDiet,
    normalizeItem: normalizeItem, normalizeUnit: normalizeUnit, parseQuantity: parseQuantity,
    toBase: toBase, fromBase: fromBase, unitDim: unitDim,
    pricePerBase: pricePerBase, estimateRecipeCost: estimateRecipeCost,
    checkInventory: checkInventory, aggregateShopping: aggregateShopping,
    computeShoppingCost: computeShoppingCost, computeBudgetTotal: computeBudgetTotal,
    daysInMonth: daysInMonth, toggleDay: toggleDay,
    generateMonthlyPlan: generateMonthlyPlan, pickRecipeForMeal: pickRecipeForMeal,
    scoreRecipeByIngredients: scoreRecipeByIngredients,
    alsoNeedsExcludingPantry: alsoNeedsExcludingPantry,
    usedWantedItems: usedWantedItems,
    rankRecipesByIngredients: rankRecipesByIngredients,
    generateCookDaysPlan: generateCookDaysPlan,
    AI_DIET_FORBIDDEN: AI_DIET_FORBIDDEN, AI_DEFAULT_ENDPOINTS: AI_DEFAULT_ENDPOINTS,
    AI_DEFAULT_MODELS: AI_DEFAULT_MODELS, AI_ALLOWED_UNITS: AI_ALLOWED_UNITS,
    buildAIRecipePrompt: buildAIRecipePrompt, validateAIRecipe: validateAIRecipe,
    normalizeAIRecipes: normalizeAIRecipes, mergeAiFirst: mergeAiFirst,
    dedupeAiRecipes: dedupeAiRecipes
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { global.FridgeChef = api; global.FridgeChefRecipes = api; }
})(typeof window !== 'undefined' ? window : globalThis);
