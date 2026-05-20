#!/usr/bin/env node
/**
 * generate-plan.js — Генератор плана питания на N дней из всех рецептов.
 *
 * Improvements v2:
 *   1. Комбо-рецепты для Полдник/Чай (генерируются из продуктов)
 *   2. КБЖВ-баланс: учитываем дневной дефицит белка/калорий
 *   3. Лимит готовки: суммарная активная готовка ≤45 мин/день
 *   4. Бюджет-контроль: running total, дешёвые блюда при перерасходе
 *
 * Usage: node generate-plan.js [--seed 42] [--budget 15000] [--days 30] [--store pyaterochka] [--adults 2] [--children 1]
 */

const fs = require("fs");
const path = require("path");

// ── CLI args ────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let SEED = 42, BUDGET = 20000, DAYS = 30, STORE = "pyaterochka", ADULTS = 1, CHILDREN = 0;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--seed" && args[i+1]) SEED = Number(args[i+1]);
  if (args[i] === "--budget" && args[i+1]) BUDGET = Number(args[i+1]);
  if (args[i] === "--days" && args[i+1]) DAYS = Number(args[i+1]);
  if (args[i] === "--store" && args[i+1]) STORE = args[i+1];
  if (args[i] === "--adults" && args[i+1]) ADULTS = Number(args[i+1]);
  if (args[i] === "--children" && args[i+1]) CHILDREN = Number(args[i+1]);
}

// Family units: adult=1.0, child=0.7
const FAMILY_UNITS = Number((ADULTS * 1 + CHILDREN * 0.7).toFixed(2));
// Bulk discount: bigger families cook more efficiently
const FAMILY_SCALE = FAMILY_UNITS >= 3 ? Number((FAMILY_UNITS * 0.84).toFixed(2))
                   : FAMILY_UNITS >= 2 ? Number((FAMILY_UNITS * 0.88).toFixed(2))
                   : FAMILY_UNITS > 1   ? Number((FAMILY_UNITS * 0.92).toFixed(2))
                   : 1;
console.log(`Family: ${ADULTS} adults + ${CHILDREN} children = ${FAMILY_UNITS} units, scale=${FAMILY_SCALE}`);

// Scale portion ingredient text for family size
function scalePortionText(ingredients) {
  if (!ingredients || FAMILY_SCALE === 1) return ingredients?.join?.(", ") || "";
  return ingredients.map(s => s.replace(/(\d+(?:[.,]\d+)?)/g, (m) => {
    const n = parseFloat(m.replace(",", "."));
    const scaled = Math.round(n * FAMILY_SCALE * 10) / 10;
    return scaled % 1 === 0 ? String(scaled) : scaled.toFixed(1).replace(".", ",");
  })).join(", ");
}

// BUDGET = total monthly purchase limit (what user actually spends at the store)
// Dish cost budget = ~65% of purchase budget (rest is packaging overhead, carry-over stock)
const DISH_BUDGET = Math.round(BUDGET * 0.65);
console.log(`Budget: ${BUDGET}₽ (purchases), ${DISH_BUDGET}₽ (dish cost target)`);

// ── Seeded PRNG ─────────────────────────────────────────────────────
let _s = SEED | 0 || 1;
function rand() { _s ^= _s << 13; _s ^= _s >> 17; _s ^= _s << 5; return (_s >>> 0) / 4294967296; }
function randInt(a, b) { return a + Math.floor(rand() * (b - a + 1)); }
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = randInt(0, i); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ── Load data ───────────────────────────────────────────────────────
const readJSON = n => JSON.parse(fs.readFileSync(path.join(__dirname, "data", n), "utf-8"));
const recipes = readJSON("recipes.json").recipes;
const products = readJSON("products.json").products;
const invData = readJSON("inventory-rules.json");
const storePrices = readJSON("store-prices.json");

// Apply store-specific prices to products
const storeData = storePrices[STORE];
if (storeData) {
  console.log(`Using store: ${storeData.name} (${STORE})`);
  Object.entries(storeData.products).forEach(([pid, sp]) => {
    if (products[pid]) {
      products[pid].pricePerUnit = sp.pricePerUnit;
      products[pid].packSize = sp.packSize;
      products[pid].packPrice = sp.packPrice;
      products[pid].packLabel = sp.packLabel;
    }
  });
} else {
  console.log(`Store "${STORE}" not found in store-prices.json, using default prices`);
}
// Build base dishUsage from recipes (always per-person, never pre-scaled)
const dishUsage = {};
Object.entries(recipes).forEach(([name, r]) => {
  if (r.usage && Object.keys(r.usage).length) {
    dishUsage[name] = { ...r.usage };
  } else if (invData.dishUsage && invData.dishUsage[name]) {
    // Fallback: try to unscale from inventory-rules if familyInfo exists
    const prevScale = invData.familyInfo?.scale || 1;
    if (prevScale !== 1) {
      const raw = {};
      Object.entries(invData.dishUsage[name]).forEach(([k, v]) => {
        raw[k] = Math.round(v / prevScale * 10) / 10;
      });
      dishUsage[name] = raw;
    } else {
      dishUsage[name] = { ...invData.dishUsage[name] };
    }
  }
});
const activeMinutes = invData.activeMinutes || {};
const containerRules = invData.containerRules || {};

// dishUsage is already built from recipes above — no need to re-populate

// ── Meal compatibility ─────────────────────────────────────────────
// "Готовить свежим" (588 recipes) expanded: light ones → Полдник too
// "Быстро" added to Полдник (some quick meals fit as snack)
const TYPE_MEAL_MAP = {
  "Готовить утром": ["Завтрак"],
  "Готовить свежим": ["Завтрак", "Обед", "Полдник", "Ужин"],
  "Готовить сейчас": ["Завтрак"],
  "Собрать без готовки": ["Полдник", "Чай"],
  "Без готовки": ["Полдник", "Чай"],
  "Быстрый перекус": ["Полдник", "Чай"],
  "Быстро": ["Завтрак", "Обед", "Полдник", "Ужин", "Чай"],
  "Быстро из остатков": ["Ужин"],
  "Основное": ["Обед", "Ужин"],
  "Рагу": ["Обед", "Ужин"],
  "Готовить на 2 порции": ["Обед", "Ужин"],
  "Готовить на 2-3 порции": ["Обед"],
  "Готовить кастрюлю на 2-3 порции": ["Обед"],
  "Готовить кастрюлю на 3 порции": ["Обед"],
  "Готовка на 2 порции": ["Обед", "Ужин"],
  "Готовка на 3 порции": ["Обед"],
  "Заготовка на 4 порции": ["Обед"],
  "Заморозка": ["Обед", "Ужин"],
  "Заморозка + гарнир": ["Обед", "Ужин"],
  "Заморозка + паста": ["Ужин"],
  "Заморозка + свежий салат": ["Обед", "Ужин"],
  "Диетическое": ["Обед", "Ужин"],
  "Жареное": ["Обед", "Ужин"],
  "Запеканка": ["Обед", "Ужин"],
  "Вегетарианское": ["Обед", "Ужин"],
  "Противень/сковорода": ["Ужин"],
  "Разогреть": ["Обед", "Ужин"],
  "Рыба": ["Обед", "Ужин"],
  "Фарш или заморозка": ["Обед", "Ужин"],
  "Бюджетная классика": ["Ужин"],
};

const MEAL_TARGETS = {
  Завтрак: { kcalMin: 250 * FAMILY_SCALE, kcalMax: 700 * FAMILY_SCALE, costMin: 30 * FAMILY_SCALE, costMax: 130 * FAMILY_SCALE },
  Обед:    { kcalMin: 350 * FAMILY_SCALE, kcalMax: 900 * FAMILY_SCALE, costMin: 70 * FAMILY_SCALE, costMax: 250 * FAMILY_SCALE },
  Полдник: { kcalMin: 150 * FAMILY_SCALE, kcalMax: 420 * FAMILY_SCALE, costMin: 30 * FAMILY_SCALE, costMax: 135 * FAMILY_SCALE },
  Ужин:    { kcalMin: 300 * FAMILY_SCALE, kcalMax: 900 * FAMILY_SCALE, costMin: 50 * FAMILY_SCALE, costMax: 250 * FAMILY_SCALE },
  Чай:     { kcalMin: 50 * FAMILY_SCALE,  kcalMax: 200 * FAMILY_SCALE, costMin: 5 * FAMILY_SCALE,  costMax: 40 * FAMILY_SCALE  },
};
const MEAL_ORDER = ["Завтрак", "Обед", "Полдник", "Ужин", "Чай"];

// Daily nutrition targets (scaled for family)
const DAILY_KCAL_TARGET = Math.round(2100 * FAMILY_SCALE);
const DAILY_PROTEIN_TARGET = Math.round(120 * FAMILY_SCALE); // grams

// Max active cooking minutes per day (realistic for 3 hot meals + 2 snacks)
const MAX_DAILY_COOK_MIN = 60;

// ── 1. Generate combo recipes for Полдник/Чай ──────────────────────
// Combo prices are derived from current products (which may be store-specific)
const COMBO_PRODUCTS = {
  tvorog_g:   { name: "Творог",   unit: "г",  baseAmt: 180, price: products.tvorog_g?.pricePerUnit || 0.45, macros: { p: 0.16, f: 0.05, c: 0.03 } },
  kefir_ml:   { name: "Кефир",    unit: "мл",  baseAmt: 250, price: products.kefir_ml?.pricePerUnit || 0.069, macros: { p: 0.03, f: 0.025, c: 0.04 } },
  bananas_pcs:{ name: "Банан",    unit: "шт",  baseAmt: 1,   price: products.bananas_pcs?.pricePerUnit || 11,   macros: { p: 1.3,  f: 0.3,   c: 27 } },
  apples_g:   { name: "Яблоко",   unit: "г",  baseAmt: 150, price: products.apples_g?.pricePerUnit || 0.089, macros: { p: 0.003, f: 0,     c: 0.12 } },
  sushki_g:   { name: "Сушки",    unit: "г",  baseAmt: 30,  price: products.sushki_g?.pricePerUnit || 0.25, macros: { p: 0.1,  f: 0.03,  c: 0.75 } },
  bread_g:    { name: "Хлеб",     unit: "г",  baseAmt: 50,  price: products.bread_g?.pricePerUnit || 0.13, macros: { p: 0.08, f: 0.03,  c: 0.5 } },
  eggs_pcs:   { name: "Яйцо",     unit: "шт",  baseAmt: 1,   price: products.eggs_pcs?.pricePerUnit || 10,   macros: { p: 6.5,  f: 5,     c: 0.5 } },
  peanuts_g:  { name: "Арахис",   unit: "г",  baseAmt: 25,  price: products.peanuts_g?.pricePerUnit || 0.399, macros: { p: 0.26, f: 0.49,  c: 0.16 } },
  milk_ml:    { name: "Молоко",   unit: "мл",  baseAmt: 200, price: products.milk_ml?.pricePerUnit || 0.072, macros: { p: 0.03, f: 0.025, c: 0.047 } },
  oats_g:     { name: "Овсянка",  unit: "г",  baseAmt: 50,  price: products.oats_g?.pricePerUnit || 0.059, macros: { p: 0.13, f: 0.07,  c: 0.6 } },
  smetana_g:  { name: "Сметана",  unit: "г",  baseAmt: 30,  price: products.smetana_g?.pricePerUnit || 0.28, macros: { p: 0.025, f: 0.15,  c: 0.03 } },
};

function calcComboMacros(prodIds) {
  let kcal = 0, p = 0, f = 0, c = 0, cost = 0;
  const usage = {}, ingredients = [];
  for (const pid of prodIds) {
    const s = COMBO_PRODUCTS[pid];
    const amt = s.baseAmt;
    kcal += amt * (4 * s.macros.p + 9 * s.macros.f + 4 * s.macros.c);
    p     += amt * s.macros.p;
    f     += amt * s.macros.f;
    c     += amt * s.macros.c;
    cost  += amt * s.price;
    usage[pid] = amt;
    ingredients.push(`${s.name} — ${amt} ${s.unit}`);
  }
  return { kcal: Math.round(kcal), p: Math.round(p * 10) / 10, f: Math.round(f * 10) / 10, c: Math.round(c * 10) / 10, cost: Math.round(cost * 10) / 10, usage, ingredients };
}

// Generate 2-product and 3-product combos
const comboRecipes = {};
const prodKeys = Object.keys(COMBO_PRODUCTS);
const existingNames = new Set(Object.keys(recipes));
const existingTitles = new Set(Object.values(recipes).map(r => r.title));
// Also track lowercase versions to prevent case-variant duplicates
Object.keys(recipes).forEach(n => existingNames.add(n.toLowerCase()));
Object.values(recipes).forEach(r => { if (r.title) existingTitles.add(r.title.toLowerCase()); });

for (let size = 2; size <= 3; size++) {
  const indices = prodKeys.map((_, i) => i);
  // Generate all combinations of given size
  function* combos(arr, k, start = 0, cur = []) {
    if (cur.length === k) { yield [...cur]; return; }
    for (let i = start; i < arr.length; i++) {
      cur.push(arr[i]);
      yield* combos(arr, k, i + 1, cur);
      cur.pop();
    }
  }
  for (const idxArr of combos(indices, size)) {
    const pids = idxArr.map(i => prodKeys[i]);
    const names = pids.map(pid => COMBO_PRODUCTS[pid].name);
    const title = names.join(" + ");

    // Skip if already exists as a real recipe (case-insensitive check to avoid duplicates)
    const titleLower = title.toLowerCase();
    if (existingNames.has(title) || existingTitles.has(title) || existingNames.has(titleLower) || existingTitles.has(titleLower)) continue;

    const m = calcComboMacros(pids);

    // Determine which meal slot(s) this fits
    const fits = [];
    if (m.kcal >= 100 && m.kcal <= 500 && m.cost <= 160) fits.push("Полдник");
    if (m.kcal >= 30  && m.kcal <= 250 && m.cost <= 60)  fits.push("Чай");
    if (!fits.length) continue;

    // Create synthetic recipe object
    comboRecipes[title] = {
      title,
      source: { kind: "combo_generated", url: null, note: "Auto-generated snack combo" },
      type: "Быстрый перекус",
      time: "3 минуты",
      store: "Собрать и съесть сразу.",
      ingredients: m.ingredients,
      steps: ["Выложить на тарелку или в миску.", "Смешать или есть отдельно."],
      notes: [],
      usage: m.usage,
      activeMinutes: 2,
      containerRule: null,
      ingredientBoxes: [],
      cost: m.cost,
      costLabel: `~${Math.round(m.cost)} ₽`,
      macros: { p: m.p, f: m.f, c: m.c, kcal: m.kcal },
      kcal: m.kcal,
      quality: 3,
      box: "fridge",
      usageBoxes: [],
      _comboFits: fits, // which meals this combo fits
    };

    // Also register dishUsage
    if (!dishUsage[title]) dishUsage[title] = m.usage;
  }
}

// Merge combo recipes into main recipes object
Object.assign(recipes, comboRecipes);
console.log(`  Combo recipes generated: ${Object.keys(comboRecipes).length}`);

// ── Build candidate pools ───────────────────────────────────────────
const mealPools = {};
MEAL_ORDER.forEach(m => { mealPools[m] = []; });

Object.entries(recipes).forEach(([name, r]) => {
  const type = r.type || "?";
  const meals = TYPE_MEAL_MAP[type] || [];
  const kcal = r.macros?.kcal || r.kcal || 0;
  const cost = r.cost || 0;
  const du = dishUsage[name];

  // Skip recipes with no usage data
  if (!du || !Object.keys(du).length) return;

  // For combo recipes, use their _comboFits list
  if (r._comboFits) {
    r._comboFits.forEach(meal => {
      const t = MEAL_TARGETS[meal];
      if (cost >= t.costMin * 0.3 && cost <= t.costMax * 2 &&
          kcal >= t.kcalMin * 0.2 && kcal <= t.kcalMax * 2.5) {
        mealPools[meal].push(name);
      }
    });
    return;
  }

  meals.forEach(meal => {
    const t = MEAL_TARGETS[meal];
    if (cost >= t.costMin * 0.4 && cost <= t.costMax * 1.8 &&
        kcal >= t.kcalMin * 0.2 && kcal <= t.kcalMax * 2) {
      mealPools[meal].push(name);
    }
  });
});

MEAL_ORDER.forEach(m => console.log(`  ${m}: ${mealPools[m].length} candidates`));

// ── Helper: get recipe info ─────────────────────────────────────────
function getRecipeInfo(name) {
  const r = recipes[name];
  if (!r) return null;
  const type = r.type || "";
  const rawMin = activeMinutes[name] || r.activeMinutes || 15;
  // Calculate effective cook time (same logic as audit/actions)
  let cookMin;
  if (type.includes("Без готовки") || type.includes("Собрать без готовки") || type.includes("Быстрый перекус")) {
    cookMin = 2;
  } else if (type.includes("Разогреть")) {
    cookMin = 5;
  } else if (type.includes("Заморозка") || type.includes("Фарш")) {
    cookMin = 10;
  } else {
    cookMin = rawMin; // will be capped per meal during selection
  }
  return {
    kcal: Math.round((r.macros?.kcal || r.kcal || 0) * FAMILY_SCALE),
    protein: Math.round((r.macros?.p || 0) * FAMILY_SCALE * 10) / 10,
    fat: Math.round((r.macros?.f || 0) * FAMILY_SCALE * 10) / 10,
    carbs: Math.round((r.macros?.c || 0) * FAMILY_SCALE * 10) / 10,
    cost: Math.round((r.cost || 0) * FAMILY_SCALE),
    activeMin: rawMin,
    cookMin, // effective cook minutes (for time budget)
    type,
    isCombo: !!r._comboFits,
  };
}

// ── 2+3+4. Generate plan with КБЖВ, лимит готовки, бюджет ─────────
const plan = [];
const usedInPlan = new Set();
const containerDishes = {};
let totalCost = 0, totalKcal = 0, totalProtein = 0;

// Track dishes used today to prevent same dish twice in one day
let usedToday = new Set();

// Weekly balance tracking: заморозка/рыба/мясо limits
const MAX_FREEZE_PER_WEEK = 5;  // max frozen meals per week (out of 14 обед+ужин)
const MIN_FISH_PER_WEEK = 2;    // min fish meals per week
const MIN_MEAT_PER_WEEK = 3;    // min meat meals per week (курица, фарш, котлеты, пельмени, тефтели, наггетсы)
function getMinForWeek(weekNum, baseMin) {
  const daysInWeek = Math.min(weekNum * 7, DAYS) - (weekNum - 1) * 7;
  const mainMeals = daysInWeek * 2; // обед+ужин
  return Math.max(1, Math.round(baseMin * mainMeals / 14)); // scale to week size
}
const weekFreezeCount = {};      // {weekNum: count}
const weekFishCount = {};        // {weekNum: count}
const weekMeatCount = {};        // {weekNum: count}
function getWeek(dayNum) { return Math.ceil(dayNum / 7); }
function isMeatDish(dishName, info) {
  const usage = dishUsage[dishName] || {};
  return !!(usage.chicken_g || usage.mince_g || usage.cutlets_g || usage.meatballs_g || usage.nuggets_g || usage.pelmeni_g);
}

for (let dayNum = 1; dayNum <= DAYS; dayNum++) {
  const dayMeals = {};
  let dayCost = 0, dayKcal = 0, dayProtein = 0, dayCookMin = 0;
  usedToday = new Set(); // Reset daily — no same dish twice in one day

  // Budget tracking: how much budget remains for remaining days
  const daysRemaining = DAYS - dayNum + 1;
  const budgetRemaining = DISH_BUDGET - totalCost;
  const dailyBudgetTarget = budgetRemaining / daysRemaining;

  MEAL_ORDER.forEach(mealName => {
    // Container leftover?
    const ck = `${dayNum}-${mealName}`;
    if (containerDishes[ck]) {
      const cd = containerDishes[ck];
      const r = recipes[cd.dish];
      const info = getRecipeInfo(cd.dish);
      const c = Math.round((info?.cost || 0) * 0.4);
      const kcal = Math.round((info?.kcal || 0) * 0.4);
      const protein = Math.round((info?.protein || 0) * 0.4 * 10) / 10;
      const cookMin = 0; // leftovers don't need cooking
      dayMeals[mealName] = {
        dish: cd.dish,
        portion: scalePortionText(r?.ingredients),
        kcal, cost: c, dishCost: c, costLabel: `~${c} ₽`,
      };
      dayCost += c; dayKcal += kcal; dayProtein += protein; dayCookMin += cookMin;
      usedToday.add(cd.dish); // count container dish as used today
      // Track weekly freeze/fish/meat for container leftovers too
      if (mealName === "Обед" || mealName === "Ужин") {
        const wk = getWeek(dayNum);
        if (info?.type?.includes("Заморозка")) weekFreezeCount[wk] = (weekFreezeCount[wk] || 0) + 1;
        const isFish = info?.type?.includes("Рыба") ||
          cd.dish.toLowerCase().includes("рыб") || cd.dish.toLowerCase().includes("минта") ||
          cd.dish.toLowerCase().includes("хек") || cd.dish.toLowerCase().includes("лосо") ||
          cd.dish.toLowerCase().includes("кревет") || cd.dish.toLowerCase().includes("сардин") ||
          !!(dishUsage[cd.dish] && dishUsage[cd.dish].fish_g);
        if (isFish) weekFishCount[wk] = (weekFishCount[wk] || 0) + 1;
        if (isMeatDish(cd.dish, info)) weekMeatCount[wk] = (weekMeatCount[wk] || 0) + 1;
      }
      return;
    }

    const pool = mealPools[mealName];
    if (!pool.length) {
      dayMeals[mealName] = { dish: "—", portion: "", kcal: 0, cost: 0, dishCost: 0, costLabel: "~0 ₽" };
      return;
    }

    // Split pool into unused vs used
    const unused = pool.filter(d => !usedInPlan.has(d));
    const used = pool.filter(d => usedInPlan.has(d));

    // Score candidates — pick best of 12 random candidates
    const t = MEAL_TARGETS[mealName];
    const kcalMid = (t.kcalMin + t.kcalMax) / 2;
    const costMid = (t.costMin + t.costMax) / 2;

    // Nutrition deficit tracking for this day so far
    const kcalDeficit = Math.max(0, DAILY_KCAL_TARGET - dayKcal);
    const proteinDeficit = Math.max(0, DAILY_PROTEIN_TARGET - dayProtein);
    const mealsRemaining = MEAL_ORDER.filter(m => !dayMeals[m]).length || 1;

    // Cook time remaining
    const cookRemaining = Math.max(0, MAX_DAILY_COOK_MIN - dayCookMin);

    // Budget pressure: how much over budget we are per day
    const budgetPressure = dayCost > dailyBudgetTarget ? (dayCost - dailyBudgetTarget) / dailyBudgetTarget : 0;

    // Sample candidates: prefer unused (14), add used (10)
    const sampledUnused = shuffle(unused).slice(0, 14);
    const sampledUsed = shuffle(used).slice(0, 10);
    let candidates = [...sampledUnused, ...sampledUsed];
    if (!candidates.length) candidates.push(...shuffle(pool).slice(0, 4));

    // Guarantee fish/freeze/meat candidates when weekly balance needs them
    if (mealName === "Обед" || mealName === "Ужин") {
      const wk = getWeek(dayNum);
      const fishCount = weekFishCount[wk] || 0;
      const freezeCount = weekFreezeCount[wk] || 0;
      const meatCount = weekMeatCount[wk] || 0;
      const minFish = getMinForWeek(wk, MIN_FISH_PER_WEEK);
      const minMeat = getMinForWeek(wk, MIN_MEAT_PER_WEEK);
      if (fishCount < minFish) {
        const fishInPool = pool.filter(d => {
          const r = recipes[d];
          return r?.type?.includes("Рыба") || d.toLowerCase().includes("рыб") || d.toLowerCase().includes("минта") || d.toLowerCase().includes("хек") || d.toLowerCase().includes("лосо") || d.toLowerCase().includes("кревет") || d.toLowerCase().includes("сардин") || !!(dishUsage[d] && dishUsage[d].fish_g);
        });
        fishInPool.forEach(f => { if (!candidates.includes(f)) candidates.push(f); });
      }
      if (meatCount < minMeat) {
        const meatInPool = pool.filter(d => isMeatDish(d, getRecipeInfo(d)));
        meatInPool.forEach(m => { if (!candidates.includes(m)) candidates.push(m); });
      }
    }

    let bestDish = candidates[0], bestScore = Infinity;
    for (const d of candidates) {
      const info = getRecipeInfo(d);
      if (!info) continue;

      let score = 0;

      // --- Base: distance to kcal/cost midpoint ---
      score += Math.abs(info.kcal - kcalMid) * 1;
      score += Math.abs(info.cost - costMid) * 2;

      // --- 2. КБЖВ-баланс: prefer dishes that fill protein deficit ---
      if (proteinDeficit > 20) {
        // High protein deficit: strongly prefer protein-rich dishes
        score -= info.protein * 3;
      } else if (proteinDeficit > 5) {
        // Moderate deficit: mild preference
        score -= info.protein * 1;
      }

      // Prefer dishes closer to meal kcal target (not too high, not too low)
      const kcalDev = Math.abs(info.kcal - kcalMid);
      score += kcalDev * 1.0;
      // Extra preference for higher-kcal when day total is below target
      if (kcalDeficit > 300 && info.kcal > kcalMid) {
        score -= (info.kcal - kcalMid) * 1.2;
      } else if (kcalDeficit > 150 && info.kcal > kcalMid) {
        score -= (info.kcal - kcalMid) * 0.6;
      }
      // Discourage very low-kcal dishes for main meals (Обед/Ужин)
      if ((mealName === "Обед" || mealName === "Ужин") && info.kcal < kcalMid * 0.5) {
        score += 600;
      } else if ((mealName === "Обед" || mealName === "Ужин") && info.kcal < kcalMid * 0.7) {
        score += 200;
      }
      // Extra preference for lower-kcal when day total is above target
      const kcalSurplus = Math.max(0, dayKcal - DAILY_KCAL_TARGET * 1.2);
      if (kcalSurplus > 200 && info.kcal < kcalMid) {
        score -= (kcalMid - info.kcal) * 0.3;
      }

      // --- 3. Лимит готовки: penalize dishes that exceed remaining cook time ---
      // Cap cook time per meal slot (same as audit)
      const mealCap = mealName === "Завтрак" ? 30 : mealName === "Обед" || mealName === "Ужин" ? 45 : 10;
      const dishCook = Math.min(info.cookMin, mealCap);
      const mealsLeft = MEAL_ORDER.filter(m => !dayMeals[m]).length;
      // Reserve time for remaining meals (avg 8 min for hot, 2 min for snack)
      const hotMealsLeft = MEAL_ORDER.filter(m => !dayMeals[m] && (m === "Завтрак" || m === "Обед" || m === "Ужин")).length;
      const snackMealsLeft = MEAL_ORDER.filter(m => !dayMeals[m] && (m === "Полдник" || m === "Чай")).length;
      const reservedTime = hotMealsLeft * 8 + snackMealsLeft * 2;
      const effectiveRemaining = cookRemaining - reservedTime;
      if (dishCook > Math.max(0, effectiveRemaining + 5)) {
        score += 1200; // very long cook — strongly prefer shorter
      } else if (dishCook > Math.max(0, effectiveRemaining)) {
        score += 600; // tight on time
      } else if (dishCook > Math.max(0, effectiveRemaining) * 0.8) {
        score += 200; // getting close
      }
      // Prefer quick dishes when daily cook budget is half-spent
      if (dayCookMin > MAX_DAILY_COOK_MIN * 0.5) {
        score += dishCook * 12;
      } else if (dayCookMin > MAX_DAILY_COOK_MIN * 0.3) {
        score += dishCook * 4;
      }

      // Bonus for quick-cook types (Разогреть, Заморозка) when cook budget is tight
      if (dayCookMin > MAX_DAILY_COOK_MIN * 0.5) {
        if (info.type.includes("Разогреть")) score -= 40;
        if (info.type.includes("Заморозка")) score -= 20;
        if (info.cookMin <= 10) score -= 30;
      }

      // --- 4. Бюджет-контроль: penalize expensive dishes when over budget ---
      const globalBudgetUsed = totalCost + dayCost;
      const globalBudgetTarget = DISH_BUDGET * (dayNum / DAYS);
      const globalOver = globalBudgetUsed - globalBudgetTarget;
      if (globalOver > 500) {
        // Way over budget trajectory: strongly prefer cheap
        score += info.cost * 6;
      } else if (globalOver > 0) {
        // Slightly over trajectory: moderate preference for cheap
        score += info.cost * 3;
      }
      if (budgetPressure > 0.3) {
        score += info.cost * 3;
      } else if (budgetPressure > 0.1) {
        score += info.cost * 1.5;
      }

      // --- Same-day repeat: strongly discourage (no same dish twice in one day) ---
      if (usedToday.has(d)) {
        score += 600;
      }

      // --- Novelty bonus: strongly prefer unused recipes ---
      if (!usedInPlan.has(d)) {
        // Stronger bonus for meals with more repeats
        const mealRepeats = [...usedInPlan].filter(u => mealPools[mealName]?.includes(u)).length;
        score -= 50 + Math.min(mealRepeats * 5, 100);
      } else {
        // Penalty for already-used dishes, increasing with repeat count
        // Count how many times this dish has been used so far in the plan
        const planDishes = plan.flatMap(p => Object.values(p.meals).map(m => m.dish));
        const timesUsed = planDishes.filter(x => x === d).length;
        if (timesUsed >= 4) score += 200;      // discourage: 4+ times
        else if (timesUsed >= 3) score += 100;  // mild: 3 times
        else if (timesUsed >= 2) score += 80;   // mild penalty: 2 times
      }

      // --- 5. Заморозка/рыба баланс ---
      if (mealName === "Обед" || mealName === "Ужин") {
        const wk = getWeek(dayNum);
        const freezeCount = weekFreezeCount[wk] || 0;
        const fishCount = weekFishCount[wk] || 0;

        // Discourage frozen dishes if already at or near weekly limit
        if (info.type.includes("Заморозка") && freezeCount >= MAX_FREEZE_PER_WEEK) {
          score += 500; // strongly discourage
        } else if (info.type.includes("Заморозка") && freezeCount >= MAX_FREEZE_PER_WEEK - 1) {
          score += 200; // discourage
        } else if (info.type.includes("Заморозка") && freezeCount >= MAX_FREEZE_PER_WEEK - 2) {
          score += 60; // mild
        }

        // Bonus for fish if weekly minimum not met
        const isFish = info.type.includes("Рыба") ||
          d.toLowerCase().includes("рыб") ||
          d.toLowerCase().includes("минта") ||
          d.toLowerCase().includes("хек") ||
          d.toLowerCase().includes("лосо") ||
          d.toLowerCase().includes("кревет") ||
          d.toLowerCase().includes("сардин") ||
          !!(dishUsage[d] && dishUsage[d].fish_g);
        const minFish = getMinForWeek(wk, MIN_FISH_PER_WEEK);
        if (isFish && fishCount < minFish) {
          score -= 80; // prefer fish when below minimum
        } else if (isFish && fishCount < minFish + 1) {
          score -= 20; // slight preference
        }

        // Bonus for meat if weekly minimum not met
        const meatCount = weekMeatCount[wk] || 0;
        const minMeat = getMinForWeek(wk, MIN_MEAT_PER_WEEK);
        const isMeat = isMeatDish(d, info);
        if (isMeat && meatCount < minMeat) {
          score -= 80; // prefer meat when below minimum
        } else if (isMeat && meatCount < minMeat + 1) {
          score -= 20; // slight preference
        }
      }

      if (score < bestScore) { bestScore = score; bestDish = d; }
    }

    const r = recipes[bestDish];
    const info = getRecipeInfo(bestDish);
    usedInPlan.add(bestDish);
    usedToday.add(bestDish);
    const c = Math.round(info.cost || 0);

    // Track weekly freeze/fish counts
    if (mealName === "Обед" || mealName === "Ужин") {
      const wk = getWeek(dayNum);
      if (info.type.includes("Заморозка")) {
        weekFreezeCount[wk] = (weekFreezeCount[wk] || 0) + 1;
      }
      const isFish = info.type.includes("Рыба") ||
        bestDish.toLowerCase().includes("рыб") ||
        bestDish.toLowerCase().includes("минта") ||
        bestDish.toLowerCase().includes("хек") ||
        bestDish.toLowerCase().includes("лосо") ||
        bestDish.toLowerCase().includes("кревет") ||
        bestDish.toLowerCase().includes("сардин") ||
        !!(dishUsage[bestDish] && dishUsage[bestDish].fish_g);
      if (isFish) {
        weekFishCount[wk] = (weekFishCount[wk] || 0) + 1;
      }
      const isMeat = isMeatDish(bestDish, info);
      if (isMeat) {
        weekMeatCount[wk] = (weekMeatCount[wk] || 0) + 1;
      }
    }

    dayMeals[mealName] = {
      dish: bestDish,
      portion: scalePortionText(r.ingredients),
      kcal: info.kcal,
      cost: c,
      dishCost: c,
      costLabel: `~${c} ₽`,
    };
    dayCost += c;
    dayKcal += info.kcal;
    dayProtein += info.protein;
    const mealCap = mealName === "Завтрак" ? 30 : mealName === "Обед" || mealName === "Ужин" ? 45 : 10;
    dayCookMin += Math.min(info.cookMin, mealCap);

    // Container rule: mark future slots (cook once, eat next day too)
    const cr = r.containerRule || containerRules[bestDish];
    if (cr && (cr.maxExtra || 0) >= 1 && (mealName === "Обед" || mealName === "Ужин")) {
      const maxExtra = cr.maxExtra || 1;
      const maxDays = cr.maxDays || 7;
      let extra = 0;
      for (let d = dayNum + 1; d <= DAYS && extra < maxExtra && (d - dayNum) <= maxDays; d++) {
        for (const fm of ["Обед", "Ужин"]) {
          const key = `${d}-${fm}`;
          if (!containerDishes[key]) {
            containerDishes[key] = { dish: bestDish, sourceDay: dayNum };
            extra++;
            break; // one slot per day
          }
        }
      }
    }
  });

  plan.push({
    day_cycle: ((dayNum - 1) % 7) + 1,
    title: `${dayMeals["Завтрак"].dish} + ${dayMeals["Ужин"].dish} · ~${dayCost} ₽`,
    cost: dayCost,
    shopping_type: dayNum <= 7 ? "week1" : dayNum <= 14 ? "week2" : dayNum <= 21 ? "week3" : dayNum <= 28 ? "week4" : "topup",
    meals: dayMeals,
  });
  totalCost += dayCost; totalKcal += dayKcal; totalProtein += dayProtein;
}

console.log(`\nPlan: ${usedInPlan.size} unique dishes, ${totalCost}₽, avg ${Math.round(totalKcal/DAYS)} kcal/day, avg ${Math.round(totalProtein/DAYS)}g protein/day`);

// ── Generate actions ───────────────────────────────────────────────
const actions = {};
for (let dayNum = 1; dayNum <= DAYS; dayNum++) {
  const dayActions = [];
  const meals = plan[dayNum - 1].meals;

  MEAL_ORDER.forEach(mn => {
    const meal = meals[mn];
    const r = recipes[meal.dish];
    if (!r) return;
    const type = r.type || "";
    const min = activeMinutes[meal.dish] || r.activeMinutes || 15;

    if (type.includes("Без готовки") || type.includes("Собрать без готовки") || type.includes("Быстрый перекус")) {
      dayActions.push({ time: mn === "Чай" ? "21:00" : mn === "Полдник" ? "16:00" : "07:30", action: `Собрать: ${meal.dish}`, minutes: 2 });
    } else if (type.includes("Разогреть")) {
      dayActions.push({ time: mn === "Обед" ? "12:30" : "19:00", action: `Разогреть: ${meal.dish}`, minutes: 5 });
    } else if (type.includes("Заморозка") || type.includes("Фарш")) {
      dayActions.push({ time: mn === "Обед" ? "12:00" : "18:30", action: `Разогреть/собрать: ${meal.dish}`, minutes: 10 });
    } else if (type.includes("Готовить утром") || mn === "Завтрак") {
      dayActions.push({ time: "07:15", action: `Готовить: ${meal.dish}`, minutes: Math.min(min, 30) });
    } else {
      dayActions.push({ time: mn === "Обед" ? "12:00" : "18:30", action: `Готовить: ${meal.dish}`, minutes: Math.min(min, 45) });
    }
  });

  actions[String(dayNum)] = dayActions;
}

// ── Save helper ─────────────────────────────────────────────────────
const writeJSON = (n, d) => fs.writeFileSync(path.join(__dirname, "data", n), JSON.stringify(d, null, 2), "utf-8");

// ── Save combo recipes to recipes.json ──────────────────────────────
const recipesData = readJSON("recipes.json");
Object.entries(comboRecipes).forEach(([name, r]) => {
  if (!recipesData.recipes[name]) {
    // Remove internal field before saving
    const { _comboFits, ...clean } = r;
    recipesData.recipes[name] = clean;
  }
});
writeJSON("recipes.json", recipesData);
console.log(`  Combo recipes saved to recipes.json`);

// ── Generate purchases (with carry-over + mid-week topups) ──────────
const periodRanges = { week1: [1,7], week2: [8,14], week3: [15,21], week4: [22,28], topup: [29, DAYS] };
const purchaseDays = { week1: 1, week2: 8, week3: 15, week4: 22, topup: 29 };

// Perishable products that need mid-week topups
const PERISHABLES = ["tvorog_g", "milk_ml", "bread_g", "kefir_ml", "bananas_pcs", "smetana_g", "cheese_g", "sausage_g", "mushrooms_g", "cucumber_g", "mayo_g", "cream_ml", "butter_g", "tomato_g", "pepper_g", "herbs_g", "juice_ml", "mors_ml"];
// Shelf life in days for perishables (closed pack in fridge)
const SHELF_LIFE = { tvorog_g: 7, milk_ml: 7, bread_g: 7, kefir_ml: 10, bananas_pcs: 5, smetana_g: 14, cheese_g: 14, sausage_g: 7, mushrooms_g: 5, cucumber_g: 7, mayo_g: 14, cream_ml: 7, butter_g: 30, tomato_g: 7, pepper_g: 7, herbs_g: 4, juice_ml: 4, mors_ml: 5 };

// Calculate usage per period, accounting for container scaling
// When a dish with containerRule is cooked fresh, it uses ingredients for
// (1 + future portions) servings, not just 1
const coveredTargets = new Set();
function mealTargetKey(dayNum, mealName) { return `${dayNum}:${mealName}`; }

function findContainerTargets(dish, dayNum, mealName) {
  const rule = containerRules[dish] || recipes[dish]?.containerRule;
  if (!rule || (mealName !== "Обед" && mealName !== "Ужин")) return [];
  const targets = [];
  for (let d = dayNum + 1; d <= DAYS && targets.length < (rule.maxExtra || rule.portions - 1 || 1); d++) {
    const diff = d - dayNum;
    if (diff > (rule.maxDays || 7)) break;
    for (const futureMeal of ["Обед", "Ужин"]) {
      const key = mealTargetKey(d, futureMeal);
      if (coveredTargets.has(key)) continue;
      const futureMealData = plan[d - 1]?.meals[futureMeal];
      if (futureMealData && futureMealData.dish === dish) {
        targets.push({ day: d, mealName: futureMeal, key });
        coveredTargets.add(key);
        break;
      }
    }
    if (targets.length >= (rule.maxExtra || 1)) break;
  }
  return targets;
}

// Build scaledDishUsage FIRST (same rounding as what will be saved to inventory-rules.json)
// This ensures purchase calculation uses identical values to what the audit will check against
const scaledDishUsage = {};
Object.entries(dishUsage).forEach(([dish, usage]) => {
  scaledDishUsage[dish] = {};
  Object.entries(usage).forEach(([prod, amt]) => {
    scaledDishUsage[dish][prod] = Math.round(amt * FAMILY_SCALE * 10) / 10;
  });
});

// Calculate container-scaled usage per period for purchases
// The audit deducts full multi-portion usage on cook day, so purchases must cover that
// IMPORTANT: use scaledDishUsage (not base dishUsage) to match audit rounding
const periodUsage = {};
const coveredTargetsPurch = new Set();
Object.entries(periodRanges).forEach(([key, [start, end]]) => {
  const usage = {};
  for (let i = start - 1; i < end && i < plan.length; i++) {
    const dayNum = i + 1;
    const dayPlan = plan[i];
    MEAL_ORDER.forEach(mealName => {
      const meal = dayPlan.meals[mealName];
      if (!meal || meal.dish === "—") return;

      // Check if this is a container leftover (already counted when cooked fresh)
      const ck = `${dayNum}-${mealName}`;
      if (containerDishes[ck]) return;

      const du = scaledDishUsage[meal.dish] || {};
      // Find container targets (same logic as audit)
      const rule = containerRules[meal.dish] || recipes[meal.dish]?.containerRule;
      let portions = 1;
      if (rule && (mealName === "Обед" || mealName === "Ужин")) {
        let found = 0;
        for (let d = dayNum + 1; d <= DAYS && found < (rule.maxExtra || 1); d++) {
          const diff = d - dayNum;
          if (diff > (rule.maxDays || 7)) break;
          for (const fm of ["Обед", "Ужин"]) {
            const fkey = `${d}:${fm}`;
            if (coveredTargetsPurch.has(fkey)) continue;
            const fmData = plan[d - 1]?.meals[fm];
            if (fmData && fmData.dish === meal.dish) {
              found++;
              coveredTargetsPurch.add(fkey);
              break;
            }
          }
        }
        portions = 1 + found;
      }

      Object.entries(du).forEach(([prod, amt]) => {
        // Use same rounding as audit: per-dish rounded value * portions
        usage[prod] = (usage[prod] || 0) + Math.round(amt * portions * 10) / 10;
      });
    });
  }
  periodUsage[key] = usage;
});

// Build purchases that cover usage (with carry-over from previous periods)
// For perishables: no carry-over (freshness), buy fresh each period
// For non-perishables: carry-over works fine
const purchases = [], packageOrders = {};
let carryStock = {}; // leftover from previous period (non-perishables only)

Object.entries(periodUsage).forEach(([key, needed]) => {
  const [start, end] = periodRanges[key];
  const midDay = Math.floor((start + end) / 2);
  const items = {}, packages = [];
  const topupItems = {}, topupPackages = [];

  // Subtract carry-over stock (non-perishables only)
  // Add 2% buffer to cover decimal rounding differences between purchase calc and audit
  const PURCHASE_BUFFER = 1.02;
  const netNeeded = {};
  Object.entries(needed).forEach(([prod, amt]) => {
    const bufferedAmt = amt * PURCHASE_BUFFER;
    if (PERISHABLES.includes(prod)) {
      // No carry-over for perishables — buy fresh each period
      // Round UP to ensure purchases cover decimal usage amounts
      netNeeded[prod] = Math.ceil(bufferedAmt);
    } else {
      const carry = carryStock[prod] || 0;
      const net = Math.max(0, Math.ceil(bufferedAmt) - Math.floor(carry));
      carryStock[prod] = Math.max(0, carry - amt); // track actual (unbuffered) carry
      if (net > 0) netNeeded[prod] = net;
    }
  });

  // For each product: buy in real store packs (Пятёрочка/Магнит)
  // packSize/packPrice from products.json define actual store packaging
  // Loose items (vegetables, fruits) can be bought by exact weight
  const LOOSE_PRODUCTS = new Set(['potatoes_g','cabbage_g','roots_g','apples_g','chicken_g','fish_g','mince_g','pork_g','beef_g','beet_g']);

  function buyInPacks(productId, amount, forceMinPacks) {
    const p = products[productId] || {};
    const unit = p.unit || "г", name = p.name || productId;
    const packSize = p.packSize || 1;
    const packPrice = p.packPrice || 0;
    const packLabel = p.packLabel || `${packSize} ${unit}`;

    // Loose items: buy exact weight (vegetables, fruits, meat by weight)
    if (LOOSE_PRODUCTS.has(productId)) {
      const total = Math.ceil(amount);
      const pricePerUnit = p.pricePerUnit || 0;
      return { name, unit, packSize: total, packCount: 1, total, packPrice: Math.round(total * pricePerUnit), packLabel: `${total} ${unit}`, isLoose: true };
    }

    const packCount = Math.ceil(amount / packSize);
    if (packCount <= 0) return null;
    // Minimum packs override for very short-lived perishables
    const minPacks = forceMinPacks || 1;
    const finalPackCount = Math.max(packCount, minPacks);
    const total = packSize * finalPackCount;
    return { name, unit, packSize, packCount: finalPackCount, total, packPrice: packPrice * finalPackCount, packLabel, isLoose: false };
  }

  Object.entries(netNeeded)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([prod, amt]) => {
      const p = products[prod] || {};
      const isPerishable = PERISHABLES.includes(prod);
      const shelfLife = SHELF_LIFE[prod] || 30;
      const periodLen = end - start + 1;

      if (isPerishable && periodLen > shelfLife) {
        // Period exceeds shelf life — need two deliveries.
        // Calculate actual usage per sub-period from the plan, not proportional.
        const mainEnd = start + shelfLife - 1;
        const topupStart = mainEnd + 1;
        let mainAmt = 0, topupAmt = 0;
        // Sum actual usage per day for this product in each sub-period
        for (let di = start - 1; di < end && di < plan.length; di++) {
          const dayPlan = plan[di];
          let dayUsage = 0;
          MEAL_ORDER.forEach(mealName => {
            const meal = dayPlan.meals[mealName];
            if (!meal || meal.dish === "—") return;
            const ck = `${di + 1}-${mealName}`;
            if (containerDishes[ck]) return;
            const dusage = scaledDishUsage[meal.dish] || {};
            dayUsage += dusage[prod] || 0;
            // Container scaling (same logic as periodUsage above)
            const rule = containerRules[meal.dish] || recipes[meal.dish]?.containerRule;
            if (rule && (mealName === "Обед" || mealName === "Ужин")) {
              let found = 0;
              for (let dd = di + 2; dd <= DAYS && found < (rule.maxExtra || 1); dd++) {
                const diff = dd - (di + 1);
                if (diff > (rule.maxDays || 7)) break;
                for (const fm of ["Обед", "Ужин"]) {
                  const fmData = plan[dd - 1]?.meals[fm];
                  if (fmData && fmData.dish === meal.dish) { found++; break; }
                }
              }
              dayUsage += (dusage[prod] || 0) * found;
            }
          });
          if (di + 1 <= mainEnd) mainAmt += dayUsage;
          else topupAmt += dayUsage;
        }

        // Main purchase (available day 1) — add buffer for perishables (20% for short-lived, 10% for others)
        const perishableBuffer = shelfLife <= 5 ? 1.2 : 1.1;
        const mainPack = buyInPacks(prod, mainAmt * perishableBuffer, isPerishable && SHELF_LIFE[prod] <= 3 ? 2 : undefined);
        if (mainPack) {
          items[prod] = mainPack.total;
          packages.push([`${mainPack.name} ${mainPack.packLabel}`, prod, mainPack.packSize, mainPack.packCount]);
        }

        // Topup purchase (available mid-week) — add buffer
        const topupPack = buyInPacks(prod, topupAmt * perishableBuffer, isPerishable && SHELF_LIFE[prod] <= 3 ? 2 : undefined);
        if (topupPack && topupPack.packCount > 0) {
          topupItems[prod] = topupPack.total;
          topupPackages.push([`${topupPack.name} ${topupPack.packLabel}`, prod, topupPack.packSize, topupPack.packCount]);
        }
      } else if (isPerishable) {
        // Perishable but period <= shelfLife: buy all at once (fits within shelf life)
        const pack = buyInPacks(prod, amt);
        if (pack) {
          items[prod] = pack.total;
          packages.push([`${pack.name} ${pack.packLabel}`, prod, pack.packSize, pack.packCount]);
        }
      } else {
        // Non-perishable: buy all at once in real packs, carry over leftovers
        const pack = buyInPacks(prod, amt);
        if (pack) {
          items[prod] = pack.total;
          carryStock[prod] = (carryStock[prod] || 0) + (pack.total - amt);
          packages.push([`${pack.name} ${pack.packLabel}`, prod, pack.packSize, pack.packCount]);
        }
      }
    });

  const orderDay = purchaseDays[key] || 1;
  purchases.push({ key, title: `Заказ ${key}`, orderDay: orderDay - 1, availableDay: orderDay, items });
  packageOrders[key] = packages;

  // Mid-week topup for perishables
  if (Object.keys(topupItems).length > 0) {
    const topupKey = `${key}-mid`;
    const topupAvailDay = midDay;
    purchases.push({ key: topupKey, title: `Докупка ${key}`, orderDay: topupAvailDay - 1, availableDay: topupAvailDay, items: topupItems });
    packageOrders[topupKey] = topupPackages;
  }
});

let purchaseCost = 0;
purchases.forEach(p => { Object.entries(p.items).forEach(([prod, amt]) => {
  const pr = products[prod] || {};
  const packSize = pr.packSize || 1;
  const packPrice = pr.packPrice || 0;
  const packCount = Math.ceil(amt / packSize);
  purchaseCost += packCount * packPrice;
}); });
console.log(`Purchases: ${Math.round(purchaseCost)}₽`);

// ── Save ────────────────────────────────────────────────────────────
const plansOut = {
  plan,
  actions,
  store: { id: STORE, name: storeData?.name || STORE, color: storeData?.color || "#666", icon: storeData?.icon || "?" },
  shopping: {
    week1: { name: "Неделя 1", budget: Math.round(BUDGET * 0.23) },
    week2: { name: "Неделя 2", budget: Math.round(BUDGET * 0.23) },
    week3: { name: "Неделя 3", budget: Math.round(BUDGET * 0.23) },
    week4: { name: "Неделя 4", budget: Math.round(BUDGET * 0.23) },
    topup: { name: "Докупка", budget: Math.round(BUDGET * 0.08) },
  },
  used: {},
  version: 5,
  generatedFrom: "generate-plan.js",
  family: { adults: ADULTS, children: CHILDREN, units: FAMILY_UNITS, scale: FAMILY_SCALE, budget: BUDGET },
};

plan.forEach((d, idx) => {
  plansOut.used[String(idx + 1)] = [...new Set(
    Object.values(d.meals).flatMap(m => (m.portion || "").split(/[+,.·/]/).map(x => x.trim()).filter(Boolean))
  )];
});

// scaledDishUsage already built above (before purchase calculation for consistency)
invData.dishUsage = scaledDishUsage;
invData.purchases = purchases;
invData.packageOrders = packageOrders;
// Store family info for app.js to use
invData.familyInfo = { adults: ADULTS, children: CHILDREN, units: FAMILY_UNITS, scale: FAMILY_SCALE, budget: BUDGET };
// Sync shelf life from SHELF_LIFE to inventory-rules for audit consistency
if (!invData.shelfLifeDays) invData.shelfLifeDays = {};
Object.entries(SHELF_LIFE).forEach(([prod, days]) => {
  invData.shelfLifeDays[prod] = days;
});

writeJSON("plans.json", plansOut);
writeJSON("inventory-rules.json", invData);

console.log(`\nSaved. Run: node build-data.js && node audit.js`);
