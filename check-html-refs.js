const fs = require('fs');
const path = require('path');
const root = __dirname;
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const refs = [...html.matchAll(/href=['"]([^'"]+)['"]/g)].map(m => m[1]);
const scripts = [...html.matchAll(/src=['"]([^'"]+)['"]/g)].map(m => m[1]);
const all = [...new Set([...refs, ...scripts])]
  .filter(f => !f.startsWith('#') && !/^[a-z]+:/i.test(f));
let missing = 0;
all.forEach(f => {
  const exists = fs.existsSync(path.join(root, f));
  if (!exists) missing++;
  console.log((exists ? 'OK' : 'MISSING') + ' ' + f);
});
if (missing === 0) console.log('\nAll HTML references valid');
else console.log('\n' + missing + ' missing references');
