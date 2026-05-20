const fs = require('fs');
const path = require('path');

// Support --profile aX_cY to audit a specific profile plan
const args = process.argv.slice(2);
let profileId = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--profile' && args[i + 1]) profileId = args[i + 1];
}
if (profileId) {
  console.log(`Auditing profile: ${profileId}`);
}

// Load JSON data files
const products = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/products.json'), 'utf8'));
const recipes = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/recipes.json'), 'utf8'));
const defaultRules = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/inventory-rules.json'), 'utf8'));
const defaultPlans = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/plans.json'), 'utf8'));

// Load profile-specific plan if requested
let profilePlans = null, profileRules = null;
if (profileId) {
  const planFile = path.join(__dirname, 'data/plans', `plan_${profileId}.json`);
  const invFile = path.join(__dirname, 'data/plans', `inv_${profileId}.json`);
  if (fs.existsSync(planFile)) profilePlans = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  else { console.error(`Profile plan not found: ${planFile}`); process.exit(1); }
  if (fs.existsSync(invFile)) profileRules = JSON.parse(fs.readFileSync(invFile, 'utf8'));
  else { console.error(`Profile inv not found: ${invFile}`); process.exit(1); }
}

const plans = profilePlans || defaultPlans;
const inventoryRules = profileRules || defaultRules;
// Merge profile rules with defaults (profile rules may be missing some fields)
if (profileRules) {
  if (!inventoryRules.containerRules) inventoryRules.containerRules = defaultRules.containerRules;
  if (!inventoryRules.activeMinutes) inventoryRules.activeMinutes = defaultRules.activeMinutes;
  if (!inventoryRules.macroByItem) inventoryRules.macroByItem = defaultRules.macroByItem;
  if (!inventoryRules.lowStockLimits) inventoryRules.lowStockLimits = defaultRules.lowStockLimits;
  if (!inventoryRules.budget) inventoryRules.budget = defaultRules.budget;
  if (!inventoryRules.familyInfo?.budget && plans.family?.budget) {
    inventoryRules.familyInfo = inventoryRules.familyInfo || {};
    inventoryRules.familyInfo.budget = plans.family.budget;
  }
}

// Extract current plan data
const DATA = { plan: plans.plan, shopping: plans.shopping };
const RECIPES = recipes.recipes;
const ACTIONS = plans.actions;
const USED = {}; // computed below

// Inventory constants from inventory-rules.json
const INVENTORY_ITEMS = {};
Object.entries(products.products).forEach(([id, p]) => {
  INVENTORY_ITEMS[id] = [p.name, p.unit, p.storage];
});

const INVENTORY_PURCHASES = inventoryRules.purchases;
const PACKAGE_ORDERS = inventoryRules.packageOrders;
const DISH_USAGE = inventoryRules.dishUsage;
const CONTAINER_SLOTS = inventoryRules.containerSlots;
const CONTAINER_RULES = inventoryRules.containerRules;
const SHELF_LIFE_DAYS = inventoryRules.shelfLifeDays;
const LOW_STOCK_LIMITS = inventoryRules.lowStockLimits;
const ACTIVE_MIN = inventoryRules.activeMinutes;
const MACRO_BY_ITEM = inventoryRules.macroByItem;

const MEAL_ORDER = ["Завтрак","Обед","Полдник","Ужин","Чай"];

function addStock(stock, usage, sign=1) {
  Object.entries(usage || {}).forEach(([k,v]) => {
    stock[k] = (stock[k] || 0) + v * sign;
  });
}

function usageWeight(usage) {
  return Math.round(Object.entries(usage || {}).reduce((s, [k,v]) => {
    return s + (/_pcs$/.test(k) ? v * 80 : k === "beans_cans" ? v * 240 : v);
  }, 0));
}

function formatInvItem(k, v) {
  const meta = INVENTORY_ITEMS[k] || [k, "", "base"];
  const val = Number.isInteger(v) ? v : Math.round(v);
  return `${meta[0]} ${val} ${meta[1]}`.trim();
}

function packageTotals(key) {
  const totals = {};
  (PACKAGE_ORDERS[key] || []).forEach(([, item, qty, count]) => {
    totals[item] = (totals[item] || 0) + qty * count;
  });
  return totals;
}

function packageAudit() {
  const errors = [];
  INVENTORY_PURCHASES.forEach(p => {
    const totals = packageTotals(p.key);
    Object.entries(p.items).forEach(([k, v]) => {
      if ((totals[k] || 0) < v) {
        errors.push(`${p.key}: упаковок ${INVENTORY_ITEMS[k]?.[0] || k} ${totals[k] || 0}, нужно ${v}`);
      }
    });
  });
  return errors;
}

function freshnessAudit() {
  const errors = [], warnings = [], lots = [];
  const consume = (item, amount, day, dish) => {
    let rest = amount;
    lots.filter(l => l.item === item && l.qty > 0)
      .sort((a, b) => a.expires - b.expires)
      .forEach(l => {
        if (rest <= 0) return;
        if (l.expires < day) errors.push(`День ${day}: ${INVENTORY_ITEMS[item]?.[0] || item} просрочен до блюда ${dish}`);
        const take = Math.min(l.qty, rest);
        l.qty -= take;
        rest -= take;
      });
    if (rest > 0) errors.push(`День ${day}: свежего ${INVENTORY_ITEMS[item]?.[0] || item} не хватает ${Math.round(rest)}`);
  };

  for (let dayNum = 1; dayNum <= DATA.plan.length; dayNum++) {
    INVENTORY_PURCHASES.filter(p => p.availableDay === dayNum).forEach(p => {
      Object.entries(p.items).forEach(([k, v]) => {
        if (SHELF_LIFE_DAYS[k]) lots.push({ item: k, qty: v, bought: dayNum, expires: dayNum + SHELF_LIFE_DAYS[k] - 1 });
      });
    });
    lots.filter(l => l.qty > 0 && l.expires < dayNum).forEach(l => {
      warnings.push(`День ${dayNum}: списать просроченный остаток ${formatInvItem(l.item, l.qty)} с дня ${l.expires}`);
      l.qty = 0;
    });
    MEAL_ORDER.forEach(name => {
      const meal = DATA.plan[dayNum - 1].meals[name];
      if (!meal) return;
      Object.entries(DISH_USAGE[meal.dish] || {}).forEach(([k, v]) => {
        if (SHELF_LIFE_DAYS[k]) consume(k, v, dayNum, meal.dish);
      });
    });
    lots.filter(l => l.qty > 0 && l.expires === dayNum).forEach(l => {
      warnings.push(`День ${dayNum}: сегодня последний день для ${formatInvItem(l.item, l.qty)}`);
    });
  }
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}

function macroForUsage(usage) {
  const out = { p: 0, f: 0, c: 0 };
  Object.entries(usage || {}).forEach(([k, v]) => {
    const m = MACRO_BY_ITEM[k];
    if (!m) return;
    out.p += m.p * v;
    out.f += m.f * v;
    out.c += m.c * v;
  });
  return out;
}

function dayNutrition(dayNum) {
  const meals = DATA.plan[dayNum - 1].meals;
  const macro = { p: 0, f: 0, c: 0, kcal: 0 };
  Object.values(meals).forEach(meal => {
    const m = macroForUsage(DISH_USAGE[meal.dish] || {});
    macro.p += m.p;
    macro.f += m.f;
    macro.c += m.c;
    macro.kcal += Number(meal.kcal || 0);
  });
  return { p: Math.round(macro.p), f: Math.round(macro.f), c: Math.round(macro.c), kcal: Math.round(macro.kcal) };
}

function scaleUsage(usage, portions) {
  const out = {};
  Object.entries(usage || {}).forEach(([k, v]) => out[k] = v * portions);
  return out;
}

function addDays(day, delta) { return day + delta; }
function mealTargetKey(dayNum, mealName) { return `${dayNum}:${mealName}`; }
function containerLocation(diff) { return diff <= 3 ? "fridge" : "freezer"; }
function containerExpiry(dayNum, location) { return location === "fridge" ? addDays(dayNum, 3) : addDays(dayNum, 45); }

function findFutureContainerTargets(dish, dayNum, mealName, coveredTargets) {
  const rule = CONTAINER_RULES[dish];
  if (!rule || (mealName !== "Обед" && mealName !== "Ужин")) return [];
  const targets = [];
  for (let d = dayNum + 1; d <= DATA.plan.length && targets.length < (rule.maxExtra || 1); d++) {
    const diff = d - dayNum;
    if (diff > (rule.maxDays || 7)) break;
    for (const futureMealName of ["Обед", "Ужин"]) {
      const meal = DATA.plan[d - 1].meals[futureMealName];
      const key = mealTargetKey(d, futureMealName);
      if (meal && meal.dish === dish && !coveredTargets.has(key)) {
        targets.push({ day: d, mealName: futureMealName, key });
        coveredTargets.add(key);
        break;
      }
    }
  }
  return targets;
}

function inventoryAudit() {
  const stock = {}, errors = [], days = [], containers = [];
  const coveredTargets = new Set();
  let containerSeq = 1;

  for (let dayNum = 1; dayNum <= DATA.plan.length; dayNum++) {
    const purchases = INVENTORY_PURCHASES.filter(p => p.availableDay === dayNum);
    purchases.forEach(p => addStock(stock, p.items, 1));
    const start = { ...stock };
    const containersStart = containers.map(c => ({ ...c }));
    const uses = [], cooks = [], createdContainers = [], consumedContainers = [];

    MEAL_ORDER.forEach(mealName => {
      const meal = DATA.plan[dayNum - 1].meals[mealName];
      if (!meal) return;
      const usage = DISH_USAGE[meal.dish];
      if (!usage) { errors.push(`День ${dayNum}: нет расхода для блюда ${meal.dish}`); return; }

      const readyIdx = containers.findIndex(c => c.targetDay === dayNum && c.targetMeal === mealName && c.dish === meal.dish);
      if (readyIdx >= 0) {
        const [container] = containers.splice(readyIdx, 1);
        consumedContainers.push(container);
        uses.push({ mealName, dish: meal.dish, usage: container.usage, weight: container.weight, source: "container", container });
        if (mealName === "Обед" || mealName === "Ужин") {
          cooks.push({ time: mealName === "Обед" ? "12:10" : "18:20", dish: meal.dish, source: "container", portions: 1, weight: container.weight, leftover: 0, created: [], container });
        }
        return;
      }

      const futureTargets = findFutureContainerTargets(meal.dish, dayNum, mealName, coveredTargets);
      const portions = 1 + futureTargets.length;
      const totalUsage = scaleUsage(usage, portions);
      addStock(stock, totalUsage, -1);
      Object.entries(totalUsage).forEach(([k]) => {
        if ((stock[k] || 0) < 0) errors.push(`День ${dayNum}: не хватает ${INVENTORY_ITEMS[k]?.[0] || k} после ${meal.dish} (${Math.round(stock[k])})`);
      });
      uses.push({ mealName, dish: meal.dish, usage, weight: usageWeight(usage), source: "fresh" });
      if (mealName === "Обед" || mealName === "Ужин") {
        const created = futureTargets.map(target => {
          const diff = target.day - dayNum;
          const location = containerLocation(diff);
          const container = { id: containerSeq++, dish: meal.dish, createdDay: dayNum, targetDay: target.day, targetMeal: target.mealName, location, expires: containerExpiry(dayNum, location), usage: { ...usage }, weight: usageWeight(usage) };
          containers.push(container);
          createdContainers.push(container);
          return container;
        });
        cooks.push({ time: mealName === "Обед" ? "12:10" : "18:20", dish: meal.dish, source: "fresh", portions, weight: usageWeight(totalUsage), leftover: created.reduce((s, c) => s + c.weight, 0), created });
      }
    });

    containers.forEach(c => {
      if (c.expires < dayNum) errors.push(`День ${dayNum}: просрочен контейнер ${c.dish} из дня ${c.createdDay}`);
    });
    const slotUse = { fridge: containers.filter(c => c.location === "fridge").length, freezer: containers.filter(c => c.location === "freezer").length };
    Object.entries(slotUse).forEach(([loc, count]) => {
      if (count > CONTAINER_SLOTS[loc]) errors.push(`День ${dayNum}: переполнены слоты ${loc} ${count}/${CONTAINER_SLOTS[loc]}`);
    });
    days.push({ day: dayNum, purchases, uses, cooks, createdContainers, consumedContainers, containersStart, containersEnd: containers.map(c => ({ ...c })), slotUse, start: { ...start }, end: { ...stock } });
  }

  const missingRecipes = DATA.plan.flatMap(d => Object.values(d.meals)).filter(m => !RECIPES[m.dish]).map(m => m.dish);
  missingRecipes.forEach(x => errors.push(`Нет рецепта: ${x}`));

  return { errors: [...new Set(errors)], days, final: { ...stock }, finalContainers: containers.map(c => ({ ...c })) };
}

function planQualityAudit(audit) {
  const warnings = [];
  // Scale thresholds by family size
  const familyScale = inventoryRules.familyInfo?.scale || 1;
  const minProtein = Math.round(70 * familyScale);
  const minKcal = Math.round(1900 * familyScale);
  const maxKcal = Math.round(2700 * familyScale);
  audit.days.forEach(d => {
    const active = (ACTIVE_MIN[DATA.plan[d.day - 1].meals["Завтрак"].dish] || 0) +
      d.cooks.reduce((s, c) => s + (c.source === "container" ? 5 : (ACTIVE_MIN[c.dish] || 10) + (c.portions > 1 ? 3 : 0)), 0);
    d.activeMinutes = active;
    if (active > 45) warnings.push(`День ${d.day}: активная готовка ${active} мин, цель до 45 мин`);
    const n = dayNutrition(d.day); d.nutrition = n;
    if (n.p < minProtein) warnings.push(`День ${d.day}: белка около ${n.p} г, цель минимум ${minProtein} г`);
    if (n.kcal < minKcal || n.kcal > maxKcal) warnings.push(`День ${d.day}: калории ${n.kcal}, диапазон ${minKcal}-${maxKcal}`);
  });
  for (let start = 1; start <= 24; start++) {
    const dishes = [];
    for (let d = start; d < start + 7; d++) dishes.push(...Object.values(DATA.plan[d - 1].meals).map(m => m.dish));
    const frozen = dishes.filter(x => /Пельмени|Вареники|Наггетсы|Котлет|Рыбные палочки/.test(x)).length;
    const fish = dishes.filter(x => /рыба|рыб|минтай|палочки|кревет|лосос|сардин|кальмар|горбуш|тунец/i.test(x)).length;
    if (frozen > 8) warnings.push(`Дни ${start}-${start + 6}: много заморозки (${frozen} приемов), можно заменить 1-2 на курицу/фасоль`);
    if (fish < 1) warnings.push(`Дни ${start}-${start + 6}: совсем нет рыбы`);
  }
  return [...new Set(warnings)];
}

// RUN AUDITS
console.log("=== FOODFLOW DATA AUDIT ===\n");

// 1. Package audit
const pkgErrors = packageAudit();
console.log(`1. PACKAGE AUDIT: ${pkgErrors.length ? 'FAIL' : 'PASS'} (${pkgErrors.length} errors)`);
if (pkgErrors.length) pkgErrors.forEach(e => console.log("   - " + e));

// 2. Freshness audit
const fresh = freshnessAudit();
console.log(`\n2. FRESHNESS AUDIT: ${fresh.errors.length ? 'FAIL' : 'PASS'}`);
console.log(`   Errors: ${fresh.errors.length}`);
if (fresh.errors.length) fresh.errors.forEach(e => console.log("   - " + e));
console.log(`   Warnings: ${fresh.warnings.length}`);
if (fresh.warnings.length) fresh.warnings.slice(0, 10).forEach(e => console.log("   - " + e));
if (fresh.warnings.length > 10) console.log(`   ... and ${fresh.warnings.length - 10} more`);

// 3. Inventory audit
const inv = inventoryAudit();
console.log(`\n3. INVENTORY AUDIT: ${inv.errors.length ? 'FAIL' : 'PASS'}`);
console.log(`   Errors: ${inv.errors.length}`);
if (inv.errors.length) inv.errors.forEach(e => console.log("   - " + e));

// 4. Recipe coverage
const allDishes = new Set(DATA.plan.flatMap(d => Object.values(d.meals).map(m => m.dish)));
const missingRecipes = [...allDishes].filter(d => !RECIPES[d]);
console.log(`\n4. RECIPE COVERAGE: ${missingRecipes.length ? 'FAIL' : 'PASS'}`);
console.log(`   Total dishes: ${allDishes.size}`);
console.log(`   Missing recipes: ${missingRecipes.length}`);
if (missingRecipes.length) missingRecipes.forEach(d => console.log("   - " + d));

// 5. Dish usage coverage
const missingUsage = [...allDishes].filter(d => !DISH_USAGE[d]);
console.log(`\n5. DISH USAGE COVERAGE: ${missingUsage.length ? 'FAIL' : 'PASS'}`);
console.log(`   Missing usage data: ${missingUsage.length}`);
if (missingUsage.length) missingUsage.forEach(d => console.log("   - " + d));

// 6. Plan quality
const quality = planQualityAudit(inv);
console.log(`\n6. PLAN QUALITY: ${quality.length ? 'WARNINGS' : 'PASS'}`);
console.log(`   Warnings: ${quality.length}`);
if (quality.length) quality.slice(0, 15).forEach(e => console.log("   - " + e));
if (quality.length > 15) console.log(`   ... and ${quality.length - 15} more`);

// 7. Budget check
const planned = DATA.plan.reduce((s, d) => s + Number(d.cost || 0), 0);
const budgetLimit = inventoryRules.familyInfo?.budget || inventoryRules.budget?.limit || 20000;
// Calculate purchase cost from package orders
let purchaseCost = 0;
const storeProds = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/store-prices.json'), 'utf8'))?.pyaterochka?.products || {};
Object.keys(PACKAGE_ORDERS).forEach(key => {
  (PACKAGE_ORDERS[key] || []).forEach(([, productId, qty, count]) => {
    const packPrice = storeProds[productId]?.packPrice || INVENTORY_ITEMS[productId]?.packPrice || 0;
    purchaseCost += packPrice * count;
  });
});
console.log(`\n7. BUDGET CHECK:`);
console.log(`   Dish cost total: ${planned} ₽`);
console.log(`   Purchase cost: ${purchaseCost} ₽`);
console.log(`   Target limit: ${budgetLimit} ₽`);
console.log(`   Reserve (budget - purchase): ${budgetLimit - purchaseCost} ₽`);

// 8. Final stock
console.log(`\n8. FINAL STOCK (after day 30):`);
const finalGroups = { base: [], fridge: [], freezer: [] };
Object.entries(inv.final).filter(([k, v]) => v > 0).forEach(([k, v]) => {
  const storage = INVENTORY_ITEMS[k]?.[2] || 'unknown';
  finalGroups[storage] = finalGroups[storage] || [];
  finalGroups[storage].push(formatInvItem(k, v));
});
Object.entries(finalGroups).forEach(([group, items]) => {
  console.log(`   ${group}: ${items.length ? items.join(', ') : 'пусто'}`);
});

// 9. Container slots max usage
const maxSlots = { fridge: 0, freezer: 0 };
inv.days.forEach(d => {
  maxSlots.fridge = Math.max(maxSlots.fridge, d.slotUse.fridge);
  maxSlots.freezer = Math.max(maxSlots.freezer, d.slotUse.freezer);
});
console.log(`\n9. CONTAINER SLOTS:`);
console.log(`   Fridge max: ${maxSlots.fridge}/${CONTAINER_SLOTS.fridge}`);
console.log(`   Freezer max: ${maxSlots.freezer}/${CONTAINER_SLOTS.freezer}`);

// 10. Nutrition summary
const avgNutrition = inv.days.reduce((s, d) => {
  const n = d.nutrition;
  return { kcal: s.kcal + n.kcal, p: s.p + n.p, f: s.f + n.f, c: s.c + n.c };
}, { kcal: 0, p: 0, f: 0, c: 0 });
const count = inv.days.length;
const familyScale = inventoryRules.familyInfo?.scale || 1;
console.log(`\n10. NUTRITION AVG (family):`);
console.log(`   Kcal: ${Math.round(avgNutrition.kcal/count)}`);
console.log(`   Protein: ${Math.round(avgNutrition.p/count)} g`);
console.log(`   Fat: ${Math.round(avgNutrition.f/count)} g`);
console.log(`   Carbs: ${Math.round(avgNutrition.c/count)} g`);
if (familyScale > 1) {
  console.log(`   --- Per person (÷${familyScale}):`);
  console.log(`   Kcal: ${Math.round(avgNutrition.kcal/count/familyScale)}`);
  console.log(`   Protein: ${Math.round(avgNutrition.p/count/familyScale)} g`);
}

// 11. Shopping coverage
const shoppingDays = DATA.plan.filter(d => d.shopping_type_actual).map(d => d.actual_day);
console.log(`\n11. SHOPPING DAYS: ${shoppingDays.join(', ')}`);

console.log("\n=== AUDIT COMPLETE ===");
