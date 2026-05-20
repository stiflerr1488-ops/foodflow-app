(function () {
  const DATA_VERSION = 13;
  const STORAGE_KEY = "foodflow_offline_data_v3";

  function getProfileId() {
    const adults = Number(localStorage.getItem("family_adults") || 1);
    const children = Number(localStorage.getItem("family_children") || 0);
    return `a${adults}_c${children}`;
  }

  // ── Build runtime data from bundle object ──
  function buildRuntimeFromBundle(bundle) {
    const products = bundle.products || {};
    const recipes = bundle.recipes || {};
    const budget = bundle.budget || {};
    const profiles = bundle.profiles || {};
    const storePrices = bundle.storePrices || {};

    const profileId = getProfileId();
    const profilePlan = bundle.profilePlans?.[`plan_${profileId}`] || null;
    const profileInv = bundle.profilePlans?.[`inv_${profileId}`] || null;
    const defaultPlan = bundle.defaultPlan || {};
    const defaultRules = bundle.defaultRules || {};

    const plans = profilePlan || defaultPlan;
    const invFam = profileInv?.familyInfo || defaultRules.familyInfo || {};
    const planFam = plans.family || {};
    const mergedFamilyInfo = {
      adults: invFam.adults ?? planFam.adults ?? 1,
      children: invFam.children ?? planFam.children ?? 0,
      units: invFam.units ?? planFam.units ?? 1,
      scale: invFam.scale ?? planFam.scale ?? 1,
      budget: invFam.budget ?? planFam.budget ?? 20000,
    };
    const rules = profileInv ? {
      purchases: profileInv.purchases || defaultRules.purchases || [],
      packageOrders: profileInv.packageOrders || defaultRules.packageOrders || {},
      dishUsage: profileInv.dishUsage || defaultRules.dishUsage || {},
      shelfLifeDays: profileInv.shelfLifeDays || defaultRules.shelfLifeDays || {},
      containerSlots: profileInv.containerSlots || defaultRules.containerSlots || { fridge: 6, freezer: 12 },
      containerRules: defaultRules.containerRules || {},
      activeMinutes: defaultRules.activeMinutes || {},
      macroByItem: defaultRules.macroByItem || {},
      lowStockLimits: defaultRules.lowStockLimits || {},
      budget: defaultRules.budget || {},
      familyInfo: mergedFamilyInfo,
    } : defaultRules;

    const INVENTORY_ITEMS = bundle.INVENTORY_ITEMS || {};
    const BUDGET_META = {
      limit: rules.familyInfo?.budget || rules.budget?.limit || 20000,
      targetPerDay: rules.budget?.targetPerDay || Math.round((rules.familyInfo?.budget || 20000) / 30),
      note: rules.budget?.note || ""
    };
    const PRICES = {};
    Object.entries(products).forEach(([id, p]) => {
      if (p.pricePerUnit != null) PRICES[id] = p.pricePerUnit;
    });

    return {
      DATA: {
        plan: plans.plan || [],
        shopping: plans.shopping || {},
        planFamily: plans.family || rules.familyInfo || { adults: 1, children: 0, units: 1, scale: 1, budget: 20000 }
      },
      RECIPES: recipes,
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
      PRODUCTS: products,
      PRICES,
      STORE_PRICES: storePrices,
      STORE_SECTIONS: bundle.storeSections || [],
      MEAL_ORDER: bundle.mealOrder || ["Завтрак","Обед","Полдник","Ужин","Чай"]
    };
  }

  // ── Build runtime data from fetched files (same as before) ──
  function fileKey(file) {
    return file.replace(/^data\//, "").replace(/\.json$/, "").replace(/-/g, "_");
  }
  async function loadJson(file) {
    try {
      const response = await fetch(file, { cache: "force-cache" });
      if (response.ok) return response.json();
    } catch (_) {}
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", file, true);
      xhr.responseType = "json";
      xhr.onload = () => {
        if (xhr.status === 0 || (xhr.status >= 200 && xhr.status < 300)) resolve(xhr.response);
        else reject(new Error(`Cannot load ${file}: ${xhr.status}`));
      };
      xhr.onerror = () => reject(new Error(`Cannot load ${file}`));
      xhr.send();
    });
  }
  const BASE_DATA_FILES = [
    "data/products.json","data/recipes.json","data/budget-tiers.json",
    "data/family-profiles.json","data/store-prices.json"
  ];
  function getDataFiles(profileId) {
    const pid = profileId || getProfileId();
    return [...BASE_DATA_FILES, `data/plans/plan_${pid}.json`, `data/plans/inv_${pid}.json`, "data/plans.json", "data/inventory-rules.json"];
  }
  function buildRuntimeFromFiles(files) {
    const products = files.products?.products || {};
    const recipes = files.recipes?.recipes || {};
    const budget = files.budget_tiers || {};
    const profiles = files.family_profiles || {};
    const storePrices = files.store_prices || {};
    const profileId = getProfileId();
    const profilePlan = files[`plans_plan_${profileId}`] || null;
    const profileInv = files[`plans_inv_${profileId}`] || null;
    const defaultPlan = files.plans || {};
    const defaultRules = files.inventory_rules || {};
    const plans = profilePlan || defaultPlan;
    const invFam = profileInv?.familyInfo || defaultRules.familyInfo || {};
    const planFam = plans.family || {};
    const mergedFamilyInfo = {
      adults: invFam.adults ?? planFam.adults ?? 1,
      children: invFam.children ?? planFam.children ?? 0,
      units: invFam.units ?? planFam.units ?? 1,
      scale: invFam.scale ?? planFam.scale ?? 1,
      budget: invFam.budget ?? planFam.budget ?? 20000,
    };
    const rules = profileInv ? {
      purchases: profileInv.purchases || defaultRules.purchases || [],
      packageOrders: profileInv.packageOrders || defaultRules.packageOrders || {},
      dishUsage: profileInv.dishUsage || defaultRules.dishUsage || {},
      shelfLifeDays: profileInv.shelfLifeDays || defaultRules.shelfLifeDays || {},
      containerSlots: profileInv.containerSlots || defaultRules.containerSlots || { fridge: 6, freezer: 12 },
      containerRules: defaultRules.containerRules || {},
      activeMinutes: defaultRules.activeMinutes || {},
      macroByItem: defaultRules.macroByItem || {},
      lowStockLimits: defaultRules.lowStockLimits || {},
      budget: defaultRules.budget || {},
      familyInfo: mergedFamilyInfo,
    } : defaultRules;
    const INVENTORY_ITEMS = {};
    Object.entries(products).forEach(([id, p]) => { INVENTORY_ITEMS[id] = [p.name, p.unit, p.storage]; });
    const BUDGET_META = {
      limit: rules.familyInfo?.budget || rules.budget?.limit || 20000,
      targetPerDay: rules.budget?.targetPerDay || Math.round((rules.familyInfo?.budget || 20000) / 30),
      note: rules.budget?.note || ""
    };
    const PRICES = {};
    Object.entries(products).forEach(([id, p]) => { if (p.pricePerUnit != null) PRICES[id] = p.pricePerUnit; });
    return {
      DATA: { plan: plans.plan || [], shopping: plans.shopping || {}, planFamily: plans.family || rules.familyInfo || { adults: 1, children: 0, units: 1, scale: 1, budget: 20000 } },
      RECIPES: recipes,
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
      BUDGET_META, BUDGET_TIERS: budget, FAMILY_PROFILES: profiles,
      PRODUCTS: products, PRICES, STORE_PRICES: storePrices,
      STORE_SECTIONS: products.storeSections || [],
      MEAL_ORDER: ["Завтрак","Обед","Полдник","Ужин","Чай"]
    };
  }

  async function loadAll() {
    const profileId = getProfileId();
    const files = getDataFiles(profileId);
    const entries = await Promise.all(files.map(async file => {
      try { return [fileKey(file), await loadJson(file)]; }
      catch (_) { return [fileKey(file), null]; }
    }));
    const payload = { version: DATA_VERSION, loadedAt: new Date().toISOString(), profileId, files: Object.fromEntries(entries.filter(([_, v]) => v !== null)) };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(payload)); } catch (_) {}
    return payload;
  }
  function loadCached() {
    try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : null; } catch (_) { return null; }
  }

  let _runtime = null;

  // ── Priority: inline bundle > cached > fetch ──
  function getRuntimeData() {
    if (_runtime) return _runtime;
    // 1. Inline bundle (works on file://)
    if (window.FoodFlowBundle) {
      _runtime = buildRuntimeFromBundle(window.FoodFlowBundle);
      return _runtime;
    }
    // 2. Cached in localStorage
    const cached = loadCached();
    if (cached && cached.version === DATA_VERSION && cached.files) {
      _runtime = buildRuntimeFromFiles(cached.files);
      return _runtime;
    }
    return null;
  }

  window.FoodFlowDataStore = {
    files: BASE_DATA_FILES.slice(),
    get cached() { return loadCached(); },
    get runtime() { return getRuntimeData(); },
    get profileId() { return getProfileId(); },
    refresh: async () => {
      _runtime = null;
      try { const p = await loadAll(); _runtime = buildRuntimeFromFiles(p.files); return p; }
      catch (e) {
        if (window.FoodFlowBundle) { _runtime = buildRuntimeFromBundle(window.FoodFlowBundle); return { fromBundle: true }; }
        throw e;
      }
    },
    ready: loadAll().then(p => { _runtime = buildRuntimeFromFiles(p.files); return p; }).catch(() => {
      // fetch failed — use bundle or cache
      const r = getRuntimeData();
      if (r) { _runtime = r; return { fromFallback: true }; }
      return null;
    })
  };
})();
