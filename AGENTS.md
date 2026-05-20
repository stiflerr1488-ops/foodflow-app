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
python validate_recipe_cleanup.py
for f in *.js; do node --check "$f" >/dev/null || exit 1; done
```
