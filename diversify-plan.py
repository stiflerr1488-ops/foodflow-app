#!/usr/bin/env python3
"""Diversify the 30-day meal plan by replacing repeated dishes with ghost recipes."""
import json, pathlib, collections, random, copy, re

root = pathlib.Path(__file__).parent
recipes_data = json.loads((root / 'data' / 'recipes.json').read_text(encoding='utf-8-sig'))
recipes = recipes_data['recipes']
plans_data = json.loads((root / 'data' / 'plans.json').read_text(encoding='utf-8-sig'))
plans = plans_data['plan']
inv_data = json.loads((root / 'data' / 'inventory-rules.json').read_text(encoding='utf-8-sig'))
_fi = inv_data.get('familyInfo', {})
FAMILY_SCALE = _fi.get('scale', 1)

# Identify current plan dishes
plan_dishes = set()
for d in plans:
    for mn, meal in d['meals'].items():
        plan_dishes.add(meal['dish'])

ghost = {k: v for k, v in recipes.items() if k not in plan_dishes}

# Find the exact key for oatmeal with special quotes
oatmeal_banana_pie = None
for k in recipes:
    if 'банановый пирог' in k:
        oatmeal_banana_pie = k
        break

# ── Curated replacement pools ──────────────────────────────────────

BREAKFAST_PICKS = [
    'Овсяные панкейки на сковороде',       # 43₽ 433kcal Готовить утром
    'Овсяные вафли с бананом в мультипекаре',  # 51₽ 473kcal Готовить утром
    oatmeal_banana_pie,                     # 74₽ 942kcal Готовить утром
    'Овсяноблин с творогом',                # 78₽ 434kcal Готовить утром
    'Блины',                                # 67₽ 659kcal Готовить свежим
    'Банановое блины',                      # 56₽ 414kcal Готовить свежим
    'Свёкольные блины',                     # 66₽ 1003kcal Готовить свежим
    'Картофельные оладьи',                  # 79₽ 927kcal Готовить свежим
    'Омлет на сковороде',                   # 62₽ 703kcal Готовить свежим
    'Омлет и капустой',                     # 78₽ 402kcal Готовить свежим
    'Омлет и яблоками',                     # 60₽ 396kcal Готовить свежим
    'Омлет с овощной смесью',               # 82₽ 209kcal Готовить свежим
    'Омлет с хлебом с морковью по-домашнему',  # 55₽ 374kcal Готовить свежим
    'Картофельные драники в мультипекаре',  # 72₽ 614kcal Готовить сейчас
    'Омлет с хлебом с морковью',            # 69₽ 1136kcal Готовить свежим
    'Омлет на сковороде с макаронами',      # 74₽ 755kcal Основное
    'Омлет на сковороде с рисом',           # 76₽ 758kcal Основное
    'Омлет на сковороде с гречкой',         # 76₽ 760kcal Основное
    'Омлет на сковороде с овсянкой',        # 74₽ 764kcal Основное
    'Курица на сковороде с рисом',          # 79₽ 615kcal Основное
    'Курица на сковороде с макаронами',     # 77₽ 612kcal Основное
]

LUNCH_PICKS = [
    # Chicken
    'Курица на сковороде с гречкой',        # 79₽ 617kcal Основное
    'Курица с гречкой в сметанном соусе',   # 90₽ 649kcal Основное
    'Курица с макаронами в сметанном соусе', # 88₽ 644kcal Основное
    'Курица с рисом в сметанном соусе',     # 90₽ 647kcal Основное
    'Курица в капустном соусе',             # 88₽ 653kcal Основное
    'Тушёное блюдо: курица с капустой и гречкой',  # 79₽ Основное→Рагу
    'Тушёное блюдо: курица с капустой и макаронами',  # 77₽
    'Тушёное блюдо: курица с капустой с рисом',  # 79₽
    'Тушёное блюдо: курица с морковью и гречкой',  # 77₽
    'Тушёное блюдо: курица с морковью и макаронами',  # 75₽
    'Тушёное блюдо: курица с морковью с рисом',  # 79₽
    'Тушеная капуста с курицей',            # 195₽ 709kcal Готовить на 2 порции
    # Fish
    'Рыба на сковороде с рисом',            # 98₽ 522kcal Основное
    'Рыба на сковороде с гречкой',          # 98₽ 524kcal Основное
    'Рыба на сковороде с макаронами',        # 96₽ 519kcal Основное
    'Рыба с рисом в сметанном соусе',       # 110₽ 554kcal Основное
    'Рыба с гречкой в сметанном соусе',     # 110₽ 556kcal Основное
    'Минтай с картофелем с морковью',       # 147₽ 481kcal Рыба
    # Pelmeni
    'Пельмени на сковороде с рисом',        # 104₽ 783kcal Основное
    'Пельмени на сковороде с гречкой',      # 104₽ 785kcal Основное
    'Пельмени с макаронами под кефирным соусом',  # 100₽ 791kcal Основное
    'Вареники с картофелем и капустным салатом',  # 200₽ 620kcal Заморозка
    # Vegetarian
    'Гречка с капустным гарниром',          # 116₽ Вегетарианское
    'Гречка с морковным гарниром',          # 114₽ Вегетарианское
    'Макароны с капустным гарниром',        # 113₽ Вегетарианское
    'Макароны с морковным гарниром',        # 111₽ Вегетарианское
    'Домашний рис с тушёной капустой',      # 116₽ Вегетарианское
    'Домашний рис с тушёной морковью',      # 114₽ Вегетарианское
    # Other
    'Гречка с наггетсами и салатом',        # 187₽ 799kcal Заморозка
    'Котлеты с макаронами и салатом',       # 125₽ 753kcal Заморозка + гарнир
    'Рыбный суп с картофелем с морковью',   # 80₽ 787kcal Готовить свежим
    'Картофельный суп с капустой',          # 92₽ 379kcal Готовить свежим
    'Пирог с говяжьим фаршем',              # 74₽ 592kcal Готовить свежим
    'Говядина с брокколи на сковороде',     # 167₽ 429kcal Готовить свежим
    'Кисло-сладкая курица',                 # 167₽ 483kcal Готовить свежим
    'Курица с жареным рисом',               # 186₽ 915kcal Готовить свежим
    'Мясной рулет с томатами и сыром',      # 174₽ 506kcal Готовить свежим
    'Говядина с рисом с морковью',          # 170₽ 791kcal Готовить свежим
    # Container reheat
    'Капустное рагу с картофелем из контейнера',  # 9₽ Разогреть
    'Макароны с яйцом и капустой из контейнера',  # 29₽ Разогреть
]

SNACK_PICKS = [
    'Творог',                               # 99₽ 218kcal Собрать без готовки
    'Творог + чай',                         # 99₽ 218kcal Собрать без готовки
    'Банан + кефир',                        # 61₽ 268kcal Собрать без готовки
    'Творог + банан',                       # 124₽ 334kcal Собрать без готовки
    'Творог или кефир по плану остатков',   # 129₽ 344kcal Собрать без готовки
    'Творог с бананом и сушками',           # 132₽ 407kcal Без готовки
    'Кефир',                                # 36₽ 152kcal Собрать без готовки
]

TEA_PICKS = [
    'Чай + хлеб',                           # 10₽ 104kcal Собрать без готовки
    'Кефир',                                # 36₽ 152kcal Собрать без готовки
    'Варёное яйцо + чай',                   # 9₽ 73kcal Собрать без готовки
]

# ── Verify all picks exist ──────────────────────────────────────────
all_picks = BREAKFAST_PICKS + LUNCH_PICKS + SNACK_PICKS + TEA_PICKS
for name in all_picks:
    if name not in recipes:
        print(f'ERROR: Missing recipe: {repr(name)}')
        exit(1)

# ── Find repeat slots ───────────────────────────────────────────────
dish_slots = collections.defaultdict(list)
for i, d in enumerate(plans):
    for mn, meal in d['meals'].items():
        dish_slots[meal['dish']].append((i, mn))

repeats = {dish: slots for dish, slots in dish_slots.items() if len(slots) > 1}

replace_list = []
for dish, slots in repeats.items():
    for idx, mn in slots[1:]:  # keep first occurrence
        replace_list.append((idx, mn, dish))

replace_by_meal = collections.defaultdict(list)
for idx, mn, old_dish in replace_list:
    replace_by_meal[mn].append((idx, mn, old_dish))

# ── Assign replacements ────────────────────────────────────────────
random.seed(42)
used = set(plan_dishes)
replacement_map = {}

def assign_picks(slots, picks, allow_reuse=False):
    """Assign picks to replacement slots, avoiding already-used dishes."""
    pi = 0
    for idx, mn, old_dish in sorted(slots, key=lambda x: x[0]):
        assigned = False
        while pi < len(picks):
            candidate = picks[pi]
            pi += 1
            if candidate not in used or allow_reuse:
                replacement_map[(idx, mn)] = candidate
                if candidate not in used:
                    used.add(candidate)
                assigned = True
                break
        if not assigned and allow_reuse:
            # Cycle through picks
            candidate = picks[pi % len(picks)]
            pi += 1
            replacement_map[(idx, mn)] = candidate
        elif not assigned:
            replacement_map[(idx, mn)] = old_dish
            print(f'  WARNING: No replacement for day {idx+1} {mn} ({old_dish})')

# Shuffle picks for variety
bp = list(BREAKFAST_PICKS)
random.shuffle(bp)
assign_picks(replace_by_meal['Завтрак'], bp)

lp = list(LUNCH_PICKS)
random.shuffle(lp)
assign_picks(replace_by_meal['Обед'], lp)

# Dinner: use remaining lunch picks first, then find more
remaining = [x for x in lp if x not in used]
assign_picks(replace_by_meal['Ужин'], remaining)

# Check if any dinner slots weren't filled
unfilled_dinner = [(idx, mn, old) for idx, mn, old in replace_by_meal['Ужин']
                   if replacement_map.get((idx, mn)) == old]
if unfilled_dinner:
    # Find more candidates from ghost
    extra = [k for k, v in ghost.items()
             if k not in used and 70 <= v.get('cost', 0) <= 200
             and not re.search(r'[A-Za-z]{2,}', k)]
    random.shuffle(extra)
    ei = 0
    for idx, mn, old_dish in unfilled_dinner:
        while ei < len(extra):
            candidate = extra[ei]
            ei += 1
            if candidate not in used:
                replacement_map[(idx, mn)] = candidate
                used.add(candidate)
                break

# Snack: allow reuse (simple combos like "Творог" are fine to repeat)
sp = list(SNACK_PICKS)
random.shuffle(sp)
assign_picks(replace_by_meal['Полдник'], sp, allow_reuse=True)

# Tea: allow reuse
tp = list(TEA_PICKS)
random.shuffle(tp)
assign_picks(replace_by_meal['Чай'], tp, allow_reuse=True)

# ── Apply replacements to plans ─────────────────────────────────────
new_plans = copy.deepcopy(plans)

for (idx, mn), new_dish in replacement_map.items():
    r = recipes[new_dish]
    meal = new_plans[idx]['meals'][mn]
    old_dish = meal['dish']

    meal['dish'] = new_dish
    meal['kcal'] = round((r.get('macros', {}).get('kcal') or r.get('kcal', 0)) * FAMILY_SCALE)
    meal['cost'] = round(r.get('cost', 0) * FAMILY_SCALE)
    meal['dishCost'] = round(r.get('cost', 0) * FAMILY_SCALE)
    meal['costLabel'] = f"~{round(r.get('cost', 0) * FAMILY_SCALE):.0f} ₽"
    meal['portion'] = r.get('ingredients', '')

    # Update box if present
    if 'box' in meal:
        box = meal['box']
        box['title'] = new_dish
        box['recipeId'] = new_dish
        box['portion'] = r.get('ingredients', '')
        box['kcal'] = meal['kcal']
        box['cost'] = meal['cost']
        box['costLabel'] = meal['costLabel']
        box['recipeCost'] = r.get('cost', 0)
        box['recipeCostLabel'] = f"~{r.get('cost', 0):.0f} ₽"
        box['quality'] = r.get('quality', 'good')

        # Update ingredientBoxes from recipe if available
        if 'ingredientBoxes' in r:
            box['ingredientBoxes'] = r['ingredientBoxes']

# ── Update day titles ──────────────────────────────────────────────
for i, d in enumerate(new_plans):
    day_dishes = [meal['dish'] for meal in d['meals'].values()]
    day_cost = sum(meal['cost'] for meal in d['meals'].values())
    d['title'] = f"{day_dishes[0]} + {day_dishes[-1]} · ~{day_cost:.0f} ₽"

# ── Save ────────────────────────────────────────────────────────────
plans_data['plan'] = new_plans
(root / 'data' / 'plans.json').write_text(
    json.dumps(plans_data, ensure_ascii=False, indent=2),
    encoding='utf-8'
)

# ── Report ──────────────────────────────────────────────────────────
total_new = sum(meal['cost'] for d in new_plans for meal in d['meals'].values())
total_kcal = sum(meal.get('kcal', 0) for d in new_plans for meal in d['meals'].values())

all_dishes_new = set()
for d in new_plans:
    for mn, meal in d['meals'].items():
        all_dishes_new.add(meal['dish'])

print(f'=== DIVERSIFICATION COMPLETE ===')
print(f'Unique dishes: {len(all_dishes_new)} (was {len(plan_dishes)})')
print(f'Total cost: {total_new:.0f}₽ (limit 15000₽)')
print(f'Reserve: {15000 - total_new:.0f}₽')
print(f'Avg daily kcal: {total_kcal / 30:.0f}')
print(f'Avg daily protein: {sum(recipes[meal["dish"]].get("macros",{}).get("p",0) for d in new_plans for meal in d["meals"].values()) / 30:.0f}g')

# Show replacement summary
print(f'\n=== REPLACEMENTS ({len(replacement_map)} slots) ===')
for mn in ['Завтрак', 'Обед', 'Ужин', 'Полдник', 'Чай']:
    slots = replace_by_meal[mn]
    changed = [(idx, old, replacement_map[(idx, mn)]) for idx, mn, old in slots
               if replacement_map.get((idx, mn)) != old]
    kept = [(idx, old) for idx, mn, old in slots
            if replacement_map.get((idx, mn)) == old]
    print(f'\n--- {mn}: {len(changed)} changed, {len(kept)} kept ---')
    for idx, old, new in sorted(changed):
        r = recipes[new]
        print(f'  День {idx+1}: {old} → {new} [{r.get("type","?")}] {r.get("cost",0):.0f}₽')
