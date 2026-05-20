// generate-all-plans.js — generate plans for all 6 family profiles
const fs = require('fs');
const path = require('path');

const profiles = [
  { id: 'a1_c0', adults: 1, children: 0, budget: 20000, label: '1 взрослый' },
  { id: 'a1_c1', adults: 1, children: 1, budget: 30000, label: '1 взрослый + 1 ребенок' },
  { id: 'a1_c2', adults: 1, children: 2, budget: 45000, label: '1 взрослый + 2 ребенка' },
  { id: 'a2_c0', adults: 2, children: 0, budget: 40000, label: '2 взрослых' },
  { id: 'a2_c1', adults: 2, children: 1, budget: 50000, label: '2 взрослых + 1 ребенок' },
  { id: 'a2_c2', adults: 2, children: 2, budget: 60000, label: '2 взрослых + 2 ребенка' },
];

// Create output directory
const outDir = path.join(__dirname, 'data', 'plans');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const { execSync } = require('child_process');

let allOk = true;
for (const p of profiles) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Generating: ${p.label} (${p.id}) — ${p.adults} adults + ${p.children} children, ${p.budget}₽`);
  console.log('='.repeat(60));
  
  try {
    const cmd = `node generate-plan.js --adults ${p.adults} --children ${p.children} --budget ${p.budget} --seed 42`;
    execSync(cmd, { cwd: __dirname, stdio: 'inherit', timeout: 120000 });
    
    // Copy generated files to profile-specific locations
    const planData = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'plans.json'), 'utf8'));
    const invData = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'inventory-rules.json'), 'utf8'));
    
    // Save plan
    fs.writeFileSync(
      path.join(outDir, `plan_${p.id}.json`),
      JSON.stringify(planData, null, 2) + '\n',
      'utf8'
    );
    // Save inventory rules (purchases, dishUsage scaled for this profile)
    fs.writeFileSync(
      path.join(outDir, `inv_${p.id}.json`),
      JSON.stringify({
        purchases: invData.purchases,
        packageOrders: invData.packageOrders,
        dishUsage: invData.dishUsage,
        shelfLifeDays: invData.shelfLifeDays,
        familyInfo: invData.familyInfo,
        containerSlots: invData.containerSlots,
      }, null, 2) + '\n',
      'utf8'
    );
    
    console.log(`✓ Saved plan_${p.id}.json + inv_${p.id}.json`);
  } catch (err) {
    console.error(`✗ FAILED: ${p.id}`, err.message);
    allOk = false;
  }
}

// Also save the default plan (1 adult, 20000) as the main plans.json
console.log(`\n${'='.repeat(60)}`);
console.log('Setting default plan: a1_c0 (1 adult, 20000₽)');
try {
  execSync(`node generate-plan.js --adults 1 --children 0 --budget 20000 --seed 42`, { cwd: __dirname, stdio: 'inherit', timeout: 120000 });
  console.log('✓ Default plan generated');
} catch (err) {
  console.error('✗ Default plan failed', err.message);
  allOk = false;
}

// Write manifest
const manifest = {
  version: 1,
  profiles: profiles.map(p => ({
    id: p.id,
    adults: p.adults,
    children: p.children,
    budget: p.budget,
    label: p.label,
    planFile: `plan_${p.id}.json`,
    invFile: `inv_${p.id}.json`,
  })),
  defaultProfile: 'a1_c0',
};
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log('\n✓ Manifest saved');

if (allOk) console.log('\n=== ALL PROFILES GENERATED SUCCESSFULLY ===');
else console.log('\n=== SOME PROFILES FAILED ===');
