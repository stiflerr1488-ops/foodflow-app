const fs = require("fs");
const path = require("path");

const recipes = JSON.parse(fs.readFileSync(path.join(__dirname, "data/recipes.json"), "utf8")).recipes || {};
const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "data/inventory-rules.json"), "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "data/plans/manifest.json"), "utf8"));

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

  "Заготовка на несколько порций": ["Обед", "Ужин"],
  "Быстрое горячее": ["Завтрак", "Обед", "Ужин"],
  "Готовить на 1-2 порции": ["Обед", "Ужин"],
  "Запечь в духовке": ["Обед", "Ужин"],
  "Готовить на плите": ["Обед", "Ужин"],
  "Перекус": ["Полдник", "Чай"],
  "Горячее блюдо": ["Обед", "Ужин"],
  "Готовить на сковороде": ["Завтрак", "Обед", "Ужин"],
  "Быстрый гарнир": ["Обед", "Ужин"],
  "Выпечка на сковороде или в духовке": ["Завтрак", "Полдник", "Чай"],
  "Запечь": ["Обед", "Ужин"],
  "Салат": ["Обед", "Ужин", "Полдник"],
  "Готовить заранее": ["Завтрак", "Полдник", "Чай"],
  "Выпечка": ["Завтрак", "Полдник", "Чай", "Обед", "Ужин"],
  "Выпечка на сковороде": ["Завтрак", "Полдник", "Обед", "Ужин"],
  "Холодное блюдо": ["Полдник", "Обед", "Ужин"],
  "Соус": ["Чай", "Полдник"],
  "Быстро смешать": ["Чай", "Полдник"],
  "Десерт": ["Полдник", "Чай", "Завтрак"],
  "Суп": ["Обед", "Ужин"]
};

const MEAL_TARGETS = {
  Завтрак: { kcalMin: 250, kcalMax: 700, costMin: 30, costMax: 130 },
  Обед: { kcalMin: 350, kcalMax: 900, costMin: 70, costMax: 250 },
  Полдник: { kcalMin: 150, kcalMax: 420, costMin: 30, costMax: 135 },
  Ужин: { kcalMin: 300, kcalMax: 900, costMin: 50, costMax: 250 },
  Чай: { kcalMin: 50, kcalMax: 200, costMin: 5, costMax: 40 }
};

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, file), "utf8"));
}

const allRecipes = Object.keys(recipes);
const usedDefault = new Set();
const usedAllProfiles = new Set();

for (const day of readJson("data/plans.json").plan || []) {
  for (const meal of Object.values(day.meals || {})) usedDefault.add(meal.dish);
}

for (const profile of manifest.profiles || []) {
  const plan = readJson(`data/plans/${profile.planFile}`);
  for (const day of plan.plan || []) {
    for (const meal of Object.values(day.meals || {})) usedAllProfiles.add(meal.dish);
  }
}

const noUsage = [];
const unmappedType = [];
const outsideTargets = [];
const eligible = new Set();

for (const [name, recipe] of Object.entries(recipes)) {
  const usage = recipe.usage || rules.dishUsage?.[name];
  if (!usage || !Object.keys(usage).length) {
    noUsage.push(name);
    continue;
  }

  const meals = TYPE_MEAL_MAP[recipe.type || ""] || [];
  if (!meals.length) {
    unmappedType.push(`${name} (${recipe.type || "no type"})`);
    continue;
  }

  const kcal = recipe.macros?.kcal || recipe.kcal || 0;
  const cost = recipe.cost || 0;
  const fits = meals.some(meal => {
    const target = MEAL_TARGETS[meal];
    return cost >= target.costMin * 0.2 && cost <= target.costMax * 1.8 && kcal >= target.kcalMin * 0.2 && kcal <= target.kcalMax * 2;
  });

  if (fits) eligible.add(name);
  else outsideTargets.push(name);
}

const missingDefaultRecipes = [...usedDefault].filter(dish => !recipes[dish]);
const missingAllRecipes = [...usedAllProfiles].filter(dish => !recipes[dish]);
const unusedAcrossProfiles = allRecipes.filter(name => !usedAllProfiles.has(name));

console.log(`recipes=${allRecipes.length}`);
console.log(`default_used=${usedDefault.size}`);
console.log(`all_profiles_used=${usedAllProfiles.size}`);
console.log(`unused_across_profiles=${unusedAcrossProfiles.length}`);
console.log(`eligible_for_generator=${eligible.size}`);
console.log(`no_usage=${noUsage.length}`);
console.log(`unmapped_type=${unmappedType.length}`);
console.log(`outside_targets=${outsideTargets.length}`);
console.log(`missing_default_recipes=${missingDefaultRecipes.length}`);
console.log(`missing_all_profile_recipes=${missingAllRecipes.length}`);

let failed = false;
function failList(title, values) {
  if (!values.length) return;
  failed = true;
  console.error(`\n${title}:`);
  values.slice(0, 50).forEach(value => console.error(`  - ${value}`));
  if (values.length > 50) console.error(`  ... and ${values.length - 50} more`);
}

failList("Recipes without usage", noUsage);
failList("Recipes with unmapped generator type", unmappedType);
failList("Recipes outside generator kcal/cost targets", outsideTargets);
failList("Plan dishes missing from recipes", missingDefaultRecipes);
failList("Profile plan dishes missing from recipes", missingAllRecipes);

if (failed) process.exit(1);
