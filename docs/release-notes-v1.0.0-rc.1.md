# FoodFlow v1.0.0-rc.1

- Production URL: https://foodflow-sage.vercel.app/
- Preview URL: https://foodflow-5br975wuz-strk.vercel.app/
- Release date: 2026-05-20.
- Scope: static 30-day meal planning app with recipes, shopping baskets, inventory, leftovers, budget checks, and offline support.
- Data: 1211 manually reviewed recipes, 30 days, 9 purchase rounds, 118 unique dishes in the default plan.
- Verification: `npm run verify` passes before production deploy.
- Production smoke: `npm run smoke:prod` passes after production deploy.
- Browser smoke: Chrome headless renders the production page to onboarding UI.
- Known limitations: browser/PWA smoke-test must be repeated manually after every production deploy; runtime errors are stored locally in `foodflow_runtime_errors`.
