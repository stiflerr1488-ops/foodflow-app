const fs = require('fs');
const path = require('path');

function readJSON(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'data', name), 'utf8'));
}

// Simulate data-loader.js logic
const products = readJSON('products.json');
const recipes = readJSON('recipes.json');
const rules = readJSON('inventory-rules.json');
const plans = readJSON('plans.json');
const budget = readJSON('budget-tiers.json');
const profiles = readJSON('family-profiles.json');

const INVENTORY_ITEMS = {};
Object.entries(products.products).forEach(([id, p]) => {
  INVENTORY_ITEMS[id] = [p.name, p.unit, p.storage];
});

const BUDGET_META = {
  limit: rules.budget?.limit || 15000,
  targetPerDay: rules.budget?.targetPerDay || 500,
  note: rules.budget?.note || ""
};

const runtime = {
  DATA: {
    plan: plans.plan || [],
    shopping: plans.shopping || {}
  },
  RECIPES: recipes.recipes,
  ACTIONS: plans.actions || {},
  USED: plans.used || {},
  INVENTORY_ITEMS,
  INVENTORY_PURCHASES: rules.purchases || [],
  PACKAGE_ORDERS: rules.packageOrders || {},
  DISH_USAGE: rules.dishUsage || {},
  CONTAINER_SLOTS: rules.containerSlots || { fridge: 6, freezer: 12 },
  CONTAINER_RULES: rules.containerRules || {},
  SHELF_LIFE_DAYS: rules.shelfLifeDays || {},
  LOW_STOCK_LIMITS: rules.lowStockLimits || {},
  ACTIVE_MIN: rules.activeMinutes || {},
  MACRO_BY_ITEM: rules.macroByItem || {},
  BUDGET_META,
  BUDGET_TIERS: budget,
  FAMILY_PROFILES: profiles,
  PRODUCTS: products.products,
  MEAL_ORDER: ["Завтрак","Обед","Полдник","Ужин","Чай"]
};

console.log('Runtime data built successfully');
console.log('Days in plan:', runtime.DATA.plan.length);
console.log('Recipes:', Object.keys(runtime.RECIPES).length);
console.log('Actions days:', Object.keys(runtime.ACTIONS).length);
console.log('Purchases:', runtime.INVENTORY_PURCHASES.length);
console.log('Dish usages:', Object.keys(runtime.DISH_USAGE).length);

// Check critical fields
let errors = 0;

// Every plan day has meals
runtime.DATA.plan.forEach((day, i) => {
  if (!day.meals || Object.keys(day.meals).length === 0) {
    console.error(`Day ${i+1}: missing meals`);
    errors++;
  }
});

// Every dish in plan has recipe and usage
const dishesInPlan = new Set();
runtime.DATA.plan.forEach(day => {
  Object.values(day.meals).forEach(meal => dishesInPlan.add(meal.dish));
});

dishesInPlan.forEach(dish => {
  if (!runtime.RECIPES[dish]) {
    console.error(`Missing recipe: ${dish}`);
    errors++;
  }
  if (!runtime.DISH_USAGE[dish]) {
    console.error(`Missing dish usage: ${dish}`);
    errors++;
  }
});

// Check actions match plan days
for (let i = 1; i <= 30; i++) {
  if (!runtime.ACTIONS[String(i)] || runtime.ACTIONS[String(i)].length === 0) {
    console.error(`Day ${i}: missing actions`);
    errors++;
  }
}

// Simulate inventory audit (from audit.js logic)
function addStock(stock, usage, sign = 1) {
  Object.entries(usage || {}).forEach(([k, v]) => {
    stock[k] = (stock[k] || 0) + v * sign;
  });
}

function scaleUsage(usage, portions) {
  const out = {};
  Object.entries(usage || {}).forEach(([k, v]) => out[k] = v * portions);
  return out;
}

function containerLocation(diff) { return diff <= 3 ? "fridge" : "freezer"; }
function containerExpiry(dayNum, location) { return location === "fridge" ? dayNum + 3 : dayNum + 45; }
function mealTargetKey(dayNum, mealName) { return `${dayNum}:${mealName}`; }

function findFutureContainerTargets(dish, dayNum, mealName, coveredTargets) {
  const rule = runtime.CONTAINER_RULES[dish];
  if (!rule || (mealName !== "Обед" && mealName !== "Ужин")) return [];
  const targets = [];
  for (let d = dayNum + 1; d <= runtime.DATA.plan.length && targets.length < (rule.maxExtra || 1); d++) {
    const diff = d - dayNum;
    if (diff > (rule.maxDays || 7)) break;
    for (const futureMealName of ["Обед", "Ужин"]) {
      const meal = runtime.DATA.plan[d - 1].meals[futureMealName];
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

  for (let dayNum = 1; dayNum <= runtime.DATA.plan.length; dayNum++) {
    const purchases = runtime.INVENTORY_PURCHASES.filter(p => p.availableDay === dayNum);
    purchases.forEach(p => addStock(stock, p.items, 1));
    const start = { ...stock };
    const containersStart = containers.map(c => ({ ...c }));
    const uses = [], cooks = [], createdContainers = [], consumedContainers = [];

    runtime.MEAL_ORDER.forEach(mealName => {
      const meal = runtime.DATA.plan[dayNum - 1].meals[mealName];
      if (!meal) return;
      const usage = runtime.DISH_USAGE[meal.dish];
      if (!usage) { errors.push(`Day ${dayNum}: no usage for ${meal.dish}`); return; }

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
        if ((stock[k] || 0) < 0) errors.push(`Day ${dayNum}: ${k} negative after ${meal.dish}`);
      });
      uses.push({ mealName, dish: meal.dish, usage, weight: Object.entries(usage).reduce((s, [k, v]) => s + v, 0), source: "fresh" });
      if (mealName === "Обед" || mealName === "Ужин") {
        const created = futureTargets.map(target => {
          const diff = target.day - dayNum;
          const location = containerLocation(diff);
          const container = { id: containerSeq++, dish: meal.dish, createdDay: dayNum, targetDay: target.day, targetMeal: target.mealName, location, expires: containerExpiry(dayNum, location), usage: { ...usage }, weight: Object.entries(usage).reduce((s, [k, v]) => s + v, 0) };
          containers.push(container); createdContainers.push(container);
          return container;
        });
        cooks.push({ time: mealName === "Обед" ? "12:10" : "18:20", dish: meal.dish, source: "fresh", portions, weight: Object.entries(totalUsage).reduce((s, [k, v]) => s + v, 0), leftover: created.reduce((s, c) => s + c.weight, 0), created });
      }
    });

    containers.forEach(c => { if (c.expires < dayNum) errors.push(`Day ${dayNum}: expired container ${c.dish}`); });
    const slotUse = { fridge: containers.filter(c => c.location === "fridge").length, freezer: containers.filter(c => c.location === "freezer").length };
    Object.entries(slotUse).forEach(([loc, count]) => { if (count > runtime.CONTAINER_SLOTS[loc]) errors.push(`Day ${dayNum}: ${loc} overflow ${count}/${runtime.CONTAINER_SLOTS[loc]}`); });
    days.push({ day: dayNum, purchases, uses, cooks, createdContainers, consumedContainers, containersStart, containersEnd: containers.map(c => ({ ...c })), slotUse, start: { ...start }, end: { ...stock } });
  }

  return { errors: [...new Set(errors)], days };
}

const audit = inventoryAudit();
console.log('\nInventory audit errors:', audit.errors.length);
audit.errors.forEach(e => console.error('  -', e));

if (errors === 0 && audit.errors.length === 0) {
  console.log('\n✅ ALL CHECKS PASSED');
} else {
  console.log(`\n❌ FAILED: ${errors + audit.errors.length} issues`);
  process.exit(1);
}
