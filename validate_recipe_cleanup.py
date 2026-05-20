import json
import re
from pathlib import Path

root = Path(__file__).resolve().parent
recipes = json.loads((root / 'data' / 'recipes.json').read_text(encoding='utf-8'))['recipes']
plans = json.loads((root / 'data' / 'plans.json').read_text(encoding='utf-8'))
inventory = json.loads((root / 'data' / 'inventory-rules.json').read_text(encoding='utf-8'))

bad_name = re.compile(
    r'[A-Za-z]{3,}|(^|[\s("\'—-])(витх|анд|кх)|схримп|бутербродes|фасолевоеs|перецs|'
    r'гороховоес|гороховоер|арепа|пелуа|эмпанадас|тахини|харисс|сриракх|херб|'
    r'йогхурт|сйриан|проскиутто|бриокхе|аубергинес|сесаме|коконут|nationa|дисх',
    re.IGNORECASE,
)

blocked = [name for name, recipe in recipes.items() if (recipe.get('quality') or {}).get('level') == 'blocked']
generated = [name for name, recipe in recipes.items() if (recipe.get('source') or {}).get('kind') == 'generated']
suspicious = [name for name in recipes if bad_name.search(name)]
missing = []

for day in plans.get('plan', []):
    for meal_name, meal in (day.get('meals') or {}).items():
        dish = meal.get('dish')
        if dish and dish not in recipes:
            missing.append(('plans.plan.meals', day.get('actual_day'), meal_name, dish))

for section in ('used',):
    for key, value in (plans.get(section) or {}).items():
        if isinstance(value, str) and value not in recipes:
            missing.append((f'plans.{section}', key, None, value))

for section in ('dishUsage', 'activeMinutes', 'containerRules'):
    for dish in (inventory.get(section) or {}):
        if dish not in recipes:
            missing.append((f'inventory.{section}', None, None, dish))

print(f'recipes={len(recipes)}')
print(f'blocked={len(blocked)}')
print(f'generated_source={len(generated)}')
print(f'suspicious_names={len(suspicious)}')
print(f'missing_refs={len(missing)}')

if blocked:
    print('\nBLOCKED')
    for item in blocked[:100]:
        print(item)
if generated:
    print('\nGENERATED')
    for item in generated[:100]:
        print(item)
if suspicious:
    print('\nSUSPICIOUS')
    for item in suspicious[:100]:
        print(item)
if missing:
    print('\nMISSING')
    for item in missing[:100]:
        print(item)

raise SystemExit(1 if blocked or generated or suspicious or missing else 0)
