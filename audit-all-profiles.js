const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "data/plans/manifest.json"), "utf8"));
const recipes = JSON.parse(fs.readFileSync(path.join(__dirname, "data/recipes.json"), "utf8")).recipes || {};
const MEAL_ORDER = ["Завтрак", "Обед", "Полдник", "Ужин", "Чай"];

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, file), "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function checkProfile(profile) {
  const plan = readJson(`data/plans/${profile.planFile}`);
  const inv = readJson(`data/plans/${profile.invFile}`);
  const errors = [];

  try { assert(Array.isArray(plan.plan), `${profile.id}: plan must be an array`); } catch (e) { errors.push(e.message); }
  try { assert(plan.plan.length === 30, `${profile.id}: expected 30 plan days, got ${plan.plan?.length || 0}`); } catch (e) { errors.push(e.message); }
  try { assert(plan.actions && Object.keys(plan.actions).length === 30, `${profile.id}: expected actions for 30 days`); } catch (e) { errors.push(e.message); }
  try { assert(inv.dishUsage && Object.keys(inv.dishUsage).length > 0, `${profile.id}: missing dishUsage`); } catch (e) { errors.push(e.message); }
  try { assert(inv.purchases && inv.purchases.length > 0, `${profile.id}: missing purchases`); } catch (e) { errors.push(e.message); }
  try { assert(inv.packageOrders && Object.keys(inv.packageOrders).length > 0, `${profile.id}: missing packageOrders`); } catch (e) { errors.push(e.message); }

  const dishes = new Set();
  (plan.plan || []).forEach((day, dayIndex) => {
    MEAL_ORDER.forEach(mealName => {
      const meal = day.meals?.[mealName];
      if (!meal || !meal.dish) {
        errors.push(`${profile.id}: day ${dayIndex + 1} missing meal ${mealName}`);
        return;
      }
      dishes.add(meal.dish);
      if (!recipes[meal.dish]) errors.push(`${profile.id}: missing recipe for ${meal.dish}`);
      if (!inv.dishUsage?.[meal.dish]) errors.push(`${profile.id}: missing usage for ${meal.dish}`);
    });
  });

  return { id: profile.id, dishes: dishes.size, errors };
}

let failed = false;
const summaries = [];

for (const profile of manifest.profiles || []) {
  const summary = checkProfile(profile);
  summaries.push(summary);
  if (summary.errors.length) {
    failed = true;
    console.error(`\n${profile.id}: STRUCTURE FAIL`);
    summary.errors.forEach(error => console.error(`  - ${error}`));
    continue;
  }

  const audit = spawnSync(process.execPath, ["audit.js", "--profile", profile.id], {
    cwd: __dirname,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 20
  });
  const output = `${audit.stdout || ""}${audit.stderr || ""}`;
  const hasAuditFailure = audit.status !== 0 || /(?:PACKAGE AUDIT|FRESHNESS AUDIT|INVENTORY AUDIT|RECIPE COVERAGE|DISH USAGE COVERAGE): FAIL/.test(output);
  if (hasAuditFailure) {
    failed = true;
    console.error(`\n${profile.id}: AUDIT FAIL`);
    console.error(output);
  } else {
    const quality = output.match(/PLAN QUALITY: (PASS|WARNINGS)[\s\S]*?Warnings: (\d+)/);
    const qualitySuffix = quality ? `, plan quality ${quality[1].toLowerCase()}=${quality[2]}` : "";
    console.log(`${profile.id}: PASS (${summary.dishes} unique dishes${qualitySuffix})`);
  }
}

const totalUnique = new Set();
for (const profile of manifest.profiles || []) {
  const plan = readJson(`data/plans/${profile.planFile}`);
  for (const day of plan.plan || []) {
    for (const meal of Object.values(day.meals || {})) totalUnique.add(meal.dish);
  }
}

console.log(`\nProfiles checked: ${(manifest.profiles || []).length}`);
console.log(`Unique dishes across profiles: ${totalUnique.size}`);

if (failed) process.exit(1);
