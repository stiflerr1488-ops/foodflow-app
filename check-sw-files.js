const fs = require('fs');
const pathModule = require('path');
const root = __dirname;

const APP_SHELL = [
  "./",
  "./index.html",
  "./data-loader.js",
  "./app.js",
  "./tokens.css",
  "./style.css",
  "./manifest.webmanifest",
  "./foodflow-icon.svg",
  "./data/products.json",
  "./data/recipes.json",
  "./data/inventory-rules.json",
  "./data/plans.json",
  "./data/budget-tiers.json",
  "./data/family-profiles.json",
  "./data/store-prices.json",
  "./data/plans/manifest.json",
  "./data/plans/plan_a1_c0.json",
  "./data/plans/inv_a1_c0.json",
  "./data/plans/plan_a1_c1.json",
  "./data/plans/inv_a1_c1.json",
  "./data/plans/plan_a1_c2.json",
  "./data/plans/inv_a1_c2.json",
  "./data/plans/plan_a2_c0.json",
  "./data/plans/inv_a2_c0.json",
  "./data/plans/plan_a2_c1.json",
  "./data/plans/inv_a2_c1.json",
  "./data/plans/plan_a2_c2.json",
  "./data/plans/inv_a2_c2.json"
];

let missing = 0;
APP_SHELL.forEach(f => {
  // Remove ./ prefix for fs check
  const path = f === './' ? '.' : f.replace(/^\.\//, '');
  const exists = fs.existsSync(pathModule.join(root, path));
  if (!exists) missing++;
  console.log((exists ? 'OK' : 'MISSING') + ' ' + f);
});

if (missing === 0) console.log('\nAll SW cache files present');
else console.log('\n' + missing + ' missing cache files');
