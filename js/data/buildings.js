/* Buildings. `size` is the footprint in tiles (square). `time` is villager-seconds to construct.
   `shape` picks a procedural drawing routine in the renderer. */
const BUILDINGS = {
  townhall:   { name: 'Town Hall',    size: 3, hp: 1500, armor: 3, cost: { wood: 350, stone: 150 }, time: 150, age: 2, shape: 'hall',
                desc: 'The heart of a settlement. Trains villagers, stores every resource and advances the age.',
                trains: ['villager'], techs: ['loom'], dropoff: ['food', 'wood', 'stone', 'gold'], pop: 5, sight: 8, ageUp: true },
  house:      { name: 'House',        size: 2, hp: 250,  armor: 1, cost: { wood: 30 }, time: 25, age: 0, shape: 'house',
                desc: 'Room for five more people.', pop: 5, sight: 3 },
  farm:       { name: 'Farm',         size: 2, hp: 120,  armor: 0, cost: { wood: 60 }, time: 20, age: 0, shape: 'farm', passable: true,
                desc: 'A tilled field. One villager works it for a steady trickle of food.', sight: 2, farm: true, farmAmount: 300 },
  granary:    { name: 'Granary',      size: 2, hp: 300,  armor: 1, cost: { wood: 100 }, time: 35, age: 0, shape: 'barn',
                desc: 'Drop-off point for food. Build it beside berries or farms.', dropoff: ['food'], sight: 4 },
  lumbercamp: { name: 'Lumber Camp',  size: 2, hp: 300,  armor: 1, cost: { wood: 100 }, time: 35, age: 0, shape: 'camp',
                desc: 'Drop-off point for wood. Build it at the edge of a forest.', dropoff: ['wood'], sight: 4 },
  miningcamp: { name: 'Mining Camp',  size: 2, hp: 300,  armor: 1, cost: { wood: 100 }, time: 35, age: 0, shape: 'camp',
                desc: 'Drop-off point for stone and gold. Build it beside a deposit.', dropoff: ['stone', 'gold'], sight: 4 },
  barracks:   { name: 'Barracks',     size: 3, hp: 700,  armor: 2, cost: { wood: 150 }, time: 50, age: 0, shape: 'longhouse',
                desc: 'Trains foot soldiers.', trains: ['spearman', 'swordsman'], sight: 5 },
  range:      { name: 'Archery Range', size: 3, hp: 600, armor: 2, cost: { wood: 150 }, time: 50, age: 1, shape: 'range',
                desc: 'Trains archers.', trains: ['archer', 'crossbow'], sight: 5 },
  stables:    { name: 'Stables',      size: 3, hp: 650,  armor: 2, cost: { wood: 150 }, time: 50, age: 1, shape: 'stables',
                desc: 'Trains mounted soldiers.', trains: ['horseman', 'knight'], sight: 5 },
  blacksmith: { name: 'Blacksmith',   size: 2, hp: 550,  armor: 2, cost: { wood: 120, stone: 40 }, time: 40, age: 1, shape: 'smithy',
                desc: 'Researches better weapons and armour for every soldier.', techs: ['forging1', 'forging2', 'forging3', 'fletch1', 'fletch2', 'fletch3', 'armor1', 'armor2', 'armor3'], sight: 4 },
  tower:      { name: 'Watchtower',   size: 1, hp: 450,  armor: 3, cost: { wood: 50, stone: 100 }, time: 40, age: 1, shape: 'tower',
                desc: 'Sees far and shoots arrows at anything hostile in range.', sight: 9, attack: { dmg: 6, range: 6, rate: 1.6, kind: 'arrow' } },
  library:    { name: 'Hall of Scholars', size: 3, hp: 650, armor: 2, cost: { wood: 200, stone: 100 }, time: 60, age: 2, shape: 'library',
                desc: 'Researches economic improvements.', techs: ['wheelbarrow', 'handcart', 'axes', 'saw', 'pick', 'shaft', 'crops', 'heavyplow', 'conscription'], sight: 5 },
  keep:       { name: 'Keep',         size: 2, hp: 1400, armor: 4, cost: { wood: 100, stone: 350 }, time: 90, age: 2, shape: 'keep',
                desc: 'A stout stone fortification with a long reach.', sight: 11, attack: { dmg: 14, range: 8, rate: 2.0, kind: 'arrow' } },
  workshop:   { name: 'Siege Workshop', size: 3, hp: 700, armor: 2, cost: { wood: 200, stone: 100 }, time: 60, age: 3, shape: 'workshop',
                desc: 'Builds catapults that make short work of buildings.', trains: ['catapult'], sight: 5 },
  monument:   { name: 'Monument',     size: 4, hp: 4000, armor: 5, cost: { wood: 600, stone: 1200, gold: 1000 }, time: 400, age: 3, shape: 'monument',
                desc: 'A wonder of the age. Finish it and hold it for five minutes to win.', sight: 6, monument: true },
};

/* Order buildings appear in the villager build menu. */
const BUILD_MENU = ['house', 'farm', 'granary', 'lumbercamp', 'miningcamp', 'barracks', 'range', 'stables', 'blacksmith', 'tower', 'library', 'keep', 'workshop', 'townhall', 'monument'];
