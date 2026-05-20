const fs = require('fs');
const path = require('path');

function readJSON(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'data', name), 'utf8'));
}

function writeJSON(name, data) {
  fs.writeFileSync(path.join(__dirname, 'data', name), JSON.stringify(data, null, 2) + '\n', 'utf8');
}

const plans = readJSON('plans.json');
const inventory = readJSON('inventory-rules.json');
const recipes = readJSON('recipes.json');
const products = readJSON('products.json');

const PRODUCT_ALIASES = [
  ['tomato_paste_g', ['томатн']],
  ['oats_g', ['овсян']],
  ['rice_g', ['рис']],
  ['buckwheat_g', ['греч']],
  ['pasta_g', ['макарон', 'лапш']],
  ['beans_cans', ['фасол']],
  ['peanuts_g', ['арахис']],
  ['flour_g', ['мука', 'мук']],
  ['sushki_g', ['сушк']],
  ['potatoes_g', ['картоф']],
  ['frozenveg_g', ['овощная смесь', 'замороженные овощ', 'овощи заморож']],
  ['cabbage_g', ['капуст']],
  ['cucumber_g', ['огур']],
  ['roots_g', ['морков', 'свекл', 'свёкл', 'корень']],
  ['onion_g', ['лук']],
  ['apples_g', ['яблок']],
  ['bananas_pcs', ['банан']],
  ['eggs_pcs', ['яйц', 'яичн']],
  ['milk_ml', ['молок']],
  ['kefir_ml', ['кефир']],
  ['tvorog_g', ['творог']],
  ['bread_g', ['хлеб', 'тост', 'ломтик']],
  ['smetana_g', ['сметан']],
  ['lavash_pcs', ['лаваш']],
  ['chicken_g', ['куриц', 'курин', 'бедр']],
  ['fishsticks_g', ['рыбные палоч']],
  ['fish_g', ['минтай', 'хек', 'рыб']],
  ['cutlets_g', ['котлет']],
  ['nuggets_g', ['наггетс']],
  ['pelmeni_g', ['пельмен']],
  ['vareniki_g', ['вареник']],
  ['tefteli_g', ['тефтел']],
  ['mince_g', ['фарш']],
  ['oil_g', ['масло']],
  ['tea_g', ['чай']],
  ['sugar_g', ['сахар']],
  ['cheese_g', ['сыр']],
  ['butter_g', ['сливочн']],
  ['sausage_g', ['сосиск', 'колбас']],
  ['garlic_g', ['чеснок']],
  ['mushrooms_g', ['шампиньон', 'гриб']],
  ['honey_g', ['мёд', 'мед']],
  ['jam_g', ['варень', 'джем']],
  ['cookies_g', ['печень']],
  ['coffee_g', ['кофе']],
  ['mayo_g', ['майонез']],
  ['ketchup_g', ['кетчуп']],
  ['soysauce_ml', ['соевый соус', 'соевым соусом']],
  ['peas_cans', ['горошек']],
  ['corn_cans', ['кукуруз']],
  ['herring_g', ['сельд', 'селёдк']],
  ['liver_g', ['печён', 'печен']],
  ['raisins_g', ['изюм']],
  ['cream_ml', ['сливк']],
  ['tomato_g', ['помидор']],
  ['pepper_g', ['перец', 'болгарск']],
  ['herbs_g', ['зелень', 'укроп', 'петрушк']],
  ['lemon_pcs', ['лимон']],
  ['beet_g', ['свёкл', 'свекл']],
  ['pork_g', ['свинин', 'свинь']],
  ['beef_g', ['говядин', 'говяжь']],
  ['turkey_g', ['индейк']],
  ['stew_cans', ['тушёнк', 'тушенк']],
  ['salmon_cans', ['горбуш']],
  ['sprat_cans', ['кильк', 'шпрот']],
  ['saury_cans', ['сайр']],
  ['salt_g', ['соль']],
  ['baking_g', ['сод', 'разрыхлител']],
  ['noodle_g', ['доширак', 'лапша быстр']],
  ['chips_g', ['чипс', 'снек']],
  ['pancakes_g', ['блинчик']],
  ['berries_g', ['ягод']],
  ['chocolate_g', ['шоколад']],
  ['candy_g', ['конфет']],
  ['zephyr_g', ['зефир', 'пастил']],
  ['juice_ml', ['сок']],
  ['mors_ml', ['морс', 'компот']]
];

const DEFAULT_AMOUNTS = {
  oats_g: 70,
  rice_g: 80,
  buckwheat_g: 80,
  pasta_g: 90,
  beans_cans: 1,
  peanuts_g: 20,
  flour_g: 25,
  tomato_paste_g: 20,
  sushki_g: 30,
  potatoes_g: 250,
  cabbage_g: 150,
  roots_g: 80,
  apples_g: 150,
  bananas_pcs: 1,
  eggs_pcs: 1,
  milk_ml: 150,
  kefir_ml: 250,
  tvorog_g: 180,
  bread_g: 40,
  smetana_g: 30,
  lavash_pcs: 1,
  chicken_g: 160,
  fish_g: 180,
  cutlets_g: 160,
  nuggets_g: 160,
  fishsticks_g: 160,
  pelmeni_g: 230,
  vareniki_g: 250,
  tefteli_g: 180,
  mince_g: 150,
  frozenveg_g: 150,
  oil_g: 10,
  tea_g: 2,
  sugar_g: 10,
  cheese_g: 30,
  onion_g: 50,
  butter_g: 10,
  sausage_g: 100,
  garlic_g: 3,
  mushrooms_g: 100,
  cucumber_g: 100,
  honey_g: 15,
  jam_g: 20,
  cookies_g: 30,
  coffee_g: 5,
  mayo_g: 20,
  ketchup_g: 20,
  soysauce_ml: 15,
  peas_cans: 0.5,
  corn_cans: 0.5,
  herring_g: 100,
  liver_g: 150,
  raisins_g: 20,
  cream_ml: 50,
  tomato_g: 100,
  pepper_g: 80,
  herbs_g: 10,
  lemon_pcs: 0.5,
  beet_g: 100,
  pork_g: 150,
  beef_g: 150,
  turkey_g: 150,
  stew_cans: 1,
  salmon_cans: 1,
  sprat_cans: 1,
  saury_cans: 1,
  salt_g: 3,
  baking_g: 5,
  noodle_g: 80,
  chips_g: 30,
  pancakes_g: 200,
  berries_g: 50,
  chocolate_g: 30,
  candy_g: 30,
  zephyr_g: 30,
  juice_ml: 200,
  mors_ml: 200
};

const PIECE_WEIGHTS = {
  potatoes_g: 120,
  cabbage_g: 120,
  roots_g: 80,
  apples_g: 150,
  bread_g: 25,
  fish_g: 180,
  chicken_g: 160,
  cutlets_g: 80,
  fishsticks_g: 35
};

const BAD_NAME_PATTERNS = [
  /[A-Za-z]{3,}/,
  /(^|[\s("'—-])(витх|анд|кх)|схримп|бутербродes|фасолевоеs|перецs|гороховоес/i,
  /арепа|пелуа|эмпанадас|тахини|харисс|сриракх|херб/i,
  /жареный\s+(рыба|творог|яйца|пельмени)/i,
  /тушеный\s+(рыба|творог|яйца|пельмени)/i,
  /\sс\s+(кефир|сметана)\s+и\s+/i
];

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/[“”]/g, '"');
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function moneyLabel(value) {
  return `~${Math.round(Number(value) || 0)} ₽`;
}

function parseNumber(value) {
  const text = String(value || '').replace(/\s+/g, '').replace(',', '.');
  if (text.includes('/')) {
    const [a, b] = text.split('/').map(Number);
    return b ? a / b : 0;
  }
  return Number(text) || 0;
}

function averageRange(first, second) {
  const a = parseNumber(first);
  const b = second ? parseNumber(second) : 0;
  return b ? (a + b) / 2 : a;
}

function productPrice(productId) {
  return Number(products.products[productId]?.pricePerUnit || 0);
}

function productCost(productId, amount) {
  return roundMoney(productPrice(productId) * (Number(amount) || 0));
}

function formatAmount(amount, unit) {
  const value = Number(amount) || 0;
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? String(rounded) : String(rounded).replace('.', ',')} ${unit || ''}`.trim();
}

function productAmountLabel(productId, amount) {
  return formatAmount(amount, products.products[productId]?.unit || '');
}

function productMacros(productId, amount) {
  const macro = products.products[productId]?.macroPerUnit || {};
  const qty = Number(amount) || 0;
  const p = roundMoney((Number(macro.p) || 0) * qty);
  const f = roundMoney((Number(macro.f) || 0) * qty);
  const c = roundMoney((Number(macro.c) || 0) * qty);
  return { p, f, c, kcal: Math.round(p * 4 + f * 9 + c * 4) };
}

function estimateRecipeMacros(usage) {
  return Object.entries(usage || {}).reduce((sum, [productId, amount]) => {
    const item = productMacros(productId, amount);
    sum.p = roundMoney(sum.p + item.p);
    sum.f = roundMoney(sum.f + item.f);
    sum.c = roundMoney(sum.c + item.c);
    sum.kcal += item.kcal;
    return sum;
  }, { p: 0, f: 0, c: 0, kcal: 0 });
}

function estimateRecipeCost(usage) {
  return roundMoney(Object.entries(usage || {}).reduce((sum, [productId, amount]) => sum + productCost(productId, amount), 0));
}

function inferProductId(line) {
  const text = normalizeText(line);
  const found = PRODUCT_ALIASES.find(([, aliases]) => aliases.some(alias => text.includes(alias)));
  return found ? found[0] : null;
}

function extractAmount(line, productId) {
  const product = products.products[productId] || {};
  const productUnit = product.unit || '';
  const text = normalizeText(line);
  const unitMatch = text.match(/(\d+(?:[,.]\d+)?|\d+\s*\/\s*\d+)\s*(?:[-–—]\s*(\d+(?:[,.]\d+)?|\d+\s*\/\s*\d+))?\s*(кг|г|мл|л|шт|штук|штуки|бан\.?|банка|банки|ст\.?\s*л\.?|ч\.?\s*л\.?)/i);
  if (unitMatch) {
    const amount = averageRange(unitMatch[1], unitMatch[2]);
    const unit = unitMatch[3].replace(/\s+/g, '');
    if (productUnit === 'г') {
      if (unit === 'кг') return amount * 1000;
      if (unit === 'г') return amount;
      if (unit.startsWith('ст.')) return amount * 20;
      if (unit.startsWith('ч.')) return amount * 5;
      if (unit.startsWith('шт')) return amount * (PIECE_WEIGHTS[productId] || DEFAULT_AMOUNTS[productId] || 100);
      if (unit.startsWith('бан')) return amount * (DEFAULT_AMOUNTS[productId] || 1);
    }
    if (productUnit === 'мл') {
      if (unit === 'л') return amount * 1000;
      if (unit === 'мл') return amount;
      if (unit.startsWith('ст.')) return amount * 15;
      if (unit.startsWith('ч.')) return amount * 5;
    }
    if (productUnit === 'шт') return amount;
    if (productUnit === 'бан.') return amount;
  }
  const genericNumber = text.match(/(\d+(?:[,.]\d+)?|\d+\s*\/\s*\d+)/);
  if ((productUnit === 'шт' || productUnit === 'бан.') && genericNumber) return parseNumber(genericNumber[1]);
  if (text.includes('половин') && productUnit === 'шт') return 0.5;
  return DEFAULT_AMOUNTS[productId] || 0;
}

function inferUsageFromIngredients(ingredients) {
  return (ingredients || []).reduce((usage, line) => {
    const text = normalizeText(line);
    const productId = inferProductId(text);
    if (!productId) return usage;
    if (text.includes('по желанию') && !text.match(/\d/)) return usage;
    const amount = extractAmount(text, productId);
    if (!amount) return usage;
    usage[productId] = roundMoney((usage[productId] || 0) + amount);
    return usage;
  }, {});
}

function inferActiveMinutes(recipe) {
  if (recipe.activeMinutes != null) return recipe.activeMinutes;
  const time = String(recipe.time || '');
  const match = time.match(/(\d+)(?:\s*[-–—]\s*(\d+))?/);
  if (!match) return null;
  const minutes = averageRange(match[1], match[2]);
  if (normalizeText(recipe.type).includes('без готовки')) return Math.max(1, Math.min(5, Math.round(minutes)));
  return Math.max(1, Math.round(minutes * 0.65));
}

function buildUsageBoxes(usage) {
  return Object.entries(usage || {}).map(([productId, amount], index) => {
    const product = products.products[productId] || {};
    const cost = productCost(productId, amount);
    return {
      id: `${productId}-${index + 1}`,
      productId,
      title: product.name || productId,
      amount,
      unit: product.unit || '',
      amountLabel: productAmountLabel(productId, amount),
      storage: product.storage || '',
      pricePerUnit: product.pricePerUnit ?? null,
      priceLabel: moneyLabel(cost),
      cost,
      macros: productMacros(productId, amount)
    };
  });
}

function buildIngredientBoxes(usage, ingredients) {
  if (!ingredients || !ingredients.length) return buildUsageBoxes(usage);
  return ingredients.map((line, index) => {
    const productId = inferProductId(line);
    const product = productId ? products.products[productId] || {} : {};
    const amount = productId ? (extractAmount(line, productId) || usage?.[productId] || 0) : 0;
    const cost = productId ? productCost(productId, amount) : 0;
    return {
      id: `${productId || 'ingredient'}-${index + 1}`,
      productId,
      title: product.name || String(line || ''),
      raw: String(line || ''),
      amount,
      unit: product.unit || '',
      amountLabel: amount ? productAmountLabel(productId, amount) : '',
      storage: product.storage || '',
      pricePerUnit: product.pricePerUnit ?? null,
      priceLabel: productId ? moneyLabel(cost) : '',
      cost,
      macros: productId ? productMacros(productId, amount) : { p: 0, f: 0, c: 0, kcal: 0 },
      status: productId ? 'mapped' : 'unmapped'
    };
  });
}

function buildProductBox(productId, product) {
  return {
    id: productId,
    title: product.name,
    unit: product.unit,
    storage: product.storage,
    shelfLifeDays: product.shelfLifeDays,
    lowStockLimit: product.lowStockLimit,
    pricePerUnit: product.pricePerUnit,
    priceLabel: `${product.pricePerUnit} ₽/${product.unit}`,
    macroPerUnit: product.macroPerUnit || null
  };
}

function recipeQuality(name, recipe, usage, cost, macros) {
  const issues = [];
  const sourceKind = recipe.source?.kind || '';
  if (!usage || !Object.keys(usage).length) issues.push('no_usage');
  if (!recipe.ingredients || !recipe.ingredients.length) issues.push('no_ingredients');
  if (!recipe.steps || !recipe.steps.length) issues.push('no_steps');
  if (Object.keys(usage || {}).some(productId => !products.products[productId])) issues.push('unknown_product');
  if (BAD_NAME_PATTERNS.some(pattern => pattern.test(name))) issues.push('bad_name');
  if (sourceKind === 'generated') issues.push('generated_variation');
  if (cost > 650) issues.push('high_cost');
  if (cost > 0 && cost < 20) issues.push('low_cost');
  if (macros.kcal > 1500) issues.push('high_kcal');
  if (macros.kcal > 0 && macros.kcal < 50) issues.push('low_kcal');
  const score = Math.max(0, 100 - issues.reduce((sum, issue) => sum + ({
    no_usage: 35,
    no_ingredients: 25,
    no_steps: 25,
    unknown_product: 35,
    bad_name: 35,
    generated_variation: 20,
    high_cost: 15,
    low_cost: 10,
    high_kcal: 15,
    low_kcal: 10
  }[issue] || 5), 0));
  const blocking = ['no_usage', 'no_ingredients', 'no_steps', 'unknown_product', 'bad_name', 'generated_variation'];
  const usable = !issues.some(issue => blocking.includes(issue));
  return {
    score,
    level: usable ? (score >= 85 ? 'good' : 'review') : 'blocked',
    usable,
    issues,
    sourceKind
  };
}

function buildRecipeBox(name, recipe, quality, cost, macros) {
  return {
    id: name,
    title: recipe.title || name,
    type: recipe.type || '',
    time: recipe.time || '',
    store: recipe.store || '',
    ingredientCount: Object.keys(recipe.usage || {}).length,
    stepCount: (recipe.steps || []).length,
    activeMinutes: recipe.activeMinutes,
    cost,
    costLabel: moneyLabel(cost),
    kcal: macros.kcal,
    macros,
    quality
  };
}

function buildPackageBox(key, item, index) {
  const [label, productId, packageSize, quantity] = item;
  const product = products.products[productId] || {};
  const totalAmount = Number(packageSize || 0) * Number(quantity || 0);
  // Use real pack price from product data (Пятёрочка/Магнит)
  const packPrice = product.packPrice || productCost(productId, packageSize);
  const totalPrice = roundMoney(packPrice * Number(quantity || 0));
  return {
    id: `${key}-${index + 1}-${productId}`,
    title: label,
    productId,
    productName: product.name || productId,
    packageSize,
    packageSizeLabel: product.packLabel || productAmountLabel(productId, packageSize),
    quantity,
    totalAmount,
    totalAmountLabel: productAmountLabel(productId, totalAmount),
    unit: product.unit || '',
    storage: product.storage || '',
    storeSection: product.storeSection || '',
    packagePrice: packPrice,
    totalPrice,
    priceLabel: moneyLabel(totalPrice)
  };
}

// 1. Build USED from portions
const used = {};
plans.plan.forEach((d, idx) => {
  const dayNum = idx + 1;
  used[String(dayNum)] = Array.from(new Set(
    Object.values(d.meals).flatMap(meal => 
      meal.portion.toLowerCase().split(/[+,.·/]/).map(x => x.trim()).filter(Boolean)
    )
  ));
});

// 2. Add used to plans.json
plans.used = used;
plans.version = 2;
plans.generatedFrom = "build-data.js";

// 3. Ensure all recipes have usage and activeMinutes
Object.entries(recipes.recipes).forEach(([name, r]) => {
  if (!r.usage && inventory.dishUsage[name]) {
    r.usage = inventory.dishUsage[name];
  }
  if (!r.activeMinutes && inventory.activeMinutes[name] != null) {
    r.activeMinutes = inventory.activeMinutes[name];
  }
});

// 4. Add missing recipes from app.js (new dishes)
const appRecipes = {
  "Шакшука бюджетная": {
    "title": "Шакшука бюджетная",
    "source": { "kind": "internal_seed", "url": null, "note": "Seed recipe" },
    "type": "Готовить свежим",
    "time": "18 минут",
    "store": "Не хранить",
    "ingredients": ["яйца - 2 шт", "лук - 1/2 шт", "морковь или замороженные овощи - 100 г", "томатная паста - 1 ст. л.", "вода - 80 мл", "хлеб - 1-2 ломтика"],
    "steps": ["Обжарить лук и овощи 4-5 минут.", "Добавить томатную пасту, воду, соль и специи.", "Потушить соус 3 минуты.", "Сделать два углубления и вбить яйца.", "Накрыть крышкой и готовить до схватывания белка.", "Подать с хлебом."],
    "notes": ["Если есть сладкий перец по акции - добавить, будет вкуснее."],
    "usage": inventory.dishUsage["Шакшука бюджетная"],
    "activeMinutes": 12,
    "containerRule": null
  },
  "Сырники на сковороде": {
    "title": "Сырники на сковороде",
    "source": { "kind": "internal_seed", "url": null, "note": "Seed recipe" },
    "type": "Готовить свежим",
    "time": "20 минут",
    "store": "Можно убрать 1 порцию на завтра",
    "ingredients": ["творог - 180-200 г", "яйцо - 1 шт", "мука - 20-30 г", "сахар по желанию", "масло - 1 ч. л."],
    "steps": ["Размять творог вилкой.", "Добавить яйцо и муку.", "Сформировать 4-5 сырников.", "Жарить на среднем огне по 3-4 минуты с каждой стороны.", "Если внутри сыровато, накрыть крышкой на 2 минуты."],
    "notes": ["Для бюджета не брать сырковую массу: она дороже и хуже по белку."],
    "usage": inventory.dishUsage["Сырники на сковороде"],
    "activeMinutes": 15,
    "containerRule": null
  },
  "Ленивый хачапури на твороге": {
    "title": "Ленивый хачапури на твороге",
    "source": { "kind": "internal_seed", "url": null, "note": "Seed recipe" },
    "type": "Готовить свежим",
    "time": "15 минут",
    "store": "Лучше есть сразу",
    "ingredients": ["творог - 150 г", "яйцо - 1 шт", "мука - 25-35 г или половина лаваша", "сыр - 20-30 г по желанию", "соль"],
    "steps": ["Смешать творог, яйцо, муку и соль.", "Если есть сыр, вмешать немного в тесто.", "Выложить лепешкой на сковороду.", "Жарить под крышкой 5-6 минут.", "Перевернуть и подрумянить вторую сторону."],
    "notes": ["Сыр опционален: без него это все равно нормальная творожная лепешка."],
    "usage": inventory.dishUsage["Ленивый хачапури на твороге"],
    "activeMinutes": 12,
    "containerRule": null
  },
  "Картофельная сковорода с яйцом": {
    "title": "Картофельная сковорода с яйцом",
    "source": { "kind": "internal_seed", "url": null, "note": "Seed recipe" },
    "type": "Готовить свежим",
    "time": "25 минут",
    "store": "Остаток можно разогреть",
    "ingredients": ["картофель - 250-300 г", "яйца - 2 шт", "лук - 1/2 шт", "масло - 1 ч. л.", "соль, перец"],
    "steps": ["Нарезать картофель мелким кубиком.", "Обжарить с луком 8-10 минут.", "Добавить 3-4 ложки воды и накрыть крышкой до мягкости.", "Сделать углубления и вбить яйца.", "Довести яйца под крышкой."],
    "notes": ["Это бюджетная замена кафе-завтраку: сытно и дешево."],
    "usage": inventory.dishUsage["Картофельная сковорода с яйцом"],
    "activeMinutes": 16,
    "containerRule": null
  },
  "Драники с яйцом и кефирным соусом": {
    "title": "Драники с яйцом и кефирным соусом",
    "source": { "kind": "internal_seed", "url": null, "note": "Seed recipe" },
    "type": "Готовить свежим",
    "time": "25 минут",
    "store": "Лучше есть сразу",
    "ingredients": ["картофель - 300 г", "яйцо - 1 шт", "мука - 1 ст. л.", "кефир - 80 мл", "чеснок/соль по желанию"],
    "steps": ["Натереть картофель и слегка отжать.", "Смешать с яйцом, мукой и солью.", "Жарить небольшими оладьями по 3-4 минуты с каждой стороны.", "Смешать кефир с солью и чесноком для соуса."],
    "notes": ["Если не хочется тереть картошку, замени на картофельную сковороду."],
    "usage": inventory.dishUsage["Драники с яйцом и кефирным соусом"],
    "activeMinutes": 20,
    "containerRule": null
  },
  "Курица карри с рисом": {
    "title": "Курица карри с рисом",
    "source": { "kind": "internal_seed", "url": null, "note": "Seed recipe" },
    "type": "Готовить на 2 порции",
    "time": "35 минут",
    "store": "Холодильник до 3 дней",
    "ingredients": ["курица - 350-400 г", "рис - 180 г сухой", "лук - 1 шт", "морковь/овощная смесь - 200 г", "карри или паприка", "кефир/сметана - 2 ст. л. по желанию"],
    "steps": ["Поставить рис вариться.", "Обжарить лук, морковь и курицу.", "Добавить специи и немного воды.", "Потушить 10-12 минут.", "В конце вмешать ложку кефира или сметаны для соуса.", "Подать с рисом."],
    "notes": ["Карри можно заменить паприкой: смысл в соусе, а не в дорогих специях."],
    "usage": inventory.dishUsage["Курица карри с рисом"],
    "activeMinutes": 14,
    "containerRule": null
  },
  "Рыба в лаваше с капустой": {
    "title": "Рыба в лаваше с капустой",
    "source": { "kind": "internal_seed", "url": null, "note": "Seed recipe" },
    "type": "Быстро",
    "time": "20 минут",
    "store": "Собранный лаваш не хранить",
    "ingredients": ["минтай/хек - 180-220 г", "лаваш - 1 шт", "капуста - 150 г", "сметана/кефир - 1-2 ст. л.", "соль, специи"],
    "steps": ["Рыбу посолить и обжарить или потушить 10-12 минут.", "Капусту тонко нашинковать и помять с солью.", "Смешать сметану или кефир с перцем.", "Положить рыбу и капусту в лаваш.", "Свернуть и прогреть на сухой сковороде."],
    "notes": ["Работает и с рыбными палочками, если рыбы нет."],
    "usage": inventory.dishUsage["Рыба в лаваше с капустой"],
    "activeMinutes": 10,
    "containerRule": null
  },
  "Пельмени в бульоне по-азиатски": {
    "title": "Пельмени в бульоне по-азиатски",
    "source": { "kind": "internal_seed", "url": null, "note": "Seed recipe" },
    "type": "Заморозка",
    "time": "15 минут",
    "store": "Готовить свежими",
    "ingredients": ["пельмени - 220-250 г", "капуста - 100-150 г", "морковь - 50 г", "соевый соус по желанию", "чеснок/перец"],
    "steps": ["Вскипятить воду.", "Добавить тонко нарезанную капусту и морковь.", "Через 3 минуты добавить пельмени.", "Варить по инструкции пачки.", "Добавить перец, чеснок или немного соевого соуса.", "Подать как густой суп."],
    "notes": ["Так пельмени не ощущаются как просто пельмени из пачки."],
    "usage": inventory.dishUsage["Пельмени в бульоне по-азиатски"],
    "activeMinutes": 8,
    "containerRule": null
  },
  "Котлетный бургер-боул": {
    "title": "Котлетный бургер-боул",
    "source": { "kind": "internal_seed", "url": null, "note": "Seed recipe" },
    "type": "Заморозка + свежий салат",
    "time": "25 минут",
    "store": "Готовить свежим",
    "ingredients": ["котлеты - 2 шт", "картофель - 250-300 г", "капуста - 200 г", "огурец/лук по желанию", "сметана/кефир для соуса"],
    "steps": ["Картофель нарезать дольками и пожарить или запечь.", "Котлеты приготовить по инструкции.", "Капусту нашинковать и помять с солью.", "Сделать соус из сметаны или кефира.", "Нарезать котлеты и собрать все в миску."],
    "notes": ["Вкус ближе к бургеру, но дешевле и без булок каждый день."],
    "usage": inventory.dishUsage["Котлетный бургер-боул"],
    "activeMinutes": 12,
    "containerRule": null
  },
  "Вареники с жареным луком и капустой": {
    "title": "Вареники с жареным луком и капустой",
    "source": { "kind": "internal_seed", "url": null, "note": "Seed recipe" },
    "type": "Заморозка",
    "time": "18 минут",
    "store": "Готовить свежими",
    "ingredients": ["вареники - 250 г", "лук - 1/2 шт", "капуста - 150-200 г", "масло - 1 ч. л."],
    "steps": ["Отварить вареники по инструкции.", "Пока варятся, обжарить лук.", "Капусту тонко нашинковать и помять с солью.", "Смешать вареники с жареным луком.", "Подать с капустой."],
    "notes": ["Жареный лук сильно улучшает дешевые вареники."],
    "usage": inventory.dishUsage["Вареники с жареным луком и капустой"],
    "activeMinutes": 9,
    "containerRule": null
  },
  "Вареники с жареным луком": {
    "title": "Вареники с жареным луком",
    "source": { "kind": "internal_seed", "url": null, "note": "Seed recipe" },
    "type": "Заморозка",
    "time": "15 минут",
    "store": "Готовить свежими",
    "ingredients": ["вареники - 250 г", "лук - 1 шт", "сметана по желанию"],
    "steps": ["Отварить вареники.", "Лук нарезать и обжарить до золотистости.", "Перемешать вареники с луком.", "Добавить ложку сметаны, если входит в бюджет."],
    "notes": [],
    "usage": inventory.dishUsage["Вареники с жареным луком"],
    "activeMinutes": 9,
    "containerRule": null
  },
  "Наггетсы в лаваше": {
    "title": "Наггетсы в лаваше",
    "source": { "kind": "internal_seed", "url": null, "note": "Seed recipe" },
    "type": "Заморозка",
    "time": "18 минут",
    "store": "Собранный лаваш не хранить",
    "ingredients": ["наггетсы - 160-180 г", "лаваш - 1 шт", "капуста - 150 г", "кефир/сметана - 1-2 ст. л.", "томатная паста по желанию"],
    "steps": ["Наггетсы приготовить по инструкции.", "Капусту нашинковать.", "Смешать быстрый соус из кефира и томатной пасты.", "Собрать ролл в лаваше.", "Подрумянить на сухой сковороде."],
    "notes": ["Это замена фастфуду, но контролируемая по цене."],
    "usage": inventory.dishUsage["Наггетсы в лаваше"],
    "activeMinutes": 9,
    "containerRule": null
  },
  "Рыбные палочки с макаронами в томатном соусе": {
    "title": "Рыбные палочки с макаронами в томатном соусе",
    "source": { "kind": "internal_seed", "url": null, "note": "Seed recipe" },
    "type": "Заморозка + паста",
    "time": "25 минут",
    "store": "Лучше свежим",
    "ingredients": ["рыбные палочки - 160-180 г", "макароны - 90 г сухие", "томатная паста - 1 ст. л.", "лук - 1/2 шт"],
    "steps": ["Отварить макароны.", "Рыбные палочки приготовить по инструкции.", "Лук прогреть с томатной пастой и 4-5 ложками воды.", "Смешать макароны с соусом.", "Подать с рыбными палочками."],
    "notes": [],
    "usage": inventory.dishUsage["Рыбные палочки с макаронами в томатном соусе"],
    "activeMinutes": 10,
    "containerRule": null
  },
  "Пельмени, запеченные в сметане": {
    "title": "Пельмени, запеченные в сметане",
    "source": { "kind": "internal_seed", "url": null, "note": "Seed recipe" },
    "type": "Заморозка",
    "time": "25 минут",
    "store": "Лучше свежими",
    "ingredients": ["пельмени - 220-250 г", "сметана - 2 ст. л.", "вода - 80 мл", "капуста - 150 г", "сыр 20 г по желанию"],
    "steps": ["Пельмени быстро отварить 3-4 минуты до полуготовности.", "Смешать сметану с водой, солью и перцем.", "Выложить пельмени в форму или сковороду.", "Залить соусом и прогреть под крышкой 10 минут или запечь.", "Подать с капустой."],
    "notes": ["Сыр не обязателен: он вкусный, но легко ломает бюджет."],
    "usage": inventory.dishUsage["Пельмени, запеченные в сметане"],
    "activeMinutes": 10,
    "containerRule": null
  },
  "Чили из фасоли с рисом": {
    "title": "Чили из фасоли с рисом",
    "source": { "kind": "internal_seed", "url": null, "note": "Seed recipe" },
    "type": "Быстро",
    "time": "25 минут",
    "store": "Холодильник до 3 дней",
    "ingredients": ["фасоль консервированная - 1 банка", "рис - 80-90 г сухой", "лук - 1/2 шт", "морковь/капуста - 150 г", "томатная паста - 1 ст. л.", "паприка/перец"],
    "steps": ["Поставить рис вариться.", "Обжарить лук и овощи.", "Добавить фасоль и томатную пасту.", "Влить немного воды и потушить 8-10 минут.", "Подать фасоль поверх риса."],
    "notes": ["Острое делать по вкусу. Фасоль дает белок без мяса."],
    "usage": inventory.dishUsage["Чили из фасоли с рисом"],
    "activeMinutes": 12,
    "containerRule": null
  },
  "Лаваш-пицца с котлетой и капустой": {
    "title": "Лаваш-пицца с котлетой и капустой",
    "source": { "kind": "internal_seed", "url": null, "note": "Seed recipe" },
    "type": "Быстро",
    "time": "15 минут",
    "store": "Не хранить",
    "ingredients": ["лаваш - 1 шт", "готовая котлета - 1 шт", "томатная паста - 1 ч. л.", "капуста - 100 г", "сыр 20 г по желанию"],
    "steps": ["Смазать лаваш томатной пастой с водой.", "Нарезать котлету тонкими кусками.", "Добавить капусту и немного сыра, если есть.", "Сложить пополам или свернуть.", "Прогреть на сухой сковороде до хруста."],
    "notes": ["Это способ не есть котлеты одинаково два дня подряд."],
    "usage": inventory.dishUsage["Лаваш-пицца с котлетой и капустой"],
    "activeMinutes": 8,
    "containerRule": null
  },
  "Тефтельный суп": {
    "title": "Тефтельный суп",
    "source": { "kind": "internal_seed", "url": null, "note": "Seed recipe" },
    "type": "Готовить на 2 порции",
    "time": "35 минут",
    "store": "Холодильник до 3 дней",
    "ingredients": ["тефтели/фарш - 250-300 г", "картофель - 3 шт", "морковь - 1 шт", "лук - 1 шт", "рис/макароны - 40 г"],
    "steps": ["Вскипятить воду.", "Добавить картофель, морковь и лук.", "Через 10 минут добавить тефтели.", "Добавить рис или макароны.", "Варить до готовности и посолить."],
    "notes": [],
    "usage": inventory.dishUsage["Тефтельный суп"],
    "activeMinutes": 14,
    "containerRule": null
  },
  "Капустные оладьи с кефирным соусом": {
    "title": "Капустные оладьи с кефирным соусом",
    "source": { "kind": "internal_seed", "url": null, "note": "Seed recipe" },
    "type": "Готовить свежим",
    "time": "25 минут",
    "store": "Можно разогреть на следующий день",
    "ingredients": ["капуста - 300 г", "яйцо - 1 шт", "мука - 2 ст. л.", "кефир - 80 мл", "соль"],
    "steps": ["Капусту тонко нарезать и помять с солью.", "Добавить яйцо и муку.", "Жарить небольшими оладьями по 3-4 минуты с каждой стороны.", "Кефир посолить и использовать как соус."],
    "notes": ["Если капуста жесткая, сначала залить кипятком на 5 минут."],
    "usage": inventory.dishUsage["Капустные оладьи с кефирным соусом"],
    "activeMinutes": 16,
    "containerRule": null
  },
  "Минтай в томатном соусе с макаронами": {
    "title": "Минтай в томатном соусе с макаронами",
    "source": { "kind": "internal_seed", "url": null, "note": "Seed recipe" },
    "type": "Рыба",
    "time": "30 минут",
    "store": "Холодильник до 2 дней",
    "ingredients": ["минтай/хек - 200-250 г", "макароны - 90 г сухие", "томатная паста - 1 ст. л.", "лук/морковь"],
    "steps": ["Отварить макароны.", "Лук и морковь прогреть на сковороде.", "Добавить томатную пасту и воду.", "Положить рыбу и тушить 12-15 минут.", "Подать с макаронами."],
    "notes": [],
    "usage": inventory.dishUsage["Минтай в томатном соусе с макаронами"],
    "activeMinutes": 12,
    "containerRule": null
  },
  "Гречка по-купечески с курицей": {
    "title": "Гречка по-купечески с курицей",
    "source": { "kind": "internal_seed", "url": null, "note": "Seed recipe" },
    "type": "Готовить на 2 порции",
    "time": "35 минут",
    "store": "Холодильник до 3 дней",
    "ingredients": ["гречка - 180 г сухой", "курица - 300-350 г", "морковь - 1 шт", "лук - 1 шт", "томатная паста по желанию"],
    "steps": ["Обжарить лук, морковь и курицу.", "Добавить промытую гречку.", "Влить воду 1 к 2.", "Посолить и тушить под крышкой 18-20 минут.", "Оставить под крышкой еще на 5 минут."],
    "notes": [],
    "usage": inventory.dishUsage["Гречка по-купечески с курицей"],
    "activeMinutes": 14,
    "containerRule": null
  },
  "Рис жареный с курицей и овощами": {
    "title": "Рис жареный с курицей и овощами",
    "source": { "kind": "internal_seed", "url": null, "note": "Seed recipe" },
    "type": "Быстро из остатков",
    "time": "20 минут",
    "store": "Лучше свежим",
    "ingredients": ["готовый рис или рис сухой - 80 г", "курица - 120-160 г", "овощная смесь - 150 г", "яйцо - 1 шт"],
    "steps": ["Если рис сырой, сначала сварить.", "Курицу мелко нарезать и обжарить.", "Добавить овощную смесь.", "Добавить рис и прогреть.", "Сдвинуть рис в сторону, вбить яйцо и перемешать."],
    "notes": ["Лучше получается из вчерашнего риса."],
    "usage": inventory.dishUsage["Рис жареный с курицей и овощами"],
    "activeMinutes": 10,
    "containerRule": null
  }
};

Object.entries(appRecipes).forEach(([name, r]) => {
  if (!recipes.recipes[name]) {
    recipes.recipes[name] = r;
    console.log(`Added missing recipe: ${name}`);
  }
});

Object.entries(products.products).forEach(([productId, product]) => {
  product.box = buildProductBox(productId, product);
});

const qualityReport = {
  total: 0,
  good: 0,
  review: 0,
  blocked: 0,
  inferredUsage: 0,
  issues: {}
};

Object.entries(recipes.recipes).forEach(([name, r]) => {
  if (!r.usage && inventory.dishUsage[name]) {
    r.usage = inventory.dishUsage[name];
  }
  if (!r.usage || !Object.keys(r.usage).length || r.usageSource === 'ingredients_inferred') {
    const inferred = inferUsageFromIngredients(r.ingredients);
    if (Object.keys(inferred).length) {
      r.usage = inferred;
      r.usageSource = r.usageSource || 'ingredients_inferred';
      qualityReport.inferredUsage += 1;
    }
  }
  r.activeMinutes = inferActiveMinutes(r);
  r.usageBoxes = buildUsageBoxes(r.usage);
  r.ingredientBoxes = buildIngredientBoxes(r.usage, r.ingredients);
  const cost = estimateRecipeCost(r.usage);
  const macros = estimateRecipeMacros(r.usage);
  r.cost = cost;
  r.costLabel = moneyLabel(cost);
  r.macros = macros;
  r.kcal = macros.kcal;
  r.quality = recipeQuality(name, r, r.usage, cost, macros);
  r.box = buildRecipeBox(name, r, r.quality, cost, macros);
  qualityReport.total += 1;
  qualityReport[r.quality.level] += 1;
  r.quality.issues.forEach(issue => {
    qualityReport.issues[issue] = (qualityReport.issues[issue] || 0) + 1;
  });
});

recipes.qualityReport = qualityReport;

Object.entries(plans.shopping || {}).forEach(([key, basket]) => {
  const itemBoxes = (inventory.packageOrders?.[key] || []).map((item, index) => buildPackageBox(key, item, index));
  const totalCost = roundMoney(itemBoxes.reduce((sum, item) => sum + item.totalPrice, 0));
  basket.itemBoxes = itemBoxes;
  basket.totalCost = totalCost;
  basket.totalCostLabel = moneyLabel(totalCost);
  basket.box = {
    id: key,
    title: basket.name,
    budget: basket.budget || '',
    itemCount: itemBoxes.length,
    totalCost,
    totalCostLabel: moneyLabel(totalCost)
  };
});

inventory.purchases = (inventory.purchases || []).map(purchase => {
  const itemBoxes = Object.entries(purchase.items || {}).map(([productId, amount], index) => {
    const product = products.products[productId] || {};
    const cost = productCost(productId, amount);
    return {
      id: `${purchase.key}-${index + 1}-${productId}`,
      productId,
      title: product.name || productId,
      amount,
      amountLabel: productAmountLabel(productId, amount),
      unit: product.unit || '',
      storage: product.storage || '',
      pricePerUnit: product.pricePerUnit ?? null,
      cost,
      priceLabel: moneyLabel(cost)
    };
  });
  const totalCost = roundMoney(itemBoxes.reduce((sum, item) => sum + item.cost, 0));
  return {
    ...purchase,
    itemBoxes,
    totalCost,
    totalCostLabel: moneyLabel(totalCost),
    box: {
      id: purchase.key,
      title: purchase.title,
      orderDay: purchase.orderDay,
      availableDay: purchase.availableDay,
      itemCount: itemBoxes.length,
      totalCost,
      totalCostLabel: moneyLabel(totalCost)
    }
  };
});

inventory.packageBoxes = Object.fromEntries(Object.entries(inventory.packageOrders || {}).map(([key, items]) => {
  const itemBoxes = items.map((item, index) => buildPackageBox(key, item, index));
  return [key, {
    key,
    itemBoxes,
    totalCost: roundMoney(itemBoxes.reduce((sum, item) => sum + item.totalPrice, 0)),
    totalCostLabel: moneyLabel(itemBoxes.reduce((sum, item) => sum + item.totalPrice, 0))
  }];
}));

plans.plan.forEach((planDay, index) => {
  let dayKcal = 0;
  Object.entries(planDay.meals || {}).forEach(([mealName, meal]) => {
    const recipe = recipes.recipes[meal.dish];
    const usage = inventory.dishUsage?.[meal.dish] || recipe?.usage || {};
    const ingredientBoxes = recipe?.ingredientBoxes || buildUsageBoxes(usage);
    const recipeCost = recipe ? recipe.cost : estimateRecipeCost(usage);
    const recipeMacros = recipe ? recipe.macros : estimateRecipeMacros(usage);
    const mealCost = Number(meal.cost ?? recipeCost ?? 0);
    const mealKcal = Number(meal.kcal ?? recipeMacros.kcal ?? 0);
    dayKcal += mealKcal;
    meal.dishCost = recipeCost;
    meal.costLabel = moneyLabel(mealCost);
    meal.box = {
      id: `day-${planDay.actual_day || index + 1}-${mealName}`,
      mealName,
      title: meal.dish,
      recipeId: meal.dish,
      portion: meal.portion || '',
      kcal: mealKcal,
      cost: mealCost,
      costLabel: moneyLabel(mealCost),
      recipeCost,
      recipeCostLabel: moneyLabel(recipeCost),
      quality: recipe?.quality?.level || 'missing',
      ingredientBoxes
    };
  });
  planDay.box = {
    id: `day-${planDay.actual_day || index + 1}`,
    day: planDay.actual_day || index + 1,
    title: planDay.title,
    cost: Number(planDay.cost || 0),
    costLabel: moneyLabel(planDay.cost || 0),
    kcal: dayKcal,
    shoppingKey: planDay.shopping_type_actual || ''
  };
});

// 5. Update versions
recipes.version = 3;
recipes.generatedFrom = "build-data.js";
products.version = 3;
products.generatedFrom = "build-data.js";
inventory.version = 3;
inventory.generatedFrom = "build-data.js";
plans.version = 3;
plans.generatedFrom = "build-data.js";

// Save all
writeJSON('plans.json', plans);
writeJSON('recipes.json', recipes);
writeJSON('products.json', products);
writeJSON('inventory-rules.json', inventory);

console.log('Data build complete.');
console.log(`Plans: ${plans.plan.length} days, ${Object.keys(plans.used).length} used entries`);
console.log(`Recipes: ${Object.keys(recipes.recipes).length}`);
console.log(`Products: ${Object.keys(products.products).length}`);
console.log(`Recipe quality: ${qualityReport.good} good, ${qualityReport.review} review, ${qualityReport.blocked} blocked`);
