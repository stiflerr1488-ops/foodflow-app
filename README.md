# FoodFlow

FoodFlow is a static 30-day meal planning app in Russian. It includes the daily schedule, recipes, shopping baskets, inventory usage, leftovers, container tracking, budget checks, and offline support through a service worker.

The app is designed to run as plain static files and deploy to Vercel without a build step.

## Project Structure

- `index.html` — application shell, SEO/PWA tags, and styles.
- `app.js` — browser UI, plan rendering, inventory views, runtime checks, and PWA status.
- `data-loader.js` — loads runtime data from `data-bundle.js`, cache, or JSON files.
- `data-bundle.js` — bundled runtime data for offline/file-mode startup.
- `sw.js` — service worker with app-shell caching and network-first JSON data.
- `data/` — products, recipes, inventory rules, plans, profiles, and prices.
- `icons/` — PNG PWA/social icons.
- `screenshots/` — PWA manifest screenshots.
- `docs/recipe-review/` — manual recipe review lists, logs, and applied patches.

## Development

No package install is required for normal checks. Open `index.html` directly or serve the folder with any static server.

The release verification suite can be run with:

```bash
npm run verify
```

If source data changes, rebuild the bundle:

```bash
node build-bundle.js
```

If generated plans are intentionally refreshed, use the generator scripts in the project root and then run the full verification suite below.

## Verification

Run from the project root:

```bash
npm run verify
```

Equivalent individual commands:

```bash
node test-runtime.js
node check-html-refs.js
node check-sw-files.js
node audit.js
node audit-all-profiles.js
node check-recipe-coverage.js
python validate_recipe_cleanup.py
```

On Windows PowerShell, check JavaScript syntax with:

```powershell
Get-ChildItem -LiteralPath . -Filter *.js | ForEach-Object { node --check $_.FullName; if (-not $?) { exit 1 } }
```

On POSIX shells, the equivalent is:

```bash
for f in *.js; do node --check "$f" >/dev/null || exit 1; done
```

Expected current status:

- `node test-runtime.js` passes with 0 inventory errors.
- `node check-html-refs.js` passes with all HTML references present.
- `node check-sw-files.js` passes with all service worker cache files present.
- `node audit.js` passes with `PLAN QUALITY: PASS` and `Warnings: 0`.
- `node audit-all-profiles.js` passes for all 6 saved family profiles.
- `node check-recipe-coverage.js` reports all 1211 recipes eligible for generator selection.
- `python validate_recipe_cleanup.py` reports `recipes=1211`, `generated_source=0`, `suspicious_names=0`, `missing_refs=0`.

## Recipe Review

All 1211 recipes have been manually reviewed and marked as `source.kind = "manual_reviewed"`.

Recipe changes should be applied with JSON patches via:

```bash
node apply-recipe-patch.js docs/recipe-review/patches/<patch>.json
```

The patcher updates `data/recipes.json`, mirrors `data/recipes-extended.json` when applicable, syncs `dishUsage` if a patch intentionally includes `usage`, appends to `docs/recipe-review/log.md`, and runs `test-runtime.js` plus `audit.js`.

Avoid changing `usage` or gram amounts unless there is a clear stale mismatch between the recipe and inventory rules.

## Deployment

The project is static. Vercel can serve the repository root directly.

Before production deployment:

```bash
node test-runtime.js
node check-html-refs.js
node check-sw-files.js
node audit.js
python validate_recipe_cleanup.py
```

Then deploy:

```bash
vercel --prod
```

After deployment, smoke-test the production URL online and offline in browser DevTools. Confirm that `manifest.webmanifest`, `sw.js`, `data-bundle.js`, icons, screenshots, and JSON data load successfully.

## Notes

- `.vercelignore` excludes local tooling, review docs, tests, Python scripts, `node_modules/`, and Vercel metadata from deployment.
- `vercel.json` sets no-cache headers for HTML/data/service worker/JavaScript and immutable cache headers only for static image assets.
- Runtime errors are stored in `localStorage` under `foodflow_runtime_errors` for lightweight troubleshooting.
