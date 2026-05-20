#!/usr/bin/env node
/*
 * Manual recipe patcher.
 *
 * Usage:
 *   node apply-recipe-patch.js docs/recipe-review/patches/<file>.json
 *
 * Patch file format:
 *   {
 *     "batch": "A0",
 *     "reviewer": "manual",
 *     "patches": [
 *       {
 *         "name": "Чай с сахаром",
 *         "set": {
 *           "title": "...",
 *           "time": "...",
 *           "store": "...",
 *           "ingredients": [...],
 *           "steps": [...],
 *           "notes": "...",
 *           "activeMinutes": 2,
 *           "source": {"kind": "manual_reviewed", "url": null, "note": "..."}
 *         }
 *       }
 *     ]
 *   }
 *
 * The patcher:
 *   - validates that each name exists in recipes.json
 *   - merges set{} into the recipe (shallow)
 *   - if `usage` is in set{}, also writes data/inventory-rules.json::dishUsage[name]
 *   - rewrites recipes.json + recipes-extended.json deterministically
 *   - appends entry to docs/recipe-review/log.md
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = __dirname;
const RECIPES_PATH = path.join(root, "data", "recipes.json");
const RULES_PATH = path.join(root, "data", "inventory-rules.json");
const LOG_PATH = path.join(root, "docs", "recipe-review", "log.md");

function loadJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function saveJson(p, obj) { fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n"); }

function fail(msg) { console.error("apply-recipe-patch: " + msg); process.exit(1); }

const patchPath = process.argv[2];
if (!patchPath) fail("usage: node apply-recipe-patch.js <patch.json>");
if (!fs.existsSync(patchPath)) fail("patch not found: " + patchPath);

const patch = loadJson(patchPath);
if (!patch.patches || !Array.isArray(patch.patches)) fail("patch.patches[] missing");

const recipesFile = loadJson(RECIPES_PATH);
const recipes = recipesFile.recipes || recipesFile;
const rulesFile = loadJson(RULES_PATH);
const dishUsage = rulesFile.dishUsage || (rulesFile.dishUsage = {});

const applied = [];
for (const p of patch.patches) {
  if (!p.name) fail("patch entry missing name");
  if (!recipes[p.name]) fail("recipe not found: " + p.name);
  const before = JSON.stringify(recipes[p.name]);
  Object.assign(recipes[p.name], p.set || {});
  if (p.set && p.set.usage) {
    dishUsage[p.name] = p.set.usage;
  }
  const after = JSON.stringify(recipes[p.name]);
  if (before === after) {
    console.warn("noop: " + p.name);
  } else {
    applied.push(p.name);
  }
}

if (recipesFile.recipes) {
  saveJson(RECIPES_PATH, recipesFile);
} else {
  saveJson(RECIPES_PATH, recipes);
}
saveJson(RULES_PATH, rulesFile);

// Also update recipes-extended.json if present (subset / mirror).
const extPath = path.join(root, "data", "recipes-extended.json");
if (fs.existsSync(extPath)) {
  const ext = loadJson(extPath);
  const target = ext.recipes || ext;
  let changed = 0;
  for (const name of applied) {
    if (target[name]) {
      target[name] = { ...target[name], ...recipes[name] };
      changed++;
    }
  }
  if (changed) saveJson(extPath, ext);
}

// Log
const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
const line = `${stamp} | ${patch.batch || "?"} | applied=${applied.length} | ${applied.join(", ")}\n`;
fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
fs.appendFileSync(LOG_PATH, line);

console.log(`applied ${applied.length} recipes`);

// Re-run verification
function run(cmd) {
  console.log("$ " + cmd);
  execSync(cmd, { cwd: root, stdio: "inherit" });
}
try {
  run("node test-runtime.js");
  run("node audit.js");
  console.log("✓ verification passed");
} catch (e) {
  console.error("✗ verification failed — please fix before next batch");
  process.exit(2);
}
