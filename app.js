/* FoodFlow — План питания на 30 дней */

// ── Runtime data (loaded from JSON by data-loader.js) ──
let DATA, RECIPES, ACTIONS, USED, INVENTORY_ITEMS, INVENTORY_PURCHASES, PACKAGE_ORDERS,
    DISH_USAGE, CONTAINER_SLOTS, CONTAINER_RULES, SHELF_LIFE_DAYS, LOW_STOCK_LIMITS,
    ACTIVE_MIN, MACRO_BY_ITEM, BUDGET_META, BUDGET_TIERS, FAMILY_PROFILES, PRODUCTS, PRICES, MEAL_ORDER,
    STORE_PRICES, STORE_SECTIONS;

function logRuntimeError(type, error) {
  try {
    const entry = {
      type,
      message: error?.message || String(error),
      stack: error?.stack || null,
      at: new Date().toISOString()
    };
    const key = "foodflow_runtime_errors";
    const current = JSON.parse(localStorage.getItem(key) || "[]");
    current.push(entry);
    localStorage.setItem(key, JSON.stringify(current.slice(-20)));
    const status = document.getElementById("pwaStatus");
    if (status) status.textContent = "Ошибка сохранена";
  } catch (_) {}
}
window.addEventListener("error", event => logRuntimeError("error", event.error || event.message));
window.addEventListener("unhandledrejection", event => logRuntimeError("unhandledrejection", event.reason));

function initRuntimeData() {
  const R = window.FoodFlowRuntimeData || window.FoodFlowDataStore?.runtime;
  if (!R) { console.error("FoodFlow: runtime data not available"); return false; }
  DATA = R.DATA;
  RECIPES = R.RECIPES;
  ACTIONS = R.ACTIONS;
  USED = R.USED;
  INVENTORY_ITEMS = R.INVENTORY_ITEMS;
  INVENTORY_PURCHASES = R.INVENTORY_PURCHASES;
  PACKAGE_ORDERS = R.PACKAGE_ORDERS;
  DISH_USAGE = R.DISH_USAGE;
  CONTAINER_SLOTS = R.CONTAINER_SLOTS;
  CONTAINER_RULES = R.CONTAINER_RULES;
  SHELF_LIFE_DAYS = R.SHELF_LIFE_DAYS;
  LOW_STOCK_LIMITS = R.LOW_STOCK_LIMITS;
  ACTIVE_MIN = R.ACTIVE_MIN;
  MACRO_BY_ITEM = R.MACRO_BY_ITEM;
  BUDGET_META = R.BUDGET_META;
  BUDGET_TIERS = R.BUDGET_TIERS;
  FAMILY_PROFILES = R.FAMILY_PROFILES;
  PRODUCTS = R.PRODUCTS;
  PRICES = R.PRICES || {};
  MEAL_ORDER = R.MEAL_ORDER;
  STORE_PRICES = R.STORE_PRICES || {};
  STORE_SECTIONS = R.STORE_SECTIONS || [];
  if (!DATA?.plan?.length || !RECIPES || !Object.keys(RECIPES).length || !ACTIONS || !DISH_USAGE || !Object.keys(DISH_USAGE).length) {
    console.error("FoodFlow: runtime data is incomplete");
    return false;
  }
  return true;
}

// ── Dish cost ──
function estimateDishCost(dish) {
  const usage = DISH_USAGE[dish] || RECIPES[dish]?.usage || {};
  if (!usage) return 0;
  let cost = 0;
  for (const [itemKey, amount] of Object.entries(usage)) {
    const price = PRICES[itemKey] || 0;
    cost += price * amount;
  }
  return Math.round(cost * 1.08);
}

// ── Family scale ──
let _baseDU, _basePurch, _basePkg, _baseCS, _baseBM, _baseLS, _baseSaved = false;
function saveBaseData() {
  if (_baseSaved) return;
  _baseDU = JSON.parse(JSON.stringify(DISH_USAGE));
  _basePurch = JSON.parse(JSON.stringify(INVENTORY_PURCHASES));
  _basePkg = JSON.parse(JSON.stringify(PACKAGE_ORDERS));
  _baseCS = { ...CONTAINER_SLOTS };
  _baseBM = { ...BUDGET_META };
  _baseLS = { ...LOW_STOCK_LIMITS };
  _baseSaved = true;
}
function applyFamilyScale() {
  saveBaseData();
  const units = getUnits();
  // If the loaded plan was pre-generated for this exact profile, data is already scaled — skip
  const planFam = DATA?.planFamily;
  if (planFam && planFam.adults === state.familyAdults && planFam.children === state.familyChildren) {
    return; // Already scaled by generator
  }
  // Same bulk discount as generate-plan.js
  const scale = units >= 3 ? Number((units * 0.84).toFixed(2))
              : units >= 2 ? Number((units * 0.88).toFixed(2))
              : units > 1   ? Number((units * 0.92).toFixed(2))
              : 1;
  if (scale === 1) {
    Object.keys(_baseDU).forEach(d => { DISH_USAGE[d] = { ..._baseDU[d] }; });
    _basePurch.forEach((p, i) => { INVENTORY_PURCHASES[i] = { ...p, items: { ...p.items } }; });
    Object.keys(_basePkg).forEach(k => { PACKAGE_ORDERS[k] = JSON.parse(JSON.stringify(_basePkg[k])); });
    Object.assign(CONTAINER_SLOTS, _baseCS);
    Object.assign(BUDGET_META, _baseBM);
    Object.assign(LOW_STOCK_LIMITS, _baseLS);
    return;
  }
  Object.keys(_baseDU).forEach(d => {
    DISH_USAGE[d] = {};
    Object.entries(_baseDU[d]).forEach(([k, v]) => { DISH_USAGE[d][k] = Math.round(v * scale * 10) / 10; });
  });
  _basePurch.forEach((p, i) => {
    INVENTORY_PURCHASES[i] = { ...p, items: Object.fromEntries(Object.entries(p.items).map(([k, v]) => [k, Math.round(v * scale)])) };
  });
  Object.keys(_basePkg).forEach(key => {
    PACKAGE_ORDERS[key] = _basePkg[key].map(([name, item, qty, count]) => [name, item, Math.round(qty * scale), Math.max(1, Math.ceil(count * scale))]);
  });
  CONTAINER_SLOTS.fridge = Math.max(6, Math.ceil(6 * scale));
  CONTAINER_SLOTS.freezer = Math.max(12, Math.ceil(12 * scale));
  BUDGET_META.targetPerDay = Math.round(_baseBM.targetPerDay * scale);
  Object.entries(_baseLS).forEach(([k, v]) => { LOW_STOCK_LIMITS[k] = Math.round(v * scale); });
}

// ── Store prices ──
let _basePkgForStore = null;
let _baseBasketsForStore = null;
function applyStorePrices() {
  const storeId = state.store || "pyaterochka";
  const storeData = STORE_PRICES[storeId];
  if (!storeData || !storeData.products) return;
  // Save base package orders if not yet saved (reset on profile change)
  if (!_basePkgForStore) _basePkgForStore = JSON.parse(JSON.stringify(PACKAGE_ORDERS));
  if (!_baseBasketsForStore) _baseBasketsForStore = JSON.parse(JSON.stringify(DATA.shopping || {}));
  // Reset from base first
  Object.keys(_basePkgForStore).forEach(key => { PACKAGE_ORDERS[key] = JSON.parse(JSON.stringify(_basePkgForStore[key])); });
  Object.keys(_baseBasketsForStore).forEach(key => { if (DATA.shopping?.[key]) DATA.shopping[key] = JSON.parse(JSON.stringify(_baseBasketsForStore[key])); });
  // Apply store prices to package orders
  Object.keys(PACKAGE_ORDERS).forEach(key => {
    PACKAGE_ORDERS[key] = PACKAGE_ORDERS[key].map(([name, productId, qty, count]) => {
      const storeProduct = storeData.products[productId];
      if (storeProduct) {
        const packPrice = storeProduct.packPrice || PRODUCTS[productId]?.packPrice || 0;
        return [name, productId, qty, count, packPrice];
      }
      return [name, productId, qty, count];
    });
  });
  // Update shopping basket itemBoxes prices and recompute totals
  Object.entries(DATA.shopping || {}).forEach(([_, basket]) => {
    if (!basket.itemBoxes) return;
    basket.itemBoxes.forEach(it => {
      const storeProduct = storeData.products[it.productId];
      if (storeProduct && storeProduct.packPrice != null) {
        const qty = it.quantity || 1;
        it.packagePrice = storeProduct.packPrice;
        it.totalPrice = Math.round(storeProduct.packPrice * qty);
        it.priceLabel = `~${it.totalPrice} ₽`;
        if (storeProduct.packLabel) it.packageSizeLabel = storeProduct.packLabel;
      }
    });
    const total = Math.round(basket.itemBoxes.reduce((s, it) => s + (Number(it.totalPrice) || 0), 0));
    basket.totalCost = total;
    basket.totalCostLabel = `~${total} ₽`;
    if (basket.box) {
      basket.box.totalCost = total;
      basket.box.totalCostLabel = `~${total} ₽`;
    }
  });
}

// ── Inventory helpers ──
function addStock(stock, usage, sign = 1) { Object.entries(usage || {}).forEach(([k, v]) => { stock[k] = (stock[k] || 0) + v * sign; }); }
function usageWeight(usage) {
  return Math.round(Object.entries(usage || {}).reduce((s, [k, v]) => s + (/_pcs$/.test(k) ? v * 80 : k === "beans_cans" ? v * 240 : v), 0));
}
function formatInvItem(k, v) {
  const meta = INVENTORY_ITEMS[k] || [k, "", "base"];
  const val = Number.isInteger(v) ? v : Math.round(v);
  return `${meta[0]} ${val} ${meta[1]}`.trim();
}
function usageText(usage) { return Object.entries(usage || {}).map(([k, v]) => formatInvItem(k, v)).join(" · "); }
function compactStock(stock, group) {
  return Object.entries(stock).filter(([k, v]) => v > 0 && (!group || (INVENTORY_ITEMS[k] && INVENTORY_ITEMS[k][2] === group)))
    .sort((a, b) => (INVENTORY_ITEMS[a[0]]?.[0] || a[0]).localeCompare(INVENTORY_ITEMS[b[0]]?.[0] || b[0], "ru"))
    .map(([k, v]) => formatInvItem(k, v));
}
function packageTotals(key) {
  const totals = {};
  (PACKAGE_ORDERS[key] || []).forEach(([, item, qty, count]) => { totals[item] = (totals[item] || 0) + qty * count; });
  return totals;
}
function packageAudit() {
  const errors = [];
  INVENTORY_PURCHASES.forEach(p => {
    const totals = packageTotals(p.key);
    Object.entries(p.items).forEach(([k, v]) => { if ((totals[k] || 0) < v) errors.push(`${p.key}: упаковок ${INVENTORY_ITEMS[k]?.[0] || k} ${totals[k] || 0}, нужно ${v}`); });
  });
  return errors;
}
function packageRows(key) { return (PACKAGE_ORDERS[key] || []).map(([name, item, qty, count]) => `${name} x${count} = ${formatInvItem(item, qty * count)}`); }

// ── Freshness audit ──
function freshnessAudit() {
  const errors = [], warnings = [], lots = [];
  const consume = (item, amount, day, dish) => {
    let rest = amount;
    lots.filter(l => l.item === item && l.qty > 0).sort((a, b) => a.expires - b.expires).forEach(l => {
      if (rest <= 0) return;
      if (l.expires < day) errors.push(`День ${day}: ${INVENTORY_ITEMS[item]?.[0] || item} просрочен до блюда ${dish}`);
      const take = Math.min(l.qty, rest); l.qty -= take; rest -= take;
    });
    if (rest > 0) errors.push(`День ${day}: свежего ${INVENTORY_ITEMS[item]?.[0] || item} не хватает ${Math.round(rest)}`);
  };
  for (let dayNum = 1; dayNum <= DATA.plan.length; dayNum++) {
    INVENTORY_PURCHASES.filter(p => p.availableDay === dayNum).forEach(p =>
      Object.entries(p.items).forEach(([k, v]) => { if (SHELF_LIFE_DAYS[k]) lots.push({ item: k, qty: v, bought: dayNum, expires: dayNum + SHELF_LIFE_DAYS[k] - 1 }); })
    );
    lots.filter(l => l.qty > 0 && l.expires < dayNum).forEach(l => { warnings.push(`День ${dayNum}: списать просроченный остаток ${formatInvItem(l.item, l.qty)} с дня ${l.expires}`); l.qty = 0; });
    MEAL_ORDER.forEach(name => {
      const meal = DATA.plan[dayNum - 1].meals[name];
      if (!meal) return;
      Object.entries(DISH_USAGE[meal.dish] || {}).forEach(([k, v]) => { if (SHELF_LIFE_DAYS[k]) consume(k, v, dayNum, meal.dish); });
    });
    lots.filter(l => l.qty > 0 && l.expires === dayNum).forEach(l => warnings.push(`День ${dayNum}: сегодня последний день для ${formatInvItem(l.item, l.qty)}`));
  }
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}

// ── Macros & nutrition ──
function macroForUsage(usage) {
  const out = { p: 0, f: 0, c: 0 };
  Object.entries(usage || {}).forEach(([k, v]) => { const m = MACRO_BY_ITEM[k]; if (!m) return; out.p += m.p * v; out.f += m.f * v; out.c += m.c * v; });
  return out;
}
function dayNutrition(dayNum) {
  const dayData = DATA.plan[dayNum - 1];
  if (!dayData) return { p: 0, f: 0, c: 0, kcal: 0 };
  const meals = dayData.meals;
  const macro = { p: 0, f: 0, c: 0, kcal: 0 };
  Object.values(meals).forEach(meal => {
    const m = macroForUsage(DISH_USAGE[meal.dish] || {});
    macro.p += m.p; macro.f += m.f; macro.c += m.c; macro.kcal += Number(meal.kcal || 0);
  });
  return { p: Math.round(macro.p), f: Math.round(macro.f), c: Math.round(macro.c), kcal: Math.round(macro.kcal) };
}
function planQualityAudit(audit) {
  const warnings = [];
  audit.days.forEach(d => {
    const active = (ACTIVE_MIN[(DATA.plan[d.day - 1].meals["Завтрак"] || {}).dish] || 0) +
      d.cooks.reduce((s, c) => s + (c.source === "container" ? 5 : (ACTIVE_MIN[c.dish] || 10) + (c.portions > 1 ? 3 : 0)), 0);
    d.activeMinutes = active;
    if (active > 45) warnings.push(`День ${d.day}: активная готовка ${active} мин, цель до 45 мин`);
    const n = dayNutrition(d.day); d.nutrition = n;
    if (n.p < 70) warnings.push(`День ${d.day}: белка около ${n.p} г, цель минимум 70 г`);
    if (n.kcal < 1900 || n.kcal > 2700) warnings.push(`День ${d.day}: калории ${n.kcal}, проверь комфортный диапазон`);
  });
  for (let start = 1; start + 6 <= DATA.plan.length; start++) {
    const dishes = [];
    for (let d = start; d < start + 7; d++) dishes.push(...Object.values(DATA.plan[d - 1].meals).map(m => m.dish));
    const frozen = dishes.filter(x => /Пельмени|Вареники|Наггетсы|Котлет|Рыбные палочки/.test(x)).length;
    const fish = dishes.filter(x => /Рыба|Минтай|палочки/.test(x)).length;
    if (frozen > 8) warnings.push(`Дни ${start}-${start + 6}: много заморозки (${frozen} приемов), можно заменить 1-2 на курицу/фасоль`);
    if (fish < 1) warnings.push(`Дни ${start}-${start + 6}: совсем нет рыбы`);
  }
  return [...new Set(warnings)];
}
function neededUntilNextDelivery(audit, dayNum) {
  const next = (INVENTORY_PURCHASES.map(p => p.availableDay).filter(d => d > dayNum).sort((a, b) => a - b)[0]) || 31;
  const need = {};
  for (let d = dayNum + 1; d < next; d++) audit.days[d - 1].uses.filter(u => u.source === "fresh").forEach(u => addStock(need, u.usage, 1));
  return need;
}
function stockWarningsForDay(audit, dayNum) {
  const day = audit.days[dayNum - 1], need = neededUntilNextDelivery(audit, dayNum), warnings = [];
  Object.entries(need).forEach(([k, v]) => { if ((day.end[k] || 0) < v) warnings.push(`До следующего дозаказа не хватает ${INVENTORY_ITEMS[k]?.[0] || k}: есть ${Math.round(day.end[k] || 0)}, нужно ${Math.round(v)}`); });
  Object.entries(LOW_STOCK_LIMITS).forEach(([k, limit]) => { if ((day.end[k] || 0) > 0 && (day.end[k] || 0) <= limit) warnings.push(`Низкий остаток: ${formatInvItem(k, day.end[k])}`); });
  return warnings;
}

// ── Container & inventory audit ──
function scaleUsage(usage, portions) { const out = {}; Object.entries(usage || {}).forEach(([k, v]) => out[k] = v * portions); return out; }
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
        if (mealName === "Обед" || mealName === "Ужин") cooks.push({ time: mealName === "Обед" ? "12:10" : "18:20", dish: meal.dish, source: "container", portions: 1, weight: container.weight, leftover: 0, created: [], container });
        return;
      }
      const futureTargets = findFutureContainerTargets(meal.dish, dayNum, mealName, coveredTargets);
      const portions = 1 + futureTargets.length;
      const totalUsage = scaleUsage(usage, portions);
      addStock(stock, totalUsage, -1);
      Object.entries(totalUsage).forEach(([k]) => { if ((stock[k] || 0) < 0) errors.push(`День ${dayNum}: не хватает ${INVENTORY_ITEMS[k]?.[0] || k} после ${meal.dish} (${Math.round(stock[k])})`); });
      uses.push({ mealName, dish: meal.dish, usage, weight: usageWeight(usage), source: "fresh" });
      if (mealName === "Обед" || mealName === "Ужин") {
        const created = futureTargets.map(target => {
          const diff = target.day - dayNum;
          const location = containerLocation(diff);
          const container = { id: containerSeq++, dish: meal.dish, createdDay: dayNum, targetDay: target.day, targetMeal: target.mealName, location, expires: containerExpiry(dayNum, location), usage: { ...usage }, weight: usageWeight(usage) };
          containers.push(container); createdContainers.push(container);
          return container;
        });
        cooks.push({ time: mealName === "Обед" ? "12:10" : "18:20", dish: meal.dish, source: "fresh", portions, weight: usageWeight(totalUsage), leftover: created.reduce((s, c) => s + c.weight, 0), created });
      }
    });
    containers.forEach(c => { if (c.expires < dayNum) errors.push(`День ${dayNum}: просрочен контейнер ${c.dish} из дня ${c.createdDay}`); });
    const slotUse = { fridge: containers.filter(c => c.location === "fridge").length, freezer: containers.filter(c => c.location === "freezer").length };
    Object.entries(slotUse).forEach(([loc, count]) => { if (count > CONTAINER_SLOTS[loc]) errors.push(`День ${dayNum}: переполнены слоты ${loc} ${count}/${CONTAINER_SLOTS[loc]}`); });
    days.push({ day: dayNum, purchases, uses, cooks, createdContainers, consumedContainers, containersStart, containersEnd: containers.map(c => ({ ...c })), slotUse, start: { ...start }, end: { ...stock } });
  }
  const missingRecipes = DATA.plan.flatMap(d => Object.values(d.meals)).filter(m => !RECIPES[m.dish]).map(m => m.dish);
  missingRecipes.forEach(x => errors.push(`Нет рецепта: ${x}`));
  return { errors: [...new Set(errors)], days, final: { ...stock }, finalContainers: containers.map(c => ({ ...c })) };
}
function containerCookFor(dayNum, dish, time) { return inventoryAudit().days[dayNum - 1]?.cooks.find(c => c.dish === dish && c.time === time); }

// ── Budget & family ──
function money(n) { return `${Number(n || 0).toLocaleString("ru-RU")} ₽`; }
function budgetConfig() {
  return BUDGET_TIERS || {
    fixedBudgets: [15000, 20000, 25000, 30000, 35000, 40000, 45000, 50000, 60000],
    unitRules: { adult: 1, child: .7 },
    statusByRubPerUnit: [
      { status: "not_recommended", label: "Не рекомендую", min: 0, max: 10999 },
      { status: "emergency", label: "Аварийно", min: 11000, max: 13999 },
      { status: "strict", label: "Жестко", min: 14000, max: 16999 },
      { status: "normal", label: "Нормально", min: 17000, max: 21999 },
      { status: "comfortable", label: "Комфортно", min: 22000, max: 999999 }
    ],
    statusRules: {
      not_recommended: { buildPlan: false, description: "Бюджет слишком низкий для состава семьи." },
      emergency: { buildPlan: true, description: "Аварийный рацион: крупы, супы, яйца, фасоль, картофель, капуста." },
      strict: { buildPlan: true, description: "Жесткий рацион: курица регулярно, рыба и творог дозированно." },
      normal: { buildPlan: true, description: "Нормальный эконом: стабильный белок, фрукты, молочка, рыба." },
      comfortable: { buildPlan: true, description: "Комфортный рацион: больше качества, быстрых блюд и разнообразия." }
    }
  };
}
function familyProfiles() { return (FAMILY_PROFILES?.profiles) || [{ adults: 1, children: 0, units: 1, label: "1 взрослый" }]; }
function currentFamilyProfile() {
  const cfg = budgetConfig();
  const units = Number((state.familyAdults * (cfg.unitRules?.adult || 1) + state.familyChildren * (cfg.unitRules?.child || .7)).toFixed(2));
  const label = familyProfiles().find(p => p.adults === state.familyAdults && p.children === state.familyChildren)?.label || `${state.familyAdults} взр. + ${state.familyChildren} дет.`;
  return { adults: state.familyAdults, children: state.familyChildren, units, label };
}
function getUnits() { return currentFamilyProfile().units; }
function familyScaleFactor(units) {
  const bulk = units >= 3 ? .84 : units >= 2 ? .88 : units > 1 ? .92 : 1;
  return Number((units * bulk).toFixed(2));
}
function scalePortionText(ingredients) {
  if (!ingredients) return "";
  const units = getUnits ? getUnits() : 1;
  const scale = familyScaleFactor(units);
  if (scale === 1) return ingredients.join(", ") || "";
  return ingredients.map(s => s.replace(/(\d+(?:[.,]\d+)?)/g, m => {
    const n = parseFloat(m.replace(",", "."));
    const scaled = Math.round(n * scale * 10) / 10;
    return scaled % 1 === 0 ? String(scaled) : scaled.toFixed(1).replace(".", ",");
  })).join(", ");
}
function budgetStatus(profile, budget) {
  const cfg = budgetConfig();
  const perUnit = Math.round(budget / profile.units);
  const status = cfg.statusByRubPerUnit.find(x => perUnit >= x.min && perUnit <= x.max) || cfg.statusByRubPerUnit[cfg.statusByRubPerUnit.length - 1];
  const rule = cfg.statusRules?.[status.status] || {};
  return { ...status, perUnit, description: rule.description || "", buildPlan: rule.buildPlan !== false };
}
function scaledPlanEstimate() {
  const profile = currentFamilyProfile();
  const planFam = DATA?.planFamily;
  const isPreScaled = planFam && planFam.adults === profile.adults && planFam.children === profile.children;
  const scale = isPreScaled ? 1 : familyScaleFactor(profile.units);
  const baseCost = DATA.plan.reduce((s, d) => s + Number(d.cost || 0), 0);
  const estimatedCost = Math.round(baseCost * scale);
  const dayN = dayNutrition(state.day);
  return {
    profile, scale, baseCost, estimatedCost,
    budget: state.familyBudget, delta: state.familyBudget - estimatedCost,
    status: budgetStatus(profile, state.familyBudget),
    todayNutrition: { kcal: Math.round(dayN.kcal * scale), p: Math.round(dayN.p * scale), f: Math.round(dayN.f * scale), c: Math.round(dayN.c * scale) }
  };
}

// ── Rendering: Inventory ──
function renderInventory(_audit, _invToday) {
  let el = document.getElementById("inventoryRefs");
  if (!el) { el = document.createElement("section"); el.id = "inventoryRefs"; el.className = "section"; (document.getElementById("familyRefs") || document.getElementById("budgetRefs") || document.getElementById("today")).after(el); }
  const audit = _audit || inventoryAudit(), today = _invToday || audit.days[state.day - 1];
  const packageErrors = packageAudit(), freshness = freshnessAudit(), qualityWarnings = planQualityAudit(audit), stockWarnings = stockWarningsForDay(audit, state.day);
  const hardErrors = [...audit.errors, ...packageErrors, ...freshness.errors];
  const warningList = [...freshness.warnings.filter(x => x.startsWith(`День ${state.day}:`)), ...stockWarnings, ...qualityWarnings.filter(x => x.startsWith(`День ${state.day}:`) || x.startsWith(`Дни ${Math.max(1, state.day - 6)}`))];
  const status = hardErrors.length ? `${hardErrors.length} проблем` : `OK · ${warningList.length} предупрежд.`;
  const groupHtml = (title, group, stock) => {
    const rows = compactStock(stock, group).slice(0, 14);
    return `<div class="budgetTile"><span>${title}</span><strong>${rows.length ? rows.join("<br>") : "пусто"}</strong></div>`;
  };
  const purchaseHtml = today.purchases.length ? today.purchases.map(p => `<div class="row storageRow"><div>Доступно сегодня</div><div>${esc(p.title)}</div><div>${usageText(p.items)}</div></div>`).join("") : `<p class="small">Сегодня новых продуктов не приезжает, едим из текущих остатков.</p>`;
  const packagesHtml = today.purchases.length ? today.purchases.map(p => `<details><summary>Упаковки: ${esc(p.title)}</summary>${packageRows(p.key).map(x => `<div class="row storageRow"><div>Пачка</div><div>${esc(x.split(" = ")[0])}</div><div>${esc(x.split(" = ")[1] || "")}</div></div>`).join("")}</details>`).join("") : `<p class="small">Сегодня закупочных упаковок нет.</p>`;
  const usesHtml = today.uses.map(u => `<div class="row storageRow"><div>${esc(u.mealName)}</div><div>${esc(u.dish)}</div><div>${u.source === "container" ? `из контейнера #${u.container.id}, сырье не списываем` : `сырье: ${usageText(u.usage)}`}</div></div>`).join("");
  const cooksHtml = today.cooks.length ? today.cooks.map(c => `<div class="row storageRow"><div>${esc(c.time)}</div><div>${esc(c.source === "container" ? `Разогреть: ${c.dish}` : c.dish)}</div><div>${c.source === "container" ? `контейнер #${c.container.id}, ${c.weight} г, слот освобождается` : `готовим ${c.portions} порц. / примерно ${c.weight} г; в контейнеры: ${c.leftover} г${c.created.length ? ` (${c.created.map(x => `#${x.id} на день ${x.targetDay}`).join(", ")})` : ""}`}</div></div>`).join("") : `<p class="small">Отдельной готовки сегодня нет.</p>`;
  const containersHtml = today.containersEnd.length ? today.containersEnd.map(c => `<div class="row storageRow"><div>${esc(c.location === "fridge" ? "Холодильник" : "Морозилка")}</div><div>#${c.id} · ${esc(c.dish)}</div><div>${c.weight} г · на день ${c.targetDay} (${esc(c.targetMeal)}) · годен до дня ${c.expires}</div></div>`).join("") : `<p class="small">После дня готовых контейнеров нет.</p>`;
  const nutrition = today.nutrition || dayNutrition(state.day);
  const qualityHtml = `<div class="budgetGrid"><div class="budgetTile"><span>Ккал</span><strong>${nutrition.kcal}</strong></div><div class="budgetTile"><span>Белок</span><strong>${nutrition.p} г</strong></div><div class="budgetTile"><span>Б/Ж/У</span><strong>${nutrition.p}/${nutrition.f}/${nutrition.c} г</strong></div><div class="budgetTile"><span>Активная готовка</span><strong>${today.activeMinutes || 0} мин</strong></div></div>`;
  const warningsHtml = warningList.length ? `<div class="line"><strong>Предупреждения на сегодня</strong><ul>${warningList.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>` : `<div class="line"><strong>Предупреждений на сегодня нет.</strong><p class="small">Порог остатков, свежесть, белок и активная готовка в норме.</p></div>`;
  el.innerHTML = `<details class="scheduleExtras">
    <summary>Остатки, контейнеры и аудит: ${esc(status)} · слоты ${today.slotUse.fridge}/${CONTAINER_SLOTS.fridge} хол., ${today.slotUse.freezer}/${CONTAINER_SLOTS.freezer} мороз.</summary>
    <div class="extrasBody">
      ${hardErrors.length ? `<div class="line"><strong>Проблемы</strong><ul>${hardErrors.map(e => `<li>${esc(e)}</li>`).join("")}</ul></div>` : `<div class="line"><strong>Аудит чистый.</strong><p class="small">Проверены упаковки, сроки годности, FIFO по свежим продуктам, контейнеры, слоты, КБЖУ, активная готовка и остатки до дозаказа.</p></div>`}
      ${warningsHtml}
      ${qualityHtml}
      <div class="budgetGrid">
        ${groupHtml("База после дня", "base", today.end)}
        ${groupHtml("Холодильник после дня", "fridge", today.end)}
        ${groupHtml("Морозилка после дня", "freezer", today.end)}
        ${groupHtml("Финальный остаток месяца", "", audit.final)}
      </div>
      <details open><summary>Что пришло сегодня</summary>${purchaseHtml}</details>
      <details><summary>Упаковки магазина</summary>${packagesHtml}</details>
      <details open><summary>Что списываем сегодня</summary>${usesHtml}</details>
      <details><summary>Готовка, разогрев и новые контейнеры</summary>${cooksHtml}</details>
      <details><summary>Контейнеры после дня</summary>${containersHtml}</details>
    </div>
  </details>`;
}

// ── Rendering: Family budget ──
function renderFamilyBudget() {
  let el = document.getElementById("familyRefs");
  if (!el) { el = document.createElement("section"); el.id = "familyRefs"; el.className = "section"; const anchor = document.getElementById("budgetRefs") || document.getElementById("today"); anchor.after(el); }
  const cfg = budgetConfig(), estimate = scaledPlanEstimate(), status = estimate.status, profile = estimate.profile;
  const adultsOptions = [1, 2].map(v => `<option value="${v}" ${state.familyAdults === v ? "selected" : ""}>${v}</option>`).join("");
  const childrenOptions = [0, 1, 2].map(v => `<option value="${v}" ${state.familyChildren === v ? "selected" : ""}>${v}</option>`).join("");
  const budgetOptions = (cfg.fixedBudgets || []).map(v => {
    const perUnit = Math.round(v / profile.units);
    const s = cfg.statusByRubPerUnit.find(x => perUnit >= x.min && perUnit <= x.max);
    const mark = s && (s.status === "comfortable" || s.status === "normal") ? " ✓" : s && s.status === "not_recommended" ? " ✗" : "";
    return `<option value="${v}" ${state.familyBudget === v ? "selected" : ""}>${money(v)} (${money(perUnit)}/чел)${mark}</option>`;
  }).join("");
  const statusClass = status.status === "comfortable" || status.status === "normal" ? "good" : "";
  const recommendation = status.buildPlan ? status.description : "План лучше не строить: выбери бюджет выше для этого состава семьи.";
  el.innerHTML = `<details class="scheduleExtras">
    <summary>Семья и бюджет: ${esc(estimate.profile.label)} · ${money(estimate.budget)} · ${esc(status.label)}</summary>
    <div class="extrasBody">
      <div class="dayControls">
        <label class="small">Взрослые <select id="familyAdults">${adultsOptions}</select></label>
        <label class="small">Дети <select id="familyChildren">${childrenOptions}</select></label>
        <label class="small">Бюджет <select id="familyBudget">${budgetOptions}</select></label>
      </div>
      <div class="line">
        <p><strong>${estimate.delta >= 0 ? "Запас" : "Не хватает"}:</strong> ${money(Math.abs(estimate.delta))} · <strong>Оценка рациона:</strong> ${money(estimate.estimatedCost)} · <strong>На чел:</strong> ${money(status.perUnit)}/мес</p>
        <p class="small">${esc(recommendation)}</p>
      </div>
      <div class="line">
        <p><strong>Сегодня:</strong> ${estimate.todayNutrition.kcal} ккал · ${estimate.todayNutrition.p} г белка · Б/Ж/У ${estimate.todayNutrition.p}/${estimate.todayNutrition.f}/${estimate.todayNutrition.c} г${estimate.profile.units > 1 ? ` · <strong>На 1 чел:</strong> ${Math.round(estimate.todayNutrition.kcal / estimate.profile.units)} ккал · ${Math.round(estimate.todayNutrition.p / estimate.profile.units)} г белка` : ""}</p>
      </div>
    </div>
  </details>`;
  document.getElementById("familyAdults").onchange = e => {
    state.familyAdults = Number(e.target.value);
    localStorage.setItem("family_adults", state.familyAdults);
    // Auto-select recommended budget
    const pid = `a${state.familyAdults}_c${state.familyChildren}`;
    const rec = cfg.recommendedBudgets?.[pid];
    if (rec?.normal) { state.familyBudget = rec.normal; localStorage.setItem("family_budget", rec.normal); }
    // Reload plan for new profile
    window.FoodFlowDataStore.refresh().then(() => { _baseSaved = false; _basePkgForStore = null; _baseBasketsForStore = null; initRuntimeData(); applyFamilyScale(); applyStorePrices(); applyPlanReplacements(); renderAll(); });
  };
  document.getElementById("familyChildren").onchange = e => {
    state.familyChildren = Number(e.target.value);
    localStorage.setItem("family_children", state.familyChildren);
    // Auto-select recommended budget
    const pid = `a${state.familyAdults}_c${state.familyChildren}`;
    const rec = cfg.recommendedBudgets?.[pid];
    if (rec?.normal) { state.familyBudget = rec.normal; localStorage.setItem("family_budget", rec.normal); }
    // Reload plan for new profile
    window.FoodFlowDataStore.refresh().then(() => { _baseSaved = false; _basePkgForStore = null; _baseBasketsForStore = null; initRuntimeData(); applyFamilyScale(); applyStorePrices(); applyPlanReplacements(); renderAll(); });
  };
  document.getElementById("familyBudget").onchange = e => { state.familyBudget = Number(e.target.value); localStorage.setItem("family_budget", state.familyBudget); renderAll(); };
}

// ── Rendering: Onboarding wizard ──
function renderOnboarding() {
  let adults = state.familyAdults || 1, children = state.familyChildren || 0, budget = state.familyBudget || 20000;
  let store = state.store || "pyaterochka";
  let step = 1;
  const cfg = budgetConfig();
  function profileId() { return `a${adults}_c${children}`; }
  function calcStatus() {
    const units = Number((adults * (cfg.unitRules?.adult || 1) + children * (cfg.unitRules?.child || .7)).toFixed(2));
    const profile = { adults, children, units, label: familyProfiles().find(p => p.adults === adults && p.children === children)?.label || `${adults} взр.${children ? ` + ${children} дет.` : ""}` };
    return { ...profile, ...budgetStatus(profile, budget) };
  }
  function getRecommendedBudget() { return cfg.recommendedBudgets?.[profileId()] || {}; }
  function setGroup(id, val) { document.querySelectorAll(`#${id} button`).forEach(b => b.classList.toggle("active", Number(b.dataset.v) === val)); }
  function autoSelectBudget() {
    const rec = getRecommendedBudget();
    if (rec.normal && cfg.fixedBudgets.includes(rec.normal)) { budget = rec.normal; setGroup("ob_budget", budget); }
  }
  const storeKeys = Object.keys(STORE_PRICES || {});
  function renderStep() {
    const steps = [1, 2, 3];
    const dots = steps.map(s => `<div class="obDot ${s === step ? "obDotActive" : s < step ? "obDotDone" : ""}"></div>`).join("");
    if (step === 1) {
      document.getElementById("ob_body").innerHTML = `
        <div class="onboardingTitle">Кто будет есть?</div>
        <div class="onboardingSub">Выбери состав семьи — я подстрою порции и закупки.</div>
        <div class="onboardingGroup"><span>Взрослые</span><div class="onboardingOpts" id="ob_adults">${[1, 2].map(v => `<button data-v="${v}">${v}</button>`).join("")}</div></div>
        <div class="onboardingGroup"><span>Дети</span><div class="onboardingOpts" id="ob_children">${[0, 1, 2].map(v => `<button data-v="${v}">${v}</button>`).join("")}</div></div>
        <button class="onboardingStart" id="ob_next">Далее</button>`;
      setGroup("ob_adults", adults); setGroup("ob_children", children);
      document.querySelectorAll("#ob_adults button").forEach(b => { b.onclick = () => { adults = Number(b.dataset.v); setGroup("ob_adults", adults); autoSelectBudget(); }; });
      document.querySelectorAll("#ob_children button").forEach(b => { b.onclick = () => { children = Number(b.dataset.v); setGroup("ob_children", children); autoSelectBudget(); }; });
      document.getElementById("ob_next").onclick = () => { step = 2; renderStep(); };
    } else if (step === 2) {
      const rec = getRecommendedBudget();
      const s = calcStatus();
      document.getElementById("ob_body").innerHTML = `
        <div class="onboardingTitle">Какой бюджет?</div>
        <div class="onboardingSub">${esc(s.label)} — рекомендую ${rec.normal ? money(rec.normal) : "20 000 ₽"} на месяц.</div>
        <div class="onboardingGroup"><span>Бюджет на месяц</span><div class="onboardingOpts" id="ob_budget">${cfg.fixedBudgets.map(v => {
          const perUnit = Math.round(v / s.units);
          const bst = cfg.statusByRubPerUnit.find(x => perUnit >= x.min && perUnit <= x.max);
          const mark = bst && (bst.status === "comfortable" || bst.status === "normal") ? " ✓" : bst && bst.status === "not_recommended" ? " ✗" : "";
          return `<button data-v="${v}" class="${v === rec.normal ? "recommended" : ""}">${money(v)}<span class="obBudgetHint">${money(perUnit)}/чел${mark}</span></button>`;
        }).join("")}</div></div>
        <div class="onboardingStatus"><div class="sLabel" id="ob_statusLabel">${esc(s.label)}</div><div class="sDesc" id="ob_statusDesc">${esc(s.description)}</div></div>
        <div style="display:flex;gap:10px"><button class="obBack" id="ob_back">Назад</button><button class="onboardingStart" id="ob_next2" style="flex:1">Далее</button></div>`;
      setGroup("ob_budget", budget);
      document.querySelectorAll("#ob_budget button").forEach(b => { b.onclick = () => { budget = Number(b.dataset.v); setGroup("ob_budget", budget); const ns = calcStatus(); document.getElementById("ob_statusLabel").textContent = ns.label; document.getElementById("ob_statusDesc").textContent = ns.description; }; });
      document.getElementById("ob_back").onclick = () => { step = 1; renderStep(); };
      document.getElementById("ob_next2").onclick = () => { step = 3; renderStep(); };
    } else {
      const s = calcStatus();
      document.getElementById("ob_body").innerHTML = `
        <div class="onboardingTitle">Где закупаемся?</div>
        <div class="onboardingSub">Цены и упаковки зависят от магазина. Можно поменять позже.</div>
        <div class="onboardingGroup"><span>Магазин</span><div class="onboardingOpts obStoreOpts" id="ob_store">${storeKeys.map(k => {
          const st = STORE_PRICES[k];
          const sel = k === store ? "active" : "";
          return `<button data-v="${k}" class="${sel}" style="background:${safeColor(st.color)};color:#fff;border-color:${safeColor(st.color)}">${esc(st.icon || "")} ${esc(st.name || k)}</button>`;
        }).join("")}</div></div>
        <div class="onboardingStatus"><div class="sLabel">${esc(s.label)} · ${money(budget)}</div><div class="sDesc">Готовлю расписание, закупки и контейнеры на 30 дней.</div></div>
        <div style="display:flex;gap:10px"><button class="obBack" id="ob_back2">Назад</button><button class="onboardingStart" id="ob_start" style="flex:1">Начать</button></div>`;
      document.querySelectorAll("#ob_store button").forEach(b => { b.onclick = () => { store = b.dataset.v; document.querySelectorAll("#ob_store button").forEach(x => x.classList.remove("active")); b.classList.add("active"); }; });
      document.getElementById("ob_back2").onclick = () => { step = 2; renderStep(); };
      document.getElementById("ob_start").onclick = () => {
        state.familyAdults = adults; state.familyChildren = children; state.familyBudget = budget; state.store = store;
        localStorage.setItem("family_adults", adults); localStorage.setItem("family_children", children); localStorage.setItem("family_budget", budget); localStorage.setItem("store", store);
        localStorage.setItem("foodflow_onboarded", "1");
        savePlanReplacements({});
        const el = document.getElementById("onboarding"); if (el) el.remove();
        window.FoodFlowDataStore.refresh().then(() => {
          _baseSaved = false; _basePkgForStore = null; _baseBasketsForStore = null;
          initRuntimeData(); applyFamilyScale(); applyStorePrices(); applyPlanReplacements(); renderAll();
        });
      };
    }
    document.getElementById("ob_dots").innerHTML = dots;
  }
  const el = document.createElement("div"); el.className = "onboarding"; el.id = "onboarding";
  el.innerHTML = `<div class="onboardingCard">
    <button class="obClose" id="ob_close" aria-label="Закрыть">×</button>
    <div class="onboardingLogo">FoodFlow</div>
    <div id="ob_dots" class="obDots"></div>
    <div id="ob_body"></div>
  </div>`;
  document.body.appendChild(el);
  const dismiss = () => {
    localStorage.setItem("foodflow_onboarded_snoozed", "1");
    el.remove();
    document.removeEventListener("keydown", onKey);
    renderAll();
  };
  document.getElementById("ob_close").onclick = dismiss;
  const onKey = e => { if (e.key === "Escape") { dismiss(); } };
  document.addEventListener("keydown", onKey);
  renderStep();
}
function showOnboarding() { const existing = document.getElementById("onboarding"); if (existing) existing.remove(); renderOnboarding(); }

// ── Rendering: Budget refs ──
function purchaseCostTotal() {
  // Calculate total purchase cost from package orders and prices
  let total = 0;
  const storeId = state.store || "pyaterochka";
  const storeProds = STORE_PRICES[storeId]?.products || {};
  for (const key of Object.keys(PACKAGE_ORDERS)) {
    for (const [, productId, qty, count] of PACKAGE_ORDERS[key]) {
      const packPrice = storeProds[productId]?.packPrice || PRODUCTS[productId]?.packPrice || 0;
      total += packPrice * count;
    }
  }
  return total;
}
function renderRefs() {
  let el = document.getElementById("budgetRefs");
  if (!el) { el = document.createElement("section"); el.id = "budgetRefs"; el.className = "section"; document.getElementById("today").after(el); }
  const planned = DATA.plan.reduce((s, d) => s + Number(d.cost || 0), 0);
  const purchaseCost = purchaseCostTotal();
  const avg = Math.round(planned / DATA.plan.length);
  const reserve = BUDGET_META.limit - purchaseCost;
  const d = day() || {};
  const leftToday = Math.max(0, BUDGET_META.targetPerDay - Number(d.cost || 0));
  const shoppingDays = DATA.plan.reduce((acc, planDay) => { if (planDay.shopping_type_actual) acc[planDay.shopping_type_actual] = planDay.actual_day; return acc; }, {});
  const baskets = Object.entries(DATA.shopping).map(([key, b]) => `
    <details ${d.shopping_type_actual === key ? "open" : ""}>
      <summary class="recipeSummary"><span>${esc(b.name)}</span><span>${esc(b.totalCostLabel || b.budget || "")}</span></summary>
      <div class="modalList">
        ${shoppingItemsHtml(b, shoppingDays[key] || key)}
      </div>
    </details>
  `).join("");
  // Store info
  const storeKeys = Object.keys(STORE_PRICES);
  const currentStore = state.store || "pyaterochka";
  const storeInfo = STORE_PRICES[currentStore] || {};
  const storeOptions = storeKeys.map(k => {
    const s = STORE_PRICES[k];
    return `<option value="${k}" ${k === currentStore ? "selected" : ""}>${esc(s.name || k)}</option>`;
  }).join("");
  const storeBadge = storeInfo.name ? `<span class="storeBadge" style="background:${safeColor(storeInfo.color)};color:#fff;padding:2px 8px;border-radius:4px;font-size:12px">${esc(storeInfo.icon || '')} ${esc(storeInfo.name)}</span>` : "";

  el.innerHTML = `<details class="scheduleExtras">
    <summary>Бюджет и закупки ${storeBadge}</summary>
    <div class="extrasBody">
      <div class="line">
        <p><strong>Закупки:</strong> ${money(purchaseCost)} · <strong>Запас:</strong> ${money(reserve)} · <strong>Сегодня:</strong> ${money(d.cost)}</p>
        <p class="small">Среднее ${money(avg)}/день. Лимит ${money(BUDGET_META.targetPerDay)}/день.${leftToday ? ` Остаток: ${money(leftToday)}.` : ""}</p>
      </div>
      <div class="dayControls">
        <label class="small">Магазин <select id="storeSelect">${storeOptions}</select></label>
        <button id="exportPlanBtn">Экспорт плана</button>
        <button id="shareShoppingBtn" class="shareBtn">Отправить список</button>
        <button id="printPlanBtn">Печать</button>
      </div>
      ${baskets}
    </div>
  </details>`;
  bind();
  document.getElementById("exportPlanBtn").onclick = exportPlan;
  document.getElementById("printPlanBtn").onclick = printPlan;
  document.getElementById("shareShoppingBtn").onclick = shareShoppingList;
  const storeSelect = document.getElementById("storeSelect");
  if (storeSelect) storeSelect.onchange = e => { state.store = e.target.value; localStorage.setItem("store", state.store); applyStorePrices(); renderAll(); };
}

// ── NEW: Export / Print ──
function shareShoppingList() {
  const lines = [];
  Object.entries(DATA.shopping || {}).forEach(([key, basket]) => {
    if (basket.itemBoxes?.length) {
      lines.push(`🛒 ${basket.name} ${basket.totalCostLabel || ""}`);
      const groups = {};
      basket.itemBoxes.forEach(it => { const sec = it.storeSection || "Другое"; if (!groups[sec]) groups[sec] = []; groups[sec].push(it); });
      Object.entries(groups).forEach(([sec, items]) => { lines.push(`  ${sec}:`); items.forEach(it => { lines.push(`    ☐ ${it.title}${it.quantity > 1 ? ` x${it.quantity}` : ""} ${it.priceLabel || ""}`); }); });
      lines.push("");
    }
  });
  const text = lines.join("\n") || "Список покупок пуст";
  if (navigator.share) { navigator.share({ title: "Список покупок FoodFlow", text }).catch(() => {}); }
  else { navigator.clipboard.writeText(text).then(() => showToast("Скопировано в буфер")).catch(() => {}); }
}
function showToast(msg, action) {
  let t = document.getElementById("shareToast");
  if (!t) { t = document.createElement("div"); t.id = "shareToast"; t.className = "shareToast"; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add("show");
  t.querySelectorAll(".toastAction").forEach(b => b.remove());
  if (action) {
    const btn = document.createElement("button"); btn.className = "toastAction"; btn.textContent = action.text;
    btn.onclick = () => { action.onClick(); t.classList.remove("show"); };
    t.appendChild(btn);
  }
  const dur = action ? 60000 : 2000;
  setTimeout(() => t.classList.remove("show"), dur);
}
function getFavorites() { return JSON.parse(localStorage.getItem("foodflow_favorites") || "[]"); }
function isFavorite(dish) { return getFavorites().includes(dish); }
function toggleFavorite(dish) {
  const favs = getFavorites();
  const idx = favs.indexOf(dish);
  if (idx >= 0) favs.splice(idx, 1); else favs.push(dish);
  localStorage.setItem("foodflow_favorites", JSON.stringify(favs));
  return idx < 0;
}
function exportPlan() {
  const rows = DATA.plan.map((d, i) => {
    const meals = Object.entries(d.meals).map(([k, m]) => `${k}: ${m.dish} (${m.portion}, ${m.kcal} ккал)`).join("\n  ");
    const shop = d.shopping_type_actual ? `Закупка: ${DATA.shopping[d.shopping_type_actual]?.name || ""}` : "";
    return `День ${i + 1}: ${d.title}\n  ${meals}\n  ${shop}`;
  }).join("\n\n");
  const blob = new Blob([rows], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `foodflow-plan-30.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
}
function printPlan() { window.print(); }

// ── NEW: Weekly shopping list ──
function getWeeklyShoppingList() {
  const startDay = state.day;
  const endDay = Math.min(30, startDay + 6);
  const list = [];
  for (let d = startDay; d <= endDay; d++) {
    const planDay = DATA.plan[d - 1];
    if (planDay.shopping_type_actual && planDay.actual_day === d) {
      const basket = DATA.shopping[planDay.shopping_type_actual];
      if (basket) list.push({ day: d, key: planDay.shopping_type_actual, ...basket });
    }
  }
  return list;
}
function renderWeeklyShopping() {
  let el = document.getElementById("weeklyShoppingRefs");
  if (!el) { el = document.createElement("section"); el.id = "weeklyShoppingRefs"; el.className = "section"; document.getElementById("budgetRefs").after(el); }
  const list = getWeeklyShoppingList();
  const html = list.length ? list.map(b => `
    <details ${b.day === state.day ? "open" : ""}>
      <summary class="recipeSummary"><span>День ${b.day}: ${esc(b.name)}</span><span>${esc(b.totalCostLabel || "")}</span></summary>
      <div class="modalList">
        ${shoppingItemsHtml(b, b.day)}
      </div>
    </details>
  `).join("") : `<p class="small">В ближайшие 7 дней закупок нет.</p>`;
  el.innerHTML = `<details class="scheduleExtras">
    <summary>Список покупок на неделю</summary>
    <div class="extrasBody">${html}</div>
  </details>`;
  bind();
}

// ── Icons ──
const ICONS = {
  grid: `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect></svg>`,
  cart: `<svg viewBox="0 0 24 24"><circle cx="9" cy="20" r="1.5"></circle><circle cx="18" cy="20" r="1.5"></circle><path d="M3 4h2l2.2 10h10.8l2-7H6.2"></path></svg>`,
  cook: `<svg viewBox="0 0 24 24"><path d="M4 10h12a3 3 0 0 1 3 3v4H7a3 3 0 0 1-3-3z"></path><path d="M19 14h2"></path><path d="M8 7c0-1 1-1.5 1-2.5M12 7c0-1 1-1.5 1-2.5"></path></svg>`,
  meal: `<svg viewBox="0 0 24 24"><path d="M4 3v8a3 3 0 0 0 3 3v7"></path><path d="M4 7h6"></path><path d="M15 3v18"></path><path d="M19 3c1.7 2 2 4.3 2 6.5S20.7 14 19 16"></path></svg>`,
  book: `<svg viewBox="0 0 24 24"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 0 4 22z"></path><path d="M4 5.5v15"></path></svg>`,
  fridge: `<svg viewBox="0 0 24 24"><rect x="7" y="2.5" width="10" height="19" rx="1"></rect><path d="M7 11.5h10"></path><path d="M9.5 6.5v2M9.5 14.5v2"></path></svg>`,
  kcal: `<svg viewBox="0 0 24 24"><path d="M12 3s5 4.3 5 9a5 5 0 0 1-10 0c0-4.7 5-9 5-9z"></path><path d="M12 11c1 1 1.5 1.8 1.5 3A1.5 1.5 0 0 1 10.5 14c0-1.2.5-2 1.5-3z"></path></svg>`,
  list: `<svg viewBox="0 0 24 24"><path d="M9 6h12M9 12h12M9 18h12M3 6h.01M3 12h.01M3 18h.01"></path></svg>`
};

// ── State ──
function clampInList(value, list, fallback) {
  const n = Number(value);
  return list.includes(n) ? n : fallback;
}
const state = {
  day: clampDay(localStorage.getItem("command_day") || 1),
  hidePast: localStorage.getItem("hide_past") !== "0",
  compact: localStorage.getItem("compact_mode") === "1",
  autoNow: localStorage.getItem("auto_now") !== "0",
  focusMode: localStorage.getItem("focus_mode") !== "0",
  familyAdults: clampInList(localStorage.getItem("family_adults"), [1, 2], 1),
  familyChildren: clampInList(localStorage.getItem("family_children"), [0, 1, 2], 0),
  familyBudget: Number(localStorage.getItem("family_budget") || 15000),
  store: localStorage.getItem("store") || "pyaterochka",
  dark: localStorage.getItem("dark_theme") === "1"
};
// Validate persisted state against loaded data (runs after initRuntimeData)
function validatePersistedState() {
  const cfg = budgetConfig();
  const allowedBudgets = Array.isArray(cfg.fixedBudgets) && cfg.fixedBudgets.length ? cfg.fixedBudgets : [15000, 20000, 25000];
  if (!allowedBudgets.includes(state.familyBudget)) {
    state.familyBudget = allowedBudgets.includes(20000) ? 20000 : allowedBudgets[0];
    localStorage.setItem("family_budget", String(state.familyBudget));
  }
  const storeKeys = Object.keys(STORE_PRICES || {});
  if (storeKeys.length && !storeKeys.includes(state.store)) {
    state.store = storeKeys.includes("pyaterochka") ? "pyaterochka" : storeKeys[0];
    localStorage.setItem("store", state.store);
  }
  // Ensure persisted family values match what state already clamped
  localStorage.setItem("family_adults", String(state.familyAdults));
  localStorage.setItem("family_children", String(state.familyChildren));
}

function planLength() { return DATA?.plan?.length || 30; }
function rebuildDaySelect() {
  if (!daySelect) return;
  const total = planLength();
  daySelect.innerHTML = "";
  for (let i = 1; i <= total; i++) { const o = document.createElement("option"); o.value = i; o.textContent = String(i).padStart(2, "0"); daySelect.appendChild(o); }
  if (state.day > total) state.day = total;
  daySelect.value = state.day;
}

const daySelect = document.getElementById("daySelect");
for (let i = 1; i <= 30; i++) { const o = document.createElement("option"); o.value = i; o.textContent = String(i).padStart(2, "0"); daySelect.appendChild(o); }
daySelect.value = state.day;
const timeInput = document.getElementById("timeInput");
const nowInit = new Date();
timeInput.value = `${String(nowInit.getHours()).padStart(2, "0")}:${String(nowInit.getMinutes()).padStart(2, "0")}`;
let shouldAutoScroll = true;

// ── Helpers ──
function icon(n) { return `<span class="icon">${ICONS[n] || ""}</span>`; }
function staticIcons() { document.querySelectorAll("[data-icon]").forEach(n => n.innerHTML = ICONS[n.dataset.icon] || ""); }
function esc(s) { return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function clampDay(n) { const parsed = Number(n); const max = (typeof DATA !== "undefined" && DATA?.plan?.length) || 30; return Number.isFinite(parsed) ? Math.max(1, Math.min(max, Math.trunc(parsed))) : 1; }
function day() { return DATA.plan[state.day - 1]; }
function cals(d) { return Object.values(d?.meals || {}).reduce((s, m) => s + Number(m.kcal || 0), 0); }
function key(t, d, i) { return `command_${t}_${d}_${i}`; }
function isDone(t, d, i) { return localStorage.getItem(key(t, d, i)) === "1"; }
function setDone(t, d, i, v) { localStorage.setItem(key(t, d, i), v ? "1" : "0"); }
function check(t, d, i) { return `<input class="check" type="checkbox" data-type="${t}" data-day="${d}" data-index="${i}" ${isDone(t, d, i) ? "checked" : ""}>`; }
function isSkippedAction(i) { return localStorage.getItem(key("skip", state.day, i)) === "1"; }
function setSkippedAction(i, v) { localStorage.setItem(key("skip", state.day, i), v ? "1" : "0"); }
function isCompleteAction(i) { return isDoneAction(i) || isSkippedAction(i); }
function snoozeKey(i) { return key("snooze", state.day, i); }
function snoozeUntilAction(i) { return Number(localStorage.getItem(snoozeKey(i)) || 0); }
function setSnoozeAction(i, min) { localStorage.setItem(snoozeKey(i), String(min)); }
function clearSnoozeAction(i) { localStorage.removeItem(snoozeKey(i)); }
function findRecipe(dish) { if (RECIPES[dish]) return RECIPES[dish]; const ks = Object.keys(RECIPES).sort((a, b) => b.length - a.length); for (const k of ks) { if (dish && dish.includes(k)) return RECIPES[k]; } for (const k of ks) { if (k.includes(dish || "")) return RECIPES[k]; } return null; }
function typeIcon(t) { return t === "order" ? "cart" : t === "cook" ? "cook" : "meal"; }
function typeLabel(t) { return t === "order" ? "Заказ" : t === "cook" ? "Готовка" : "Еда"; }
function sectionTitle(t, c = "") { return `<div class="sectionTitle"><h1 id="pageTitle">${t}</h1><div class="caption">${esc(c)}</div></div>`; }
function safeColor(value) { return /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(String(value || "")) ? String(value) : "#888"; }
function qualityText(q) { return q === "good" ? "хороший" : q === "review" ? "проверить" : q === "blocked" ? "не использовать" : q || ""; }
function shoppingItemsHtml(basket, dayKey) {
  if (basket.itemBoxes && basket.itemBoxes.length) {
    // Group by storeSection
    const groups = {};
    const sectionOrder = STORE_SECTIONS.length ? STORE_SECTIONS : ["Овощи и фрукты","Молочная продукция","Мясо и птица","Рыба и морепродукты","Заморозка","Хлеб и выпечка","Бакалея"];
    basket.itemBoxes.forEach((it, i) => {
      const sec = it.storeSection || "Другое";
      if (!groups[sec]) groups[sec] = [];
      groups[sec].push({ it, i });
    });
    const orderedSections = sectionOrder.filter(s => groups[s]).concat(Object.keys(groups).filter(s => !sectionOrder.includes(s)));
    return orderedSections.map(sec => `
      <div class="shopSection"><div class="shopSectionTitle">${esc(sec)}</div>
        ${groups[sec].map(({ it, i }) => `<div class="boxRow shopBox">${check("shop", dayKey, i)}<div><strong>${esc(it.title)}</strong><span>${esc(it.packageSizeLabel || "")}${it.quantity > 1 ? ` · ${it.quantity} уп.` : ""}</span></div><div><strong>${esc(it.priceLabel || "")}</strong><span>${esc(it.storage || "")}</span></div></div>`).join("")}
      </div>`).join("");
  }
  return (basket.items || []).map((it, i) => `<div class="row basketRow">${check("shop", dayKey, i)}<div>${esc(it[0])}</div><div>${esc(it[1])}</div></div>`).join("");
}
const UNMAPPED_SKIP = /^(соль|перец|специи|масло|вода|чай|корица|сахар|лавровый|паприка|чеснок|соевый)/i;
function ingredientBoxesHtml(recipe, isContainer) {
  if (isContainer) return `<div class="boxGrid"><div class="miniBox"><div><strong>Из контейнера</strong><span>разогреть · 2 мин</span></div><div></div></div></div>`;
  if (recipe.ingredientBoxes && recipe.ingredientBoxes.length) {
    const boxes = recipe.ingredientBoxes.filter(it => it.status !== "unmapped" || !UNMAPPED_SKIP.test(it.raw || ""));
    if (!boxes.length) return `<p class="small">Базовые продукты (соль, специи, вода) — по вкусу.</p>`;
    return `<div class="boxGrid">${boxes.map(it => `<div class="miniBox"><div><strong>${esc(it.title)}</strong><span>${esc(it.amountLabel)} · ${esc(it.storage || "")}</span></div><div>${esc(it.priceLabel || "")}</div></div>`).join("")}</div>`;
  }
  return `<ul>${(recipe.ingredients || []).map(x => `<li>${esc(x)}</li>`).join("")}</ul>`;
}
function recipeStatsHtml(recipe) {
  const q = recipe.quality || recipe.box?.quality || {};
  const quality = typeof q === "string" ? q : q.level;
  const macros = recipe.macros || recipe.box?.macros || {};
  const parts = [recipe.costLabel || recipe.box?.costLabel, recipe.kcal ? `${recipe.kcal} ккал` : recipe.box?.kcal ? `${recipe.box.kcal} ккал` : "", quality ? `качество: ${qualityText(quality)}` : ""].filter(Boolean);
  const macroLine = macros.p || macros.f || macros.c ? `<div class="small">БЖУ: ${esc(macros.p || 0)} / ${esc(macros.f || 0)} / ${esc(macros.c || 0)}</div>` : "";
  return parts.length ? `<div class="recipeStats">${parts.map(x => `<span>${esc(x)}</span>`).join("")}</div>${macroLine}` : "";
}
const REHEAT_STEPS = ["Достать контейнер из холодильника/морозилки.", "Разогреть в микроволновке 2 мин или на сковороде под крышкой 5 мин.", "Проверить температуру, при необходимости добавить ещё 1 мин."];
function recipeImageHtml(r) {
  if (!r) return "";
  if (r.image) return `<img src="${esc(r.image)}" alt="" style="width:100%;border-radius:14px;margin-bottom:14px;object-fit:cover;max-height:220px">`;
  const type = r.type || "";
  const hue = type.includes("Завтрак") ? 38 : type.includes("Обед") ? 200 : type.includes("Ужин") ? 280 : type.includes("Полдник") ? 120 : type.includes("Чай") ? 45 : type.includes("Заморозка") ? 210 : 170;
  return `<div style="width:100%;height:120px;border-radius:14px;margin-bottom:14px;background:hsl(${hue},45%,88%);display:flex;align-items:center;justify-content:center;font-size:42px">${type.includes("Суп") ? "🍲" : type.includes("Салат") ? "🥗" : type.includes("Завтрак") || type.includes("Блин") ? "🥞" : type.includes("Заморозка") ? "🧊" : type.includes("Рыба") ? "🐟" : type.includes("Готовить") ? "🍳" : type.includes("Перекус") ? "🍎" : type.includes("Без готовки") ? "🥪" : "🍽️"}</div>`;
}
function recipeHtml(name, mode = "full", isContainer = false) {
  const r = findRecipe(name);
  if (!r) return `<p class="small">Рецепт не найден.</p>`;
  if (isContainer) {
    const short = REHEAT_STEPS.slice(0, 2);
    if (mode === "short") return `<ol>${short.map(x => `<li>${esc(x)}</li>`).join("")}</ol>`;
    return `${recipeStatsHtml(r)}<div class="recipeCols"><div><h3>Из контейнера</h3>${ingredientBoxesHtml(r, true)}</div><div><h3>Разогрев</h3><ol>${REHEAT_STEPS.map(x => `<li>${esc(x)}</li>`).join("")}</ol>${r.store ? `<p class="small">Хранение: ${esc(r.store)}</p>` : ""}</div></div>`;
  }
  const short = (r.steps || []).slice(0, 6);
  if (mode === "short") return `<ol>${short.map(x => `<li>${esc(x)}</li>`).join("")}</ol>`;
  return `${recipeImageHtml(r)}${recipeStatsHtml(r)}<div class="recipeCols"><div><h3>Ингредиенты</h3>${ingredientBoxesHtml(r, false)}<h3>Список</h3><ul>${(r.ingredients || []).map(x => `<li>${esc(x)}</li>`).join("")}</ul></div><div><h3>Шаги</h3><ol>${(r.steps || []).map(x => `<li>${esc(x)}</li>`).join("")}</ol>${r.notes && r.notes.length ? `<h3>Важно</h3><ul>${r.notes.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}</div></div>`;
}

// ── Time helpers ──
function minutes(t) { const [h, m] = String(t).split(":").map(Number); return h * 60 + m; }
function formatMinutes(m) { const safe = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`; }
function effectiveActionMinutes(a, i) { const base = minutes(a.time); const snooze = snoozeUntilAction(i); return snooze > base ? snooze : base; }
function setTimeToNow() { const now = new Date(); timeInput.value = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`; }
function setAutoNow(v) { state.autoNow = v; localStorage.setItem("auto_now", v ? "1" : "0"); if (v) setTimeToNow(); }
function currentMinutes() { const input = document.getElementById("timeInput"); if (input && input.value) return minutes(input.value); const now = new Date(); return now.getHours() * 60 + now.getMinutes(); }
function nearestActionIndex(acts) {
  if (!acts.length) return -1;
  const now = currentMinutes();
  for (let i = 0; i < acts.length; i++) { if (!isCompleteAction(i) && effectiveActionMinutes(acts[i], i) >= now) return i; }
  for (let i = acts.length - 1; i >= 0; i--) { if (!isCompleteAction(i)) return i; }
  return acts.length - 1;
}
function diffText(targetMin) {
  const now = currentMinutes(); let diff = targetMin - now;
  if (diff < 0) diff = 0; const h = Math.floor(diff / 60), m = diff % 60;
  if (h > 0) return `${h} ч ${m} мин`; return `${m} мин`;
}
function orderStatus(d) {
  if (d.shopping_type_actual) {
    const t = state.day === 1 ? "08:00" : "21:00";
    return state.day === 1 ? `Стартовая закупка: ${t}` : `Закупка на завтра: ${t}`;
  }
  return "Без заказа";
}

// ── Enrich action with meal data ──
function enrichAction(a) {
  if (a.title) return a; // already enriched
  const raw = a.action || "";
  const colonIdx = raw.indexOf(": ");
  const verb = colonIdx > 0 ? raw.substring(0, colonIdx) : "";
  const dish = colonIdx > 0 ? raw.substring(colonIdx + 2) : raw;
  const type = verb === "Готовить" || verb === "Готовка" ? "cook" : verb === "Собрать" ? "eat" : verb === "Заказ" ? "order" : "eat";
  // Find kcal from meals
  let kcal = a.kcal || 0;
  let mealDish = dish;
  if (!kcal) {
    const d = day() || {};
    for (const m of Object.values(d.meals || {})) {
      if (m.dish === dish) { kcal = m.kcal || 0; mealDish = m.dish; break; }
    }
  }
  return { ...a, title: dish, type, dish: mealDish, kcal, minutes: a.minutes || 0 };
}

// ── Today schedule ──
function renderToday(_audit, _invToday) {
  const d = day() || {}, rawActs = ACTIONS[String(state.day)] || [];
  const acts = rawActs.map(enrichAction);
  const nextIdx = nearestActionIndex(acts);
  const current = enrichAction(acts[nextIdx] || {});
  const nowMin = currentMinutes();
  const allDone = acts.every((_, i) => isCompleteAction(i));
  const nextMin = current ? effectiveActionMinutes(current, nextIdx) : nowMin;
  const invToday = _invToday || inventoryAudit().days[state.day - 1] || {};

  const mealDeck = `<div class="mealDeck">
    ${["Завтрак", "Обед", "Полдник", "Ужин", "Чай"].map(name => {
      const meal = d.meals[name];
      if (!meal) return "";
      const replacedNote = meal._replaced ? `<div class="meta" style="color:var(--ui-blue);margin-top:4px">Заменено</div>` : "";
      const clearBtn = meal._replaced ? `<button class="replaceBtn" data-clear-replace="${esc(name)}">Вернуть</button>` : "";
      return `<div class="mealCard" data-drop-meal="${esc(name)}">
        <div class="mealTop"><span class="mealType">${esc(name)}</span><span class="mealKcal">${Number(meal.kcal || 0)} ккал · ${estimateDishCost(meal.dish)} ₽</span></div>
        <div class="mealName">${esc(meal.dish)}</div>
        <div class="mealPortion">${esc(meal.portion)}</div>${replacedNote}
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:auto">
          <button data-dish="${esc(meal.dish)}">Рецепт</button>
          <button class="replaceBtn" data-replace-meal="${esc(name)}">Заменить</button>
          ${clearBtn}
        </div>
      </div>`;
    }).join("")}
  </div>`;

  const rows = acts.map((a, i) => {
    const effectiveMin = effectiveActionMinutes(a, i);
    const snoozed = snoozeUntilAction(i) > minutes(a.time) && !isCompleteAction(i);
    const cookInfo = a.type === "cook" ? invToday.cooks.find(c => c.dish === a.dish && c.time === a.time) : null;
    const displayTitle = cookInfo?.source === "container" ? a.dish : a.title;
    const kcalText = a.kcal ? ` · ${a.kcal} ккал` : "";
    const statusText = snoozed ? ` (отложено)` : isSkippedAction(i) ? ` (пропущено)` : "";
    const btn = a.type === "order" ? `<button data-basket="${esc(a.basket)}" data-basket-day="${state.day}">Заказ</button>` : a.type === "cook" ? `<button data-cook="${i}">Рецепт</button>` : `<button data-dish="${esc(a.dish)}">Рецепт</button>`;
    const isPast = effectiveMin < nowMin && i !== nextIdx;
    const isDone = isDoneAction(i);
    const isSkipped = isSkippedAction(i);
    const cls = ["action", isPast ? "pastAction" : "", isDone ? "doneAction" : "", isSkipped ? "skippedAction" : "", snoozed ? "snoozedAction" : "", i === nextIdx ? "nextAction" : "", (state.hidePast && (isDone || isSkipped)) ? "hiddenByFilter" : ""].join(" ");
    return `<div class="${cls}" data-action-index="${i}">
      <div class="actionTime">${esc(formatMinutes(effectiveMin))}</div>
      <div class="actionBody">
        <div class="actionTitle">${esc(displayTitle)}${kcalText}${statusText}</div>
      </div>
      <div class="actionBtns">${check("action", state.day, i)}${btn}</div>
    </div>`;
  }).join("");

  const nowBtn = current.type === "order" ? `<button data-basket="${esc(current.basket)}" data-basket-day="${state.day}">Открыть заказ</button>` : current.type === "cook" ? `<button data-cook="${nextIdx}">Открыть</button>` : `<button data-dish="${esc(current.dish)}">Открыть</button>`;
  const currentCook = current.type === "cook" ? invToday.cooks.find(c => c.dish === current.dish && c.time === current.time) : null;
  const currentTitle = currentCook?.source === "container" ? current.dish : current.title;
  const currentMeta = current.kcal ? `${current.kcal} ккал` : typeLabel(current.type);
  const waitLine = allDone ? "Все пункты закрыты" : nextMin > nowMin ? `Через ${diffText(nextMin)}` : snoozeUntilAction(nextIdx) > minutes(current.time) ? "Отложено, пора" : "Сейчас";
  const inlineRecipe = !allDone && current.dish && findRecipe(current.dish) ? `<details class="inlineRecipe"><summary>Короткий рецепт</summary>${recipeHtml(current.dish, "short")}</details>` : "";
  const extraNowActions = `<details class="nowMore"><summary>Ещё</summary><div class="nowMoreActions"><button class="dangerAction" id="skipCurrent">Пропустить</button>${state.autoNow ? "" : `<button class="quietAction" id="useNow">Сейчас</button>`}</div></details>`;
  const nowCard = allDone ? `<div class="nowCard">
    <div class="nowLabel">День ${state.day}</div>
    <div class="nowTime">Готово</div>
    <div class="nowTitle">Все пункты расписания закрыты</div>
    <div class="nowMeta">Можно переходить на следующий день или открыть бюджет/закупки ниже.</div>
    <div class="nowActions"><button class="primaryAction" id="goTomorrow"${state.day >= planLength() ? " disabled" : ""}>${state.day >= planLength() ? "План завершён" : "Перейти на завтра"}</button></div>
  </div>` : `<div class="nowCard">
    <div class="nowLabel">${waitLine}</div>
    <div class="nowTime">${esc(formatMinutes(nextMin))}</div>
    <div class="nowTitle">${esc(currentTitle)}</div>
    <div class="nowMeta">${currentMeta}</div>
    <div class="nowActions">
      <button class="primaryAction" id="markCurrentSimple">Готово</button>
      ${nowBtn}
    </div>
    ${extraNowActions}
    ${inlineRecipe}
  </div>`;

  const controls = `<div class="dayControls">
    <button class="toggleBtn ${state.focusMode ? "active" : ""}" id="toggleFocus">Только ближайшее</button>
    <button class="toggleBtn ${state.hidePast ? "active" : ""}" id="togglePast">Скрыть закрытое</button>
  </div>`;
  const scheduleList = `<div class="${state.compact ? "compact" : ""}"><div class="grid"><div class="actions" id="scheduleList">${rows}</div></div></div>`;
  const scheduleBlock = state.focusMode ? `<details class="scheduleExtras focusSchedule"><summary>Полное расписание</summary><div class="extrasBody">${scheduleList}</div></details>` : scheduleList;

  const dayKcal = cals(d);
  const kcalExtra = currentFamilyProfile().units > 1 ? ` <span class="small" style="font-size:13px">(~${Math.round(dayKcal / currentFamilyProfile().units)} на чел)</span>` : "";
  const statusBar = `<div class="statusBar"><div class="statusProgress"><div class="progress"><i id="progress"></i></div><div class="small" id="progressText">0 / 0</div></div><div class="statusKcal">${icon("kcal")}${dayKcal} ккал${kcalExtra}</div></div>`;

  // Weekly summary
  const weekStart = Math.floor((state.day - 1) / 7) * 7 + 1;
  const weekEnd = Math.min(planLength(), weekStart + 6);
  let weekCooks = 0, weekReheats = 0, weekShopDay = 0, weekShopCost = 0;
  for (let dn = weekStart; dn <= weekEnd; dn++) {
    const dayActs = ACTIONS[String(dn)] || [];
    dayActs.forEach(a => { const ea = enrichAction(a); if (ea.type === "cook") { if (ea.dish && /разогр/i.test(ea.title || "")) weekReheats++; else weekCooks++; } });
    const pd = DATA.plan[dn - 1];
    if (pd?.shopping_type_actual && pd.actual_day === dn) { weekShopDay = dn; weekShopCost = DATA.shopping[pd.shopping_type_actual]?.totalCost || 0; }
  }
  const weekSummary = `<div class="weekSummary">
    <span class="weekLabel">Неделя ${Math.ceil(state.day / 7)}</span>
    <span class="weekStat">${icon("cook")} ${weekCooks} готовок</span>
    <span class="weekStat">↑ ${weekReheats} разогревов</span>
    ${weekShopDay ? `<span class="weekStat">${icon("cart")} Закупка день ${weekShopDay} · ${money(weekShopCost)}</span>` : ""}
  </div>`;

  const quickNav = `<div class="quickNav">
    <button data-quick="budgetRefs">${icon("cart")} Бюджет и закупки</button>
    <button data-quick="familyRefs">Семья и бюджет</button>
    <button data-quick="inventoryRefs">${icon("fridge")} Остатки и контейнеры</button>
    <button data-quick="weeklyShoppingRefs">Список на неделю</button>
    <button id="shareDayBtn">Поделиться днём</button>
  </div>`;

  document.getElementById("today").innerHTML = sectionTitle(`${icon("meal")}День ${state.day}`, d.title) +
    statusBar + weekSummary + nowCard + quickNav + scheduleBlock + `<details class="scheduleExtras"><summary>Меню · Настройки</summary><div class="extrasBody">${mealDeck}${controls}</div></details>`;
  bind();
  const doneBtn = document.getElementById("markCurrentSimple"); if (doneBtn) doneBtn.onclick = markDone;
  const useNowBtn = document.getElementById("useNow"); if (useNowBtn) useNowBtn.onclick = () => { setAutoNow(true); renderAll(); };
  const skipBtn = document.getElementById("skipCurrent"); if (skipBtn) skipBtn.onclick = skipCurrent;
  const goTomorrow = document.getElementById("goTomorrow"); if (goTomorrow && !goTomorrow.disabled) goTomorrow.onclick = () => changeDay(state.day + 1);
  const shareDayBtn = document.getElementById("shareDayBtn"); if (shareDayBtn) shareDayBtn.onclick = shareDay;
  document.getElementById("toggleFocus").onclick = () => { state.focusMode = !state.focusMode; localStorage.setItem("focus_mode", state.focusMode ? "1" : "0"); renderToday(); };
  document.getElementById("togglePast").onclick = () => { state.hidePast = !state.hidePast; localStorage.setItem("hide_past", state.hidePast ? "1" : "0"); renderToday(); };
}
function isDoneAction(i) { return isDone("action", state.day, i); }
function shiftTime(delta) { const input = document.getElementById("timeInput"); setAutoNow(false); const m = currentMinutes() + delta; input.value = formatMinutes(m); renderAll(); }
function shareDay() {
  const d = day() || {};
  const lines = [`День ${state.day} · ${d.title || ""}`];
  ["Завтрак","Обед","Полдник","Ужин","Чай"].forEach(m => { const meal = d.meals?.[m]; if (meal?.dish) lines.push(`${m}: ${meal.dish}`); });
  const text = lines.join("\n");
  if (navigator.share) { navigator.share({ title: `FoodFlow — день ${state.day}`, text }).catch(() => {}); }
  else { navigator.clipboard.writeText(text).then(() => showToast("Скопировано в буфер")).catch(() => {}); }
}
function snoozeCurrent(delta) { const acts = ACTIONS[String(state.day)] || []; const idx = nearestActionIndex(acts); if (idx < 0) return; const action = enrichAction(acts[idx] || {}); setSnoozeAction(idx, Math.max(effectiveActionMinutes(action, idx), currentMinutes()) + delta); shouldAutoScroll = true; renderAll(); }
function skipCurrent() { if (!confirm("Пропустить ближайший пункт?")) return; const idx = nearestActionIndex(ACTIONS[String(state.day)] || []); if (idx < 0) return; setSkippedAction(idx, true); setDone("action", state.day, idx, false); clearSnoozeAction(idx); shouldAutoScroll = true; renderAll(); }

// ── Modals ──
function openBasket(basketKey, dayNum) {
  const b = DATA.shopping[basketKey]; if (!b) return;
  document.getElementById("modalTitle").textContent = b.name;
  document.getElementById("modalMeta").innerHTML = `<span>День ${dayNum}</span><span>${esc(b.totalCostLabel || b.budget || "")}</span>`;
  document.getElementById("modalBody").innerHTML = `<div class="modalList">${shoppingItemsHtml(b, dayNum)}</div>`;
  openModalTrap(); bind(document.getElementById("modalBody"));
}
function openRecipe(dish, isContainer = false) {
  const r = findRecipe(dish);
  document.getElementById("modalTitle").textContent = isContainer ? `Разогреть: ${dish}` : dish;
  document.getElementById("modalMeta").innerHTML = r ? (isContainer ? `<span>Из контейнера</span><span>~2 мин</span>` : `<span>${esc(r.type || "")}</span><span>${esc(r.time || "")}</span><span>${esc(r.store || "")}</span>`) : "";
  const voiceBtn = r && window.speechSynthesis ? `<button class="voiceBtn" id="voiceBtn">🔊 Вслух</button>` : "";
  const favIcon = isFavorite(dish) ? "♥" : "♡";
  const favBtn = `<button class="favBtn ${isFavorite(dish) ? "active" : ""}" id="favBtn">${favIcon} Избранное</button>`;
  document.getElementById("modalBody").innerHTML = r ? `<div class="tabs"><button class="active" id="shortBtn">Коротко</button><button id="fullBtn">Подробно</button>${voiceBtn}${favBtn}</div><div id="recipeContent">${recipeHtml(dish, "short", isContainer)}</div>` : `<p class="small">Рецепт не найден.</p>`;
  openModalTrap();
  const short = document.getElementById("shortBtn"), full = document.getElementById("fullBtn"), cont = document.getElementById("recipeContent");
  if (short && full) { short.onclick = () => { short.classList.add("active"); full.classList.remove("active"); cont.innerHTML = recipeHtml(dish, "short", isContainer); }; full.onclick = () => { full.classList.add("active"); short.classList.remove("active"); cont.innerHTML = recipeHtml(dish, "full", isContainer); }; }
  const vb = document.getElementById("voiceBtn");
  if (vb) vb.onclick = () => {
    if (window.speechSynthesis.speaking) { window.speechSynthesis.cancel(); vb.classList.remove("speaking"); vb.textContent = "🔊 Вслух"; return; }
    const steps = (r.steps || []).filter(s => s && !/проверь|при необходимости|по вкусу/.test(s));
    if (!steps.length) return;
    const utter = new SpeechSynthesisUtterance(steps.join(". Следующий шаг. "));
    utter.lang = "ru-RU"; utter.rate = 0.95;
    utter.onend = () => { vb.classList.remove("speaking"); vb.textContent = "🔊 Вслух"; };
    vb.classList.add("speaking"); vb.textContent = "⏹ Стоп";
    window.speechSynthesis.speak(utter);
  };
  const fb = document.getElementById("favBtn");
  if (fb) fb.onclick = () => {
    const nowFav = toggleFavorite(dish);
    fb.textContent = `${nowFav ? "♥" : "♡"} Избранное`;
    fb.classList.toggle("active", nowFav);
    showToast(nowFav ? "Добавлено в избранное" : "Убрано из избранного");
  };
}
function openCook(i) {
  const a = enrichAction((ACTIONS[String(state.day)] || [])[i] || {});
  const invToday = inventoryAudit().days[state.day - 1] || {};
  const cookInfo = a.type === "cook" ? (invToday.cooks || []).find(c => c.dish === a.dish && c.time === a.time) : null;
  const isContainer = cookInfo?.source === "container";
  if (a.dish && findRecipe(a.dish)) { openRecipe(a.dish, isContainer); return; }
  document.getElementById("modalTitle").textContent = a.title;
  document.getElementById("modalMeta").innerHTML = `<span>${esc(a.time)}</span>`;
  document.getElementById("modalBody").innerHTML = `<p>${esc(a.detail || a.title)}</p><div class="sideBlock"><h3>Хранение</h3><p class="small">${esc(a.storage || "")}</p></div>`;
  openModalTrap();
}
function closeModal() { document.getElementById("modal").style.display = "none"; document.body.style.overflow = ""; _modalTrapCleanup && _modalTrapCleanup(); }
let _modalTrapCleanup = null, _previousActiveElement = null;
function trapFocus(container) {
  const focusable = () => Array.from(container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(el => !el.disabled && el.offsetParent !== null);
  const first = () => focusable()[0];
  const last = () => focusable()[focusable().length - 1];
  const keyHandler = e => {
    if (e.key !== "Tab") return;
    const f = focusable(); if (f.length === 0) return;
    if (e.shiftKey && document.activeElement === first()) { e.preventDefault(); last().focus(); }
    else if (!e.shiftKey && document.activeElement === last()) { e.preventDefault(); first().focus(); }
  };
  container.addEventListener("keydown", keyHandler);
  _modalTrapCleanup = () => { container.removeEventListener("keydown", keyHandler); _previousActiveElement && _previousActiveElement.focus(); _previousActiveElement = null; };
  const f = focusable(); if (f.length) f[0].focus();
}
function openModalTrap() {
  const modal = document.getElementById("modal");
  modal.style.display = "block"; document.body.style.overflow = "hidden";
  _previousActiveElement = document.activeElement;
  requestAnimationFrame(() => { if (modal.style.display === "block") trapFocus(modal); });
}

// ── Recipe catalog & replacement ──
const PLAN_REPLACEMENTS_LEGACY_KEY = "command_plan_replacements";
function planReplacementsKey() {
  const profileId = `a${state.familyAdults}_c${state.familyChildren}`;
  return `${PLAN_REPLACEMENTS_LEGACY_KEY}_${profileId}`;
}
function loadPlanReplacements() {
  try {
    const scoped = localStorage.getItem(planReplacementsKey());
    if (scoped) return JSON.parse(scoped) || {};
    // Migrate legacy global key to current profile once
    const legacy = localStorage.getItem(PLAN_REPLACEMENTS_LEGACY_KEY);
    if (legacy) {
      localStorage.setItem(planReplacementsKey(), legacy);
      localStorage.removeItem(PLAN_REPLACEMENTS_LEGACY_KEY);
      return JSON.parse(legacy) || {};
    }
    return {};
  } catch (_) { return {}; }
}
function savePlanReplacements(map) {
  localStorage.setItem(planReplacementsKey(), JSON.stringify(map || {}));
}
function applyPlanReplacements() {
  const map = loadPlanReplacements();
  for (const [keyStr, dish] of Object.entries(map)) {
    const [dayStr, mealName] = keyStr.split("|");
    const dayIdx = Number(dayStr) - 1;
    if (!Number.isFinite(dayIdx) || !DATA?.plan?.[dayIdx]?.meals?.[mealName] || !RECIPES[dish]) continue;
    const usage = DISH_USAGE[dish] || RECIPES[dish]?.usage || {};
    const macros = MACRO_BY_ITEM || {};
    let p = 0, f = 0, c = 0;
    for (const [k, v] of Object.entries(usage)) { const m = macros[k]; if (!m) continue; p += (m.p || 0) * v; f += (m.f || 0) * v; c += (m.c || 0) * v; }
      const calcKcal = Math.round(4 * p + 9 * f + 4 * c);
      const recipeKcal = RECIPES[dish]?.macros?.kcal || RECIPES[dish]?.kcal || 0;
      const kcal = calcKcal > 0 && Math.abs(calcKcal - recipeKcal) < 50 ? calcKcal : recipeKcal;
    const cost = Math.round((RECIPES[dish]?.cost || 0));
    DATA.plan[dayIdx].meals[mealName] = {
      dish,
      portion: scalePortionText(RECIPES[dish]?.ingredients),
      kcal,
      cost,
      dishCost: cost,
      costLabel: `~${cost} ₽`,
      _replaced: true
    };
  }
}

const CATALOG_PAGE_SIZE = 30;
let _catalogState = { query: "", type: "", page: 0, replaceTarget: null };

function recipeMatchesQuery(name, recipe, query) {
  if (!query) return true;
  const haystack = (name + " " + (recipe.title || "") + " " + (recipe.type || "") + " " + (recipe.ingredients || []).join(" ")).toLowerCase();
  return haystack.includes(query);
}
function catalogTypes() {
  const types = new Set();
  for (const r of Object.values(RECIPES || {})) { if (r.type) types.add(r.type); }
  return [...types].sort();
}
function catalogResults() {
  const q = (_catalogState.query || "").trim().toLowerCase();
  const type = _catalogState.type || "";
  const all = [];
  for (const [name, r] of Object.entries(RECIPES || {})) {
    if (type && r.type !== type) continue;
    if (!recipeMatchesQuery(name, r, q)) continue;
    all.push([name, r]);
  }
  all.sort((a, b) => a[0].localeCompare(b[0], "ru"));
  return all;
}
function renderCatalogList() {
  const list = document.getElementById("catalogList");
  const footer = document.getElementById("catalogFooter");
  if (!list) return;
  const all = catalogResults();
  const total = all.length;
  const pageSize = CATALOG_PAGE_SIZE;
  const maxPage = Math.max(0, Math.ceil(total / pageSize) - 1);
  if (_catalogState.page > maxPage) _catalogState.page = maxPage;
  const start = _catalogState.page * pageSize;
  const slice = all.slice(start, start + pageSize);
  list.innerHTML = slice.map(([name, r]) => {
    const meta = [r.type, r.time, (r.kcal || r.macros?.kcal) ? `${r.kcal || r.macros?.kcal} ккал` : "", r.cost ? `~${Math.round(r.cost)} ₽` : ""].filter(Boolean).join(" · ");
    const replaceBtn = _catalogState.replaceTarget ? `<button class="primary" data-replace="${esc(name)}">Заменить</button>` : "";
    return `<div class="catalogRow" draggable="true" tabindex="0" data-drag-dish="${esc(name)}"><div><strong>${esc(name)}</strong><div class="meta">${esc(meta)}</div></div><button data-dish="${esc(name)}">Открыть</button>${replaceBtn}</div>`;
  }).join("") || `<p class="small">Ничего не найдено.</p>`;
  if (footer) footer.textContent = total ? `Найдено: ${total}. Страница ${_catalogState.page + 1} из ${maxPage + 1}.` : "";
  list.querySelectorAll("[data-dish]").forEach(btn => btn.addEventListener("click", () => openRecipe(btn.dataset.dish)));
  list.querySelectorAll("[data-replace]").forEach(btn => btn.addEventListener("click", () => confirmReplacement(btn.dataset.replace)));
  list.querySelectorAll(".catalogRow").forEach(row => {
    row.addEventListener("keydown", e => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      const name = row.dataset.dragDish;
      if (_catalogState.replaceTarget) confirmReplacement(name); else openRecipe(name);
    });
  });
}
function openCatalog(replaceTarget = null) {
  _catalogState = { query: "", type: "", page: 0, replaceTarget };
  const title = replaceTarget ? `Заменить: ${replaceTarget.dish}` : "Каталог рецептов";
  const meta = replaceTarget ? `<span>День ${replaceTarget.day}, ${replaceTarget.mealName}</span>` : `<span>${Object.keys(RECIPES || {}).length} рецептов</span>`;
  document.getElementById("modalTitle").textContent = title;
  document.getElementById("modalMeta").innerHTML = meta;
  const types = catalogTypes();
  document.getElementById("modalBody").innerHTML = `
    <div class="catalogBar">
      <input id="catalogQuery" type="search" placeholder="Поиск по названию, типу, ингредиентам" autocomplete="off">
      <select id="catalogType"><option value="">Все типы</option>${types.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join("")}</select>
    </div>
    <div class="catalogList" id="catalogList"></div>
    <div class="catalogFooter">
      <button id="catalogPrev">Назад</button>
      <span id="catalogFooter"></span>
      <button id="catalogNext">Дальше</button>
    </div>
  `;
  openModalTrap();
  const queryInput = document.getElementById("catalogQuery");
  const typeSelect = document.getElementById("catalogType");
  queryInput.addEventListener("input", () => { _catalogState.query = queryInput.value; _catalogState.page = 0; renderCatalogList(); });
  typeSelect.addEventListener("change", () => { _catalogState.type = typeSelect.value; _catalogState.page = 0; renderCatalogList(); });
  document.getElementById("catalogPrev").addEventListener("click", () => { _catalogState.page = Math.max(0, _catalogState.page - 1); renderCatalogList(); });
  document.getElementById("catalogNext").addEventListener("click", () => { _catalogState.page = _catalogState.page + 1; renderCatalogList(); });
  renderCatalogList();
}
function confirmReplacement(newDish) {
  const target = _catalogState.replaceTarget;
  if (!target || !RECIPES[newDish]) return;
  if (!confirm(`Заменить "${target.dish}" на "${newDish}" в дне ${target.day} (${target.mealName})?`)) return;
  const map = loadPlanReplacements();
  map[`${target.day}|${target.mealName}`] = newDish;
  savePlanReplacements(map);
  applyPlanReplacements();
  closeModal();
  renderAll();
}
function startReplaceFlow(dayNum, mealName) {
  const meal = DATA?.plan?.[dayNum - 1]?.meals?.[mealName];
  if (!meal) return;
  openCatalog({ day: dayNum, mealName, dish: meal.dish });
}
function clearReplacement(dayNum, mealName) {
  const map = loadPlanReplacements();
  delete map[`${dayNum}|${mealName}`];
  savePlanReplacements(map);
  if (window.FoodFlowDataStore?.refresh) {
    window.FoodFlowDataStore.refresh().then(() => { initRuntimeData(); applyFamilyScale(); applyStorePrices(); applyPlanReplacements(); renderAll(); });
  } else {
    renderAll();
  }
}

function exportRuntimeErrors() {
  const raw = localStorage.getItem("foodflow_runtime_errors") || "[]";
  let entries; try { entries = JSON.parse(raw); } catch (_) { entries = []; }
  if (!entries.length) { alert("Лог ошибок пуст."); return; }
  const blob = new Blob([JSON.stringify(entries, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `foodflow-runtime-errors-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}
function clearRuntimeErrors() {
  localStorage.removeItem("foodflow_runtime_errors");
  alert("Лог ошибок очищен.");
}

// ── Bind & progress ──
function bind(root = document) {
  root.querySelectorAll("input.check").forEach(x => x.addEventListener("change", e => {
    const el = e.currentTarget; setDone(el.dataset.type, el.dataset.day, el.dataset.index, el.checked);
    if (el.dataset.type === "action") { if (el.checked) { localStorage.setItem(key("skip", el.dataset.day, el.dataset.index), "0"); localStorage.removeItem(key("snooze", el.dataset.day, el.dataset.index)); } shouldAutoScroll = true; renderAll(); return; }
    progress();
  }));
  root.querySelectorAll("[data-dish]").forEach(b => b.addEventListener("click", () => openRecipe(b.dataset.dish)));
  root.querySelectorAll("[data-cook]").forEach(b => b.addEventListener("click", () => openCook(Number(b.dataset.cook))));
  root.querySelectorAll("[data-basket]").forEach(b => b.addEventListener("click", () => openBasket(b.dataset.basket, b.dataset.basketDay)));
  root.querySelectorAll("[data-replace-meal]").forEach(b => b.addEventListener("click", () => startReplaceFlow(state.day, b.dataset.replaceMeal)));
  root.querySelectorAll("[data-clear-replace]").forEach(b => b.addEventListener("click", () => clearReplacement(state.day, b.dataset.clearReplace)));
  root.querySelectorAll("[data-quick]").forEach(b => b.addEventListener("click", () => expandSection(b.dataset.quick)));
  // Drag-and-drop: catalog rows → meal cards
  root.querySelectorAll("[data-drag-dish]").forEach(row => {
    row.addEventListener("dragstart", e => { e.dataTransfer.setData("text/dish", row.dataset.dragDish); e.dataTransfer.effectAllowed = "move"; });
  });
  root.querySelectorAll(".mealCard").forEach(card => {
    card.addEventListener("dragover", e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; card.style.outline = "2px solid var(--ui-blue)"; });
    card.addEventListener("dragleave", () => { card.style.outline = ""; });
    card.addEventListener("drop", e => {
      e.preventDefault(); card.style.outline = "";
      const dish = e.dataTransfer.getData("text/dish");
      const mealName = card.querySelector(".mealType")?.textContent;
      if (dish && mealName && RECIPES[dish]) { _catalogState.replaceTarget = { day: state.day, mealName, dish: card.querySelector(".mealName")?.textContent || "" }; confirmReplacement(dish); }
    });
  });
}
function expandSection(id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.tagName === "DETAILS") el.open = true;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}
function progress() {
  let total = 0, done = 0;
  Object.entries(ACTIONS).forEach(([d, arr]) => arr.forEach((_, i) => { total++; if (isDone("action", d, i) || localStorage.getItem(key("skip", d, i)) === "1") done++; }));
  DATA.plan.forEach(d => { if (d.shopping_type_actual) (DATA.shopping[d.shopping_type_actual].itemBoxes || DATA.shopping[d.shopping_type_actual].items || []).forEach((_, i) => { total++; if (isDone("shop", d.actual_day, i)) done++; }); });
  const pct = total ? Math.round(done / total * 100) : 0;
  document.getElementById("progress").style.width = pct + "%";
  document.getElementById("progressText").textContent = `${done} / ${total} · ${pct}%`;
}
function scrollToCurrentAction() {
  if (!shouldAutoScroll) return; shouldAutoScroll = false;
  requestAnimationFrame(() => { const target = document.querySelector(state.focusMode ? ".nowCard" : ".nextAction") || document.querySelector(".nowCard"); target?.scrollIntoView({ behavior: "smooth", block: "center" }); });
}
function updatePwaStatus() {
  const el = document.getElementById("pwaStatus");
  if (!el) return;
  const online = navigator.onLine !== false;
  el.textContent = online ? "Сеть есть" : "Офлайн";
  el.classList.toggle("offline", !online);
}
// ── Notifications ──
function requestNotifPermission() {
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") Notification.requestPermission();
}
function scheduleNotifs() {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const now = new Date();
  const h = now.getHours(), m = now.getMinutes();
  // Cancel any existing scheduled notifs via timeout
  clearTimeout(window._notifCook);
  clearTimeout(window._notifShop);
  // "Пора готовить обед" at 12:05
  if (h < 12 || (h === 12 && m < 5)) {
    const minsUntil = (12 * 60 + 5) - (h * 60 + m);
    if (minsUntil < 0 || minsUntil * 60000 > 2147483647) return;
    window._notifCook = setTimeout(() => {
      const acts = ACTIONS[String(state.day)] || [];
      const cook = acts.find(a => { const ea = enrichAction(a); return ea.type === "cook" && minutes(ea.time) >= 720 && minutes(ea.time) <= 780; });
      if (cook) new Notification("FoodFlow", { body: `Пора готовить: ${enrichAction(cook).title}`, icon: "./icons/icon-192.png" });
    }, minsUntil * 60000);
  }
  // "Закажи закупку" at 21:00 if shopping tomorrow
  const tomorrow = state.day + 1;
  if (tomorrow <= planLength()) {
    const td = DATA.plan[tomorrow - 1];
    if (td?.shopping_type_actual && h < 21) {
      const minsUntil = (21 * 60) - (h * 60 + m);
      if (minsUntil < 0 || minsUntil * 60000 > 2147483647) return;
      window._notifShop = setTimeout(() => {
        new Notification("FoodFlow", { body: `Завтра закупка: ${DATA.shopping[td.shopping_type_actual]?.name || ""}`, icon: "./icons/icon-192.png" });
      }, minsUntil * 60000);
    }
  }
}
function showLoadError(message) {
  const overlay = document.getElementById("loadingOverlay");
  const target = document.getElementById("loadingMessage");
  if (!overlay || !target) return false;
  target.textContent = message;
  overlay.style.opacity = "1";
  return true;
}

// ── Render fridge door (primary view) ──
function renderFridge(_audit, _invToday) {
  const el = document.getElementById("fridge");
  if (!el) return;
  const audit = _audit || inventoryAudit();
  const today = _invToday || audit.days[state.day - 1];
  if (!today) return;

  // ── Build shelf data ──
  const shelfData = [
    { key: "freezer", label: "Морозилка", icon: "❄", css: "shelf-freezer", items: [], containers: [] },
    { key: "fridge", label: "Холодильник", icon: "🧊", css: "shelf-fridge", items: [], containers: [] },
    { key: "base", label: "Полки", icon: "📦", css: "shelf-pantry", items: [], containers: [] }
  ];

  // Place items into shelves by group
  for (const shelf of shelfData) {
    shelf.items = compactStock(today.end, shelf.key);
    shelf.containers = today.containersEnd.filter(c => {
      if (shelf.key === "freezer") return c.location === "freezer";
      if (shelf.key === "fridge") return c.location === "fridge";
      return false;
    });
  }

  // Slot usage
  const fridgeSlots = today.slotUse?.fridge || 0;
  const freezerSlots = today.slotUse?.freezer || 0;

  function freshnessClass(itemKey) {
    const shelfLife = SHELF_LIFE_DAYS[itemKey];
    if (!shelfLife) return "";
    // Check if item expires within 2 days
    const purchases = INVENTORY_PURCHASES.filter(p => p.items[itemKey]);
    if (!purchases.length) return "";
    const lastBought = Math.max(...purchases.map(p => p.availableDay));
    const expires = lastBought + shelfLife - 1;
    const daysLeft = expires - state.day;
    if (daysLeft < 0) return "expired";
    if (daysLeft <= 1) return "danger";
    if (daysLeft <= 2) return "warn";
    return "";
  }

  function chipHtml(itemStr) {
    // Parse "Name amount unit" from formatInvItem output
    const parts = itemStr.match(/^(.+?)\s(\d+(?:[.,]\d+)?\s*\S*)$/);
    if (!parts) return `<span class="chip"><span class="chip-name">${esc(itemStr)}</span></span>`;
    const name = parts[1];
    const amount = parts[2];
    // Find item key for freshness
    let fKey = null;
    for (const [k, meta] of Object.entries(INVENTORY_ITEMS)) {
      if (meta[0] === name) { fKey = k; break; }
    }
    const freshness = fKey ? freshnessClass(fKey) : "";
    return `<span class="chip" data-freshness="${freshness}"><span class="chip-name">${esc(name)}</span><span class="chip-amount">${esc(amount)}</span><span class="chip-dot"></span></span>`;
  }

  function containerHtml(c) {
    const diff = c.targetDay - state.day;
    const targetLabel = diff === 0 ? "сегодня" : diff === 1 ? "завтра" : `через ${diff} дн.`;
    return `<div class="container-card">
      <span class="container-id">#${c.id}</span>
      <span class="container-dish">${esc(c.dish)}</span>
      <span class="container-meta">${c.weight} г</span>
      <span class="container-target">${targetLabel}</span>
    </div>`;
  }

  function shelfHtml(shelf) {
    const slotKey = shelf.key === "freezer" ? "freezer" : shelf.key === "fridge" ? "fridge" : null;
    const maxSlots = slotKey ? CONTAINER_SLOTS[slotKey] || 0 : 0;
    const usedSlots = slotKey ? today.slotUse?.[slotKey] || 0 : 0;
    const overMax = maxSlots > 0 && usedSlots > maxSlots;
    const slotBadge = maxSlots > 0
      ? `<span class="shelf-badge${overMax ? " over" : ""}">${usedSlots}/${maxSlots} слотов</span>`
      : "";

    const chips = shelf.items.length
      ? shelf.items.map(chipHtml).join("")
      : `<span class="chip-empty">пусто</span>`;
    const containers = shelf.containers.length
      ? shelf.containers.map(containerHtml).join("")
      : "";

    return `<section class="shelf ${shelf.css}">
      <div class="shelf-head">
        <span class="shelf-label">${shelf.icon} ${esc(shelf.label)}</span>
        ${slotBadge}
      </div>
      ${containers}
      <div class="chip-rack">${chips}</div>
    </section>`;
  }

  // ── Magnet card: today's plan ──
  const d = day() || {};
  const dayKcal = cals(d);
  const profile = currentFamilyProfile();
  const kcalPerPerson = profile.units > 1 ? ` <span style="font-size:13px;color:var(--color-muted)">(~${Math.round(dayKcal / profile.units)} на чел)</span>` : "";
  const acts = (ACTIONS[String(state.day)] || []).map(enrichAction);
  const nextIdx = nearestActionIndex(acts);
  const allDone = acts.every((_, i) => isCompleteAction(i));
  const current = enrichAction(acts[nextIdx] || {});
  const nextMin = current ? effectiveActionMinutes(current, nextIdx) : currentMinutes();
  const nowMin = currentMinutes();
  const waitLine = allDone ? "Всё готово" : nextMin > nowMin ? `Через ${diffText(nextMin)}` : "Сейчас";

  const currentCook = current.type === "cook" ? (today.cooks || []).find(c => c.dish === current.dish && c.time === current.time) : null;
  const currentTitle = currentCook?.source === "container" ? current.dish : current.title;
  const nowBtn = !allDone && current.dish
    ? (current.type === "order" ? `<button data-basket="${esc(current.basket)}" data-basket-day="${state.day}">Заказ</button>`
     : current.type === "cook" ? `<button data-cook="${nextIdx}">Рецепт</button>`
     : `<button data-dish="${esc(current.dish)}">Рецепт</button>`)
    : "";
  const doneBtn = !allDone ? `<button class="primaryAction" id="markCurrentSimple">Готово</button>` : "";
  const goBtn = allDone && state.day < planLength() ? `<button class="primaryAction" id="goTomorrow">Завтра</button>` : "";

  // Progress
  let total = 0, doneCount = 0;
  Object.entries(ACTIONS).forEach(([d, arr]) => arr.forEach((_, i) => { total++; if (isDone("action", d, i) || localStorage.getItem(key("skip", d, i)) === "1") doneCount++; }));
  DATA.plan.forEach(d => { if (d.shopping_type_actual) (DATA.shopping[d.shopping_type_actual].itemBoxes || DATA.shopping[d.shopping_type_actual].items || []).forEach((_, i) => { total++; if (isDone("shop", d.actual_day, i)) doneCount++; }); });
  const pct = total ? Math.round(doneCount / total * 100) : 0;

  const magnetCard = `<div class="magnet-card">
    <div class="magnet-title">День ${state.day}</div>
    <div class="magnet-row">
      <div class="progress"><i id="progress" style="width:${pct}%"></i></div>
      <div class="magnet-kcal">${icon("kcal")}${dayKcal} ккал${kcalPerPerson}</div>
    </div>
    <div style="font-size:13px;color:var(--color-muted);margin-top:4px">${doneCount}/${total} · ${pct}%</div>
    ${allDone ? "" : `<div style="margin-top:var(--space-sm)">
      <div class="magnet-when">${waitLine}</div>
      <div class="magnet-dish">${esc(currentTitle)}</div>
      <div class="magnet-meta">${current.kcal ? `${current.kcal} ккал` : typeLabel(current.type)}</div>
      <div class="magnet-actions">${doneBtn}${nowBtn}${goBtn}</div>
    </div>`}
    ${allDone ? `<div style="margin-top:var(--space-sm)">
      <div class="magnet-dish">Всё готово</div>
      <div class="magnet-actions">${goBtn}</div>
    </div>` : ""}
  </div>`;

  // ── Notepad: next shopping ──
  const weekStart = Math.floor((state.day - 1) / 7) * 7 + 1;
  const weekEnd = Math.min(planLength(), weekStart + 6);
  let shopItems = [];
  for (let dn = state.day; dn <= weekEnd; dn++) {
    const pd = DATA.plan[dn - 1];
    if (pd?.shopping_type_actual && pd.actual_day === dn) {
      const b = DATA.shopping[pd.shopping_type_actual];
      if (b?.itemBoxes) shopItems.push({ name: b.name, items: b.itemBoxes, key: pd.shopping_type_actual, day: dn });
    }
  }
  const MAX_NOTEPAD = 8;
  let notepadHtml = "";
  if (shopItems.length) {
    const first = shopItems[0];
    const allItems = shopItems.flatMap(s => s.items || []);
    const visible = allItems.slice(0, MAX_NOTEPAD);
    const rest = allItems.length - MAX_NOTEPAD;
    notepadHtml = `<div class="notepad">
      <div class="notepad-title">Закупки</div>
      ${visible.map((it, i) => `<div class="notepad-item">
        <input class="check" type="checkbox" data-type="shop" data-day="${first.day}" data-index="${i}">
        <span>${esc(it.title)}${it.quantity > 1 ? ` ×${it.quantity}` : ""}</span>
      </div>`).join("")}
      ${rest > 0 ? `<button class="notepad-more" data-basket="${esc(first.key)}" data-basket-day="${first.day}">Ещё ${rest} позиций</button>` : ""}
    </div>`;
  } else {
    notepadHtml = `<div class="notepad">
      <div class="notepad-title">Закупки</div>
      <div class="notepad-item" style="color:var(--color-muted);font-style:italic;border:0">На этой неделе нет</div>
    </div>`;
  }

  el.innerHTML = `
    <div class="fridge-body">
      ${shelfData.map(shelfHtml).join("")}
    </div>
    <div class="fridge-door">
      ${magnetCard}
      ${notepadHtml}
    </div>
  `;

  // Bind fridge interactions
  const markSimple = document.getElementById("markCurrentSimple");
  if (markSimple) markSimple.onclick = markDone;
  const goTomorrow = document.getElementById("goTomorrow");
  if (goTomorrow && !goTomorrow.disabled) goTomorrow.onclick = () => changeDay(state.day + 1);
  el.querySelectorAll("[data-dish]").forEach(b => b.addEventListener("click", () => openRecipe(b.dataset.dish)));
  el.querySelectorAll("[data-cook]").forEach(b => b.addEventListener("click", () => openCook(Number(b.dataset.cook))));
  el.querySelectorAll("[data-basket]").forEach(b => b.addEventListener("click", () => openBasket(b.dataset.basket, Number(b.dataset.basketDay))));
  bind(el);
}

// ── Render all ──
function renderAll() {
  const _audit = inventoryAudit();
  const _invToday = _audit.days[state.day - 1];
  renderFridge(_audit, _invToday);
  renderToday(_audit, _invToday); renderRefs(); renderFamilyBudget();
  try { renderInventory(_audit, _invToday); } catch (e) { console.warn("renderInventory failed", e); }
  try { renderWeeklyShopping(); } catch (e) { console.warn("renderWeeklyShopping failed", e); }
  progress(); staticIcons(); scrollToCurrentAction();
}
function changeDay(n) {
  state.day = clampDay(n); localStorage.setItem("command_day", state.day); daySelect.value = state.day;
  const timeInput = document.getElementById("timeInput"); const nowInit = new Date();
  if (state.autoNow) timeInput.value = `${String(nowInit.getHours()).padStart(2, "0")}:${String(nowInit.getMinutes()).padStart(2, "0")}`;
  shouldAutoScroll = true; renderAll();
}
function markDone() {
  const acts = ACTIONS[String(state.day)] || [];
  const idx = nearestActionIndex(acts);
  if (idx < 0) return;
  setDone("action", state.day, idx, true); setSkippedAction(idx, false); clearSnoozeAction(idx); shouldAutoScroll = true; renderAll();
}

// ── Browser-side plan generation ──
function generateNewPlan(seed) {
  if (!RECIPES || !DISH_USAGE || !PRODUCTS) { showToast("Данные не загружены"); return; }
  const DAYS = 30;
  const profile = currentFamilyProfile();
  const FAMILY_SCALE = familyScaleFactor(profile.units);
  const BUDGET = state.familyBudget;
  const DISH_BUDGET = Math.round(BUDGET * 0.65);

  // Seeded PRNG
  let _s = (seed || 42) | 0 || 1;
  function rand() { _s ^= _s << 13; _s ^= _s >> 17; _s ^= _s << 5; return (_s >>> 0) / 4294967296; }
  function randInt(a, b) { return a + Math.floor(rand() * (b - a + 1)); }
  function shuffle(arr) { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = randInt(0, i); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  // Meal compatibility map (same as generate-plan.js)
  const TYPE_MEAL_MAP = {
    "Готовить утром": ["Завтрак"], "Готовить свежим": ["Завтрак","Обед","Полдник","Ужин"],
    "Готовить сейчас": ["Завтрак"], "Собрать без готовки": ["Полдник","Чай"], "Без готовки": ["Полдник","Чай"],
    "Быстрый перекус": ["Полдник","Чай"], "Быстро": ["Завтрак","Обед","Полдник","Ужин","Чай"],
    "Быстро из остатков": ["Ужин"], "Основное": ["Обед","Ужин"], "Рагу": ["Обед","Ужин"],
    "Готовить на 2 порции": ["Обед","Ужин"], "Готовить на 2-3 порции": ["Обед"],
    "Готовить кастрюлю на 2-3 порции": ["Обед"], "Готовить кастрюлю на 3 порции": ["Обед"],
    "Готовка на 2 порции": ["Обед","Ужин"], "Готовка на 3 порции": ["Обед"],
    "Заготовка на 4 порции": ["Обед"], "Заморозка": ["Обед","Ужин"],
    "Заморозка + гарнир": ["Обед","Ужин"], "Заморозка + паста": ["Ужин"],
    "Заморозка + свежий салат": ["Обед","Ужин"], "Диетическое": ["Обед","Ужин"],
    "Жареное": ["Обед","Ужин"], "Запеканка": ["Обед","Ужин"], "Вегетарианское": ["Обед","Ужин"],
    "Противень/сковорода": ["Ужин"], "Разогреть": ["Обед","Ужин"], "Рыба": ["Обед","Ужин"],
    "Фарш или заморозка": ["Обед","Ужин"], "Бюджетная классика": ["Ужин"],
  };
  const M_ORDER = MEAL_ORDER || ["Завтрак","Обед","Полдник","Ужин","Чай"];
  const MEAL_TARGETS = {
    Завтрак: { kcalMin: 250 * FAMILY_SCALE, kcalMax: 700 * FAMILY_SCALE, costMin: 30 * FAMILY_SCALE, costMax: 130 * FAMILY_SCALE },
    Обед:    { kcalMin: 350 * FAMILY_SCALE, kcalMax: 900 * FAMILY_SCALE, costMin: 70 * FAMILY_SCALE, costMax: 250 * FAMILY_SCALE },
    Полдник: { kcalMin: 150 * FAMILY_SCALE, kcalMax: 420 * FAMILY_SCALE, costMin: 30 * FAMILY_SCALE, costMax: 135 * FAMILY_SCALE },
    Ужин:    { kcalMin: 300 * FAMILY_SCALE, kcalMax: 900 * FAMILY_SCALE, costMin: 50 * FAMILY_SCALE, costMax: 250 * FAMILY_SCALE },
    Чай:     { kcalMin: 50 * FAMILY_SCALE,  kcalMax: 200 * FAMILY_SCALE, costMin: 5 * FAMILY_SCALE,  costMax: 40 * FAMILY_SCALE  },
  };
  const DAILY_KCAL_TARGET = Math.round(2100 * FAMILY_SCALE);
  const DAILY_PROTEIN_TARGET = Math.round(120 * FAMILY_SCALE);
  const MAX_DAILY_COOK_MIN = 60;

  // Build meal pools from existing recipes
  const mealPools = {}; M_ORDER.forEach(m => { mealPools[m] = []; });
  Object.entries(RECIPES).forEach(([name, r]) => {
    const type = r.type || "?";
    const meals = TYPE_MEAL_MAP[type] || [];
    const kcal = r.macros?.kcal || r.kcal || 0;
    const cost = r.cost || 0;
    const du = DISH_USAGE[name];
    if (!du || !Object.keys(du).length) return;
    meals.forEach(meal => {
      const t = MEAL_TARGETS[meal];
      if (t && cost >= t.costMin * 0.4 && cost <= t.costMax * 1.8 &&
          kcal >= t.kcalMin * 0.2 && kcal <= t.kcalMax * 2) {
        mealPools[meal].push(name);
      }
    });
  });

  function getRecipeInfo(name) {
    const r = RECIPES[name]; if (!r) return null;
    const type = r.type || "";
    const rawMin = ACTIVE_MIN[name] || r.activeMinutes || 15;
    let cookMin;
    if (type.includes("Без готовки") || type.includes("Собрать без готовки") || type.includes("Быстрый перекус")) cookMin = 2;
    else if (type.includes("Разогреть")) cookMin = 5;
    else if (type.includes("Заморозка") || type.includes("Фарш")) cookMin = 10;
    else cookMin = rawMin;
    return {
      kcal: Math.round((r.macros?.kcal || r.kcal || 0) * FAMILY_SCALE),
      protein: Math.round((r.macros?.p || 0) * FAMILY_SCALE * 10) / 10,
      cost: Math.round((r.cost || 0) * FAMILY_SCALE),
      cookMin, type,
    };
  }
  // scalePortionText is now a global function

  // Weekly balance
  const MAX_FREEZE_PER_WEEK = 5, MIN_FISH_PER_WEEK = 2, MIN_MEAT_PER_WEEK = 3;
  function getWeek(d) { return Math.ceil(d / 7); }
  function getMinForWeek(wk, base) { const days = Math.min(wk * 7, DAYS) - (wk - 1) * 7; return Math.max(1, Math.round(base * days * 2 / 14)); }
  function isMeatDish(d) { const u = DISH_USAGE[d] || {}; return !!(u.chicken_g || u.mince_g || u.cutlets_g || u.meatballs_g || u.nuggets_g || u.pelmeni_g); }
  const weekFreeze = {}, weekFish = {}, weekMeat = {};

  const plan = [], usedInPlan = new Set(), containerDishes = {};
  let totalCost = 0;

  for (let dayNum = 1; dayNum <= DAYS; dayNum++) {
    const dayMeals = {};
    let dayCost = 0, dayKcal = 0, dayProtein = 0, dayCookMin = 0;
    const usedToday = new Set();
    const daysRemaining = DAYS - dayNum + 1;
    const budgetRemaining = DISH_BUDGET - totalCost;
    const dailyBudgetTarget = budgetRemaining / daysRemaining;

    M_ORDER.forEach(mealName => {
      const ck = `${dayNum}-${mealName}`;
      if (containerDishes[ck]) {
        const cd = containerDishes[ck];
        const info = getRecipeInfo(cd.dish);
        const c = Math.round((info?.cost || 0) * 0.4);
        const kcal = Math.round((info?.kcal || 0) * 0.4);
        const protein = Math.round((info?.protein || 0) * 0.4 * 10) / 10;
        dayMeals[mealName] = { dish: cd.dish, portion: scalePortionText(RECIPES[cd.dish]?.ingredients), kcal, cost: c, dishCost: c, costLabel: `~${c} ₽` };
        dayCost += c; dayKcal += kcal; dayProtein += protein;
        usedToday.add(cd.dish);
        if (mealName === "Обед" || mealName === "Ужин") {
          const wk = getWeek(dayNum);
          if (info?.type?.includes("Заморозка")) weekFreeze[wk] = (weekFreeze[wk] || 0) + 1;
          const isFish = info?.type?.includes("Рыба") || cd.dish.toLowerCase().includes("рыб") || cd.dish.toLowerCase().includes("минта") || cd.dish.toLowerCase().includes("хек");
          if (isFish) weekFish[wk] = (weekFish[wk] || 0) + 1;
          if (isMeatDish(cd.dish)) weekMeat[wk] = (weekMeat[wk] || 0) + 1;
        }
        return;
      }

      const pool = mealPools[mealName];
      if (!pool.length) { dayMeals[mealName] = { dish: "—", portion: "", kcal: 0, cost: 0, dishCost: 0, costLabel: "~0 ₽" }; return; }

      const unused = pool.filter(d => !usedInPlan.has(d));
      const used = pool.filter(d => usedInPlan.has(d));
      const t = MEAL_TARGETS[mealName];
      const kcalMid = (t.kcalMin + t.kcalMax) / 2, costMid = (t.costMin + t.costMax) / 2;
      const kcalDeficit = Math.max(0, DAILY_KCAL_TARGET - dayKcal);
      const proteinDeficit = Math.max(0, DAILY_PROTEIN_TARGET - dayProtein);
      const cookRemaining = Math.max(0, MAX_DAILY_COOK_MIN - dayCookMin);
      const budgetPressure = dayCost > dailyBudgetTarget ? (dayCost - dailyBudgetTarget) / dailyBudgetTarget : 0;

      let candidates = [...shuffle(unused).slice(0, 14), ...shuffle(used).slice(0, 10)];
      if (!candidates.length) candidates.push(...shuffle(pool).slice(0, 4));

      if (mealName === "Обед" || mealName === "Ужин") {
        const wk = getWeek(dayNum);
        if ((weekFish[wk] || 0) < getMinForWeek(wk, MIN_FISH_PER_WEEK)) {
          pool.filter(d => { const r = RECIPES[d]; return r?.type?.includes("Рыба") || d.toLowerCase().includes("рыб") || d.toLowerCase().includes("минта"); })
            .forEach(f => { if (!candidates.includes(f)) candidates.push(f); });
        }
        if ((weekMeat[wk] || 0) < getMinForWeek(wk, MIN_MEAT_PER_WEEK)) {
          pool.filter(d => isMeatDish(d)).forEach(m => { if (!candidates.includes(m)) candidates.push(m); });
        }
      }

      let bestDish = candidates[0], bestScore = Infinity;
      for (const d of candidates) {
        const info = getRecipeInfo(d); if (!info) continue;
        let score = 0;
        score += Math.abs(info.kcal - kcalMid) * 1;
        score += Math.abs(info.cost - costMid) * 2;
        if (proteinDeficit > 20) score -= info.protein * 3;
        else if (proteinDeficit > 5) score -= info.protein * 1;
        if (kcalDeficit > 300 && info.kcal > kcalMid) score -= (info.kcal - kcalMid) * 1.2;
        else if (kcalDeficit > 150 && info.kcal > kcalMid) score -= (info.kcal - kcalMid) * 0.6;
        if ((mealName === "Обед" || mealName === "Ужин") && info.kcal < kcalMid * 0.5) score += 600;
        const mealCap = mealName === "Завтрак" ? 30 : mealName === "Обед" || mealName === "Ужин" ? 45 : 10;
        const dishCook = Math.min(info.cookMin, mealCap);
        if (dishCook > cookRemaining) score += 1200;
        else if (dishCook > cookRemaining * 0.8) score += 200;
        if (dayCookMin > MAX_DAILY_COOK_MIN * 0.5) score += dishCook * 12;
        const globalOver = (totalCost + dayCost) - DISH_BUDGET * (dayNum / DAYS);
        if (globalOver > 500) score += info.cost * 6;
        else if (globalOver > 0) score += info.cost * 3;
        if (budgetPressure > 0.3) score += info.cost * 3;
        if (usedToday.has(d)) score += 600;
        if (!usedInPlan.has(d)) score -= 50;
        else {
          const timesUsed = plan.flatMap(p => Object.values(p.meals).map(m => m.dish)).filter(x => x === d).length;
          if (timesUsed >= 4) score += 200;
          else if (timesUsed >= 3) score += 100;
          else if (timesUsed >= 2) score += 80;
        }
        if (mealName === "Обед" || mealName === "Ужин") {
          const wk = getWeek(dayNum);
          if (info.type.includes("Заморозка") && (weekFreeze[wk] || 0) >= MAX_FREEZE_PER_WEEK) score += 500;
          const isFish = info.type.includes("Рыба") || d.toLowerCase().includes("рыб") || d.toLowerCase().includes("минта");
          if (isFish && (weekFish[wk] || 0) < getMinForWeek(wk, MIN_FISH_PER_WEEK)) score -= 80;
          if (isMeatDish(d) && (weekMeat[wk] || 0) < getMinForWeek(wk, MIN_MEAT_PER_WEEK)) score -= 80;
        }
        if (score < bestScore) { bestScore = score; bestDish = d; }
      }

      const r = RECIPES[bestDish]; const info = getRecipeInfo(bestDish);
      usedInPlan.add(bestDish); usedToday.add(bestDish);
      const c = Math.round(info.cost || 0);
      if (mealName === "Обед" || mealName === "Ужин") {
        const wk = getWeek(dayNum);
        if (info.type.includes("Заморозка")) weekFreeze[wk] = (weekFreeze[wk] || 0) + 1;
        const isFish = info.type.includes("Рыба") || bestDish.toLowerCase().includes("рыб") || bestDish.toLowerCase().includes("минта");
        if (isFish) weekFish[wk] = (weekFish[wk] || 0) + 1;
        if (isMeatDish(bestDish)) weekMeat[wk] = (weekMeat[wk] || 0) + 1;
      }
      dayMeals[mealName] = { dish: bestDish, portion: scalePortionText(r?.ingredients), kcal: info.kcal, cost: c, dishCost: c, costLabel: `~${c} ₽` };
      dayCost += c; dayKcal += info.kcal; dayProtein += info.protein;
      dayCookMin += Math.min(info.cookMin, mealName === "Завтрак" ? 30 : mealName === "Обед" || mealName === "Ужин" ? 45 : 10);

      // Container rule
      const cr = r?.containerRule || CONTAINER_RULES[bestDish];
      if (cr && (cr.maxExtra || 0) >= 1 && (mealName === "Обед" || mealName === "Ужин")) {
        let extra = 0;
        for (let d = dayNum + 1; d <= DAYS && extra < (cr.maxExtra || 1) && (d - dayNum) <= (cr.maxDays || 7); d++) {
          for (const fm of ["Обед", "Ужин"]) {
            const key = `${d}-${fm}`;
            if (!containerDishes[key]) { containerDishes[key] = { dish: bestDish, sourceDay: dayNum }; extra++; break; }
          }
        }
      }
    });

    plan.push({
      day_cycle: ((dayNum - 1) % 7) + 1,
      title: `${(dayMeals["Завтрак"] || {}).dish || "—"} + ${(dayMeals["Ужин"] || {}).dish || "—"} · ~${dayCost} ₽`,
      cost: dayCost,
      shopping_type: dayNum <= 7 ? "week1" : dayNum <= 14 ? "week2" : dayNum <= 21 ? "week3" : dayNum <= 28 ? "week4" : "topup",
      meals: dayMeals,
    });
    totalCost += dayCost;
  }

  // Generate actions
  const actions = {};
  for (let dayNum = 1; dayNum <= DAYS; dayNum++) {
    const dayActions = [];
    const meals = plan[dayNum - 1].meals;
    M_ORDER.forEach(mn => {
      const meal = meals[mn]; const r = RECIPES[meal.dish]; if (!r) return;
      const type = r.type || ""; const min = ACTIVE_MIN[meal.dish] || r.activeMinutes || 15;
      if (type.includes("Без готовки") || type.includes("Собрать без готовки") || type.includes("Быстрый перекус"))
        dayActions.push({ time: mn === "Чай" ? "21:00" : mn === "Полдник" ? "16:00" : "07:30", action: `Собрать: ${meal.dish}`, minutes: 2 });
      else if (type.includes("Разогреть"))
        dayActions.push({ time: mn === "Обед" ? "12:30" : "19:00", action: `Разогреть: ${meal.dish}`, minutes: 5 });
      else if (type.includes("Заморозка") || type.includes("Фарш"))
        dayActions.push({ time: mn === "Обед" ? "12:00" : "18:30", action: `Разогреть/собрать: ${meal.dish}`, minutes: 10 });
      else if (type.includes("Готовить утром") || mn === "Завтрак")
        dayActions.push({ time: "07:15", action: `Готовить: ${meal.dish}`, minutes: Math.min(min, 30) });
      else
        dayActions.push({ time: mn === "Обед" ? "12:00" : "18:30", action: `Готовить: ${meal.dish}`, minutes: Math.min(min, 45) });
    });
    actions[String(dayNum)] = dayActions;
  }

  // Build shopping baskets (reuse existing structure)
  const shopping = {};
  ["week1","week2","week3","week4","topup"].forEach(key => {
    const existing = DATA.shopping[key];
    shopping[key] = existing ? { ...existing } : { name: key === "topup" ? "Докупка" : `Неделя ${key.slice(-1)}`, budget: Math.round(BUDGET * (key === "topup" ? 0.08 : 0.23)) };
  });

  // Apply generated plan to runtime data
  DATA.plan = plan;
  DATA.shopping = shopping;
  DATA.planFamily = { adults: profile.adults, children: profile.children, units: profile.units, scale: FAMILY_SCALE, budget: BUDGET };
  Object.keys(ACTIONS).forEach(k => delete ACTIONS[k]); Object.assign(ACTIONS, actions);
  Object.keys(USED).forEach(k => delete USED[k]);
  plan.forEach((d, idx) => { USED[String(idx + 1)] = [...new Set(Object.values(d.meals).flatMap(m => (m.portion || "").split(/[+,.·/]/).map(x => x.trim()).filter(Boolean)))]; });

  // Normalize plan: set actual_day and shopping_type_actual
  const seenShop = new Set();
  DATA.plan.forEach((d, i) => {
    if (d.actual_day == null) d.actual_day = i + 1;
    if (!d.shopping_type_actual && d.shopping_type) {
      if (!seenShop.has(d.shopping_type)) { d.shopping_type_actual = d.shopping_type; seenShop.add(d.shopping_type); }
      else d.shopping_type_actual = "";
    }
  });

  // Reset progress
  const keys = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith("command_")) keys.push(k); }
  keys.forEach(k => localStorage.removeItem(k));

  // Reset family scale base so it recalculates
  _baseSaved = false; _basePkgForStore = null; _baseBasketsForStore = null;

  console.log(`Plan generated: seed=${seed}, ${usedInPlan.size} unique dishes, ${totalCost}₽ total`);
  return { plan, actions, totalCost, uniqueDishes: usedInPlan.size };
}

// ── Theme ──
function applyTheme() {
  document.documentElement.setAttribute("data-theme", state.dark ? "dark" : "light");
  const btn = document.getElementById("toggleTheme");
  if (btn) btn.textContent = state.dark ? "☾" : "☸";
}
function toggleTheme() {
  state.dark = !state.dark;
  localStorage.setItem("dark_theme", state.dark ? "1" : "0");
  applyTheme();
}
function toggleStoreMode() {
  document.body.classList.toggle("storeMode");
  const btn = document.getElementById("storeModeBtn");
  if (btn) btn.classList.toggle("active");
  if (document.body.classList.contains("storeMode")) { renderStoreMode(); }
  else { renderAll(); }
}
function renderStoreMode() {
  const container = document.getElementById("today");
  const shoppingDays = DATA.plan.reduce((acc, planDay) => { if (planDay.shopping_type_actual) acc[planDay.shopping_type_actual] = planDay.actual_day; return acc; }, {});
  let html = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h2 style="font-size:24px;font-weight:800">Список покупок</h2><button class="shareBtn" id="shareStoreBtn">Отправить</button></div>`;
  Object.entries(DATA.shopping || {}).forEach(([key, basket]) => {
    if (basket.itemBoxes?.length) {
      const dayNum = shoppingDays[key] || 1;
      html += `<div style="font-size:18px;font-weight:800;margin:18px 0 8px">${esc(basket.name)} ${basket.totalCostLabel || ""}</div>`;
      const groups = {};
      basket.itemBoxes.forEach((it, i) => { const sec = it.storeSection || "Другое"; if (!groups[sec]) groups[sec] = []; groups[sec].push({ it, i }); });
      Object.entries(groups).forEach(([sec, items]) => {
        html += `<div style="font-size:14px;font-weight:700;color:var(--ui-muted);margin:10px 0 4px;border-bottom:1px solid var(--ui-border);padding-bottom:2px">${esc(sec)}</div>`;
        items.forEach(({ it, i: idx }) => {
          html += `<div class="storeItem"><input class="check" type="checkbox" data-type="shop" data-day="${dayNum}" data-index="${idx}" style="width:28px;height:28px;accent-color:var(--ui-blue)"><span style="font-size:18px">${esc(it.title)}${it.quantity > 1 ? ` ×${it.quantity}` : ""}</span></div>`;
        });
      });
    }
  });
  container.innerHTML = html;
  document.getElementById("shareStoreBtn").onclick = shareShoppingList;
  bind();
}

// ── Boot ──
async function bootFoodFlow() {
  // If bundle is available (file:// or offline), use it immediately — no fetch needed
  if (window.FoodFlowDataStore?.runtime) {
    window.FoodFlowRuntimeData = window.FoodFlowDataStore.runtime;
  } else {
    // HTTP mode: wait for fetch to complete
    try {
      const payload = window.FoodFlowDataStore ? await window.FoodFlowDataStore.ready : null;
      if (payload && payload.files) window.FoodFlowRuntimeData = window.FoodFlowDataStore.runtime;
    } catch (err) { console.warn("FoodFlow data hydration failed", err); }
  }
  if (!initRuntimeData()) {
    if (!showLoadError("Не удалось загрузить данные. Проверьте подключение и обновите страницу.")) {
      console.error("FoodFlow data load failed");
    }
    return;
  }
  validatePersistedState();
  applyTheme();
  rebuildDaySelect();
  state.day = clampDay(state.day);
  daySelect.value = state.day;
  applyFamilyScale();
  applyStorePrices();
  applyPlanReplacements();
  daySelect.onchange = e => changeDay(Number(e.target.value));
  timeInput.onchange = () => { setAutoNow(false); shouldAutoScroll = true; renderAll(); };
  document.getElementById("prevDay").onclick = () => changeDay(state.day - 1);
  document.getElementById("nextDay").onclick = () => changeDay(state.day + 1);
  document.getElementById("closeModal").onclick = closeModal;
  document.getElementById("modal").onclick = e => { if (e.target.id === "modal") closeModal(); };
  document.getElementById("editProfile").onclick = showOnboarding;
  document.getElementById("toggleTheme").onclick = toggleTheme;
  document.getElementById("storeModeBtn").onclick = toggleStoreMode;
  document.getElementById("openCatalog").onclick = () => openCatalog();
  document.getElementById("regeneratePlan").onclick = () => {
    if (!confirm("Сгенерировать новый план? Текущий прогресс будет сброшен.")) return;
    const seed = Date.now();
    // Save original base data before generation overwrites DISH_USAGE etc.
    const origBaseDU = _baseSaved ? JSON.parse(JSON.stringify(_baseDU)) : null;
    const origBasePurch = _baseSaved ? JSON.parse(JSON.stringify(_basePurch)) : null;
    const origBasePkg = _baseSaved ? JSON.parse(JSON.stringify(_basePkg)) : null;
    const origBaseCS = _baseSaved ? { ..._baseCS } : null;
    const origBaseBM = _baseSaved ? { ..._baseBM } : null;
    const origBaseLS = _baseSaved ? { ..._baseLS } : null;
    generateNewPlan(seed);
    // Restore original base so profile changes re-scale from un-scaled data
    if (origBaseDU) { _baseDU = origBaseDU; _basePurch = origBasePurch; _basePkg = origBasePkg; _baseCS = origBaseCS; _baseBM = origBaseBM; _baseLS = origBaseLS; _baseSaved = true; }
    else { _baseSaved = false; }
    _basePkgForStore = null; _baseBasketsForStore = null;
    applyFamilyScale(); applyStorePrices(); applyPlanReplacements();
    rebuildDaySelect(); state.day = 1; daySelect.value = 1;
    shouldAutoScroll = true; renderAll();
  };
  document.getElementById("resetProgress").onclick = () => {
    if (!confirm("Сбросить весь прогресс? Все отметки, пропуски и отложения будут очищены.")) return;
    const keys = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith("command_")) keys.push(k); }
    keys.forEach(k => localStorage.removeItem(k));
    shouldAutoScroll = true; renderAll();
  };
  document.addEventListener("keydown", e => { if (e.key === "Escape" && document.getElementById("modal").style.display === "block") closeModal(); });
  // Mobile swipe navigation
  let _touchStartX = 0;
  document.addEventListener("touchstart", e => { _touchStartX = e.changedTouches[0].screenX; }, { passive: true });
  document.addEventListener("touchend", e => {
    const endX = e.changedTouches[0].screenX;
    const dx = endX - _touchStartX;
    if (Math.abs(dx) > 60 && document.getElementById("modal").style.display !== "block") {
      if (dx < 0 && state.day < planLength()) changeDay(state.day + 1);
      else if (dx > 0 && state.day > 1) changeDay(state.day - 1);
    }
  }, { passive: true });
  window.addEventListener("online", updatePwaStatus);
  window.addEventListener("offline", updatePwaStatus);
  setInterval(() => { if (state.autoNow) { setTimeToNow(); renderAll(); } }, 60000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && state.autoNow) { setTimeToNow(); shouldAutoScroll = true; renderAll(); } });
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js")
        .then(reg => {
          reg.addEventListener("updatefound", () => {
            const worker = reg.installing;
            if (!worker) return;
            worker.addEventListener("statechange", () => {
              if (worker.state === "installed" && navigator.serviceWorker.controller) {
                const el = document.getElementById("pwaStatus");
                if (el) el.textContent = "Есть обновление";
                showToast("Новая версия готова", {
                  text: "Обновить сейчас",
                  onClick: () => { worker.postMessage({ action: "skipWaiting" }); }
                });
                let _reloadOnce = false;
                navigator.serviceWorker.addEventListener("controllerchange", () => {
                  if (_reloadOnce) return; _reloadOnce = true; window.location.reload();
                });
              }
            });
          });
        })
        .catch(err => console.warn("FoodFlow SW registration failed", err));
    });
  }
  updatePwaStatus();
  requestNotifPermission();
  scheduleNotifs();
  if (state.autoNow) setTimeToNow();
  const overlay = document.getElementById("loadingOverlay");
  if (overlay) { overlay.style.opacity = "0"; setTimeout(() => overlay.remove(), 350); }
  if (localStorage.getItem("foodflow_onboarded") !== "1" && localStorage.getItem("foodflow_onboarded_snoozed") !== "1") { renderOnboarding(); } else { renderAll(); }
}
bootFoodFlow();
