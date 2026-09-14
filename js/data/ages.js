/* The four ages. Each one changes the look of every building (roof / wall palette) and unlocks new
   buildings, units and technologies. Names are our own — no borrowed lore. */
const AGES = [
  { id: 'dawn',   name: 'Dawn Age',   numeral: 'I',   blurb: 'A handful of settlers, thatch roofs and stone tools.',
    roof: '#b99b4d', roofDark: '#8d7233', wall: '#a07f56', wallDark: '#7a5f3e', trim: '#6b5333',
    advance: null },
  { id: 'hearth', name: 'Hearth Age', numeral: 'II',  blurb: 'Plastered walls, shingle roofs, the first archers and riders.',
    roof: '#7c5636', roofDark: '#563a24', wall: '#dcc9a3', wallDark: '#b09d7a', trim: '#5b4128',
    advance: { cost: { food: 400 }, time: 60, need: ['granary', 'lumbercamp', 'miningcamp', 'barracks', 'farm'], needCount: 2 } },
  { id: 'forge',  name: 'Forge Age',  numeral: 'III', blurb: 'Stone walls, red tile roofs, iron and heavy cavalry.',
    roof: '#a8452f', roofDark: '#7a2f20', wall: '#9d958b', wallDark: '#726b62', trim: '#4a4440',
    advance: { cost: { food: 800, gold: 200 }, time: 90, need: ['range', 'stables', 'blacksmith', 'tower'], needCount: 2 } },
  { id: 'empire', name: 'Empire Age', numeral: 'IV',  blurb: 'Pale stone, slate and gold. Siege engines and monuments.',
    roof: '#4d6489', roofDark: '#33445f', wall: '#e2dbcd', wallDark: '#b5ad9e', trim: '#c9a54a',
    advance: { cost: { food: 1000, gold: 700 }, time: 120, need: ['library', 'keep', 'blacksmith', 'tower'], needCount: 2 } },
];

/* Player colours: a warm, readable set that survives fog-of-war dimming. */
const PLAYER_COLORS = [
  { id: 'blue',   name: 'Blue',   main: '#3d6fc4', dark: '#264a8a', light: '#8fb3ec' },
  { id: 'red',    name: 'Red',    main: '#c9403a', dark: '#862823', light: '#ef8f88' },
  { id: 'gold',   name: 'Gold',   main: '#d0a02e', dark: '#8d6b1b', light: '#f0d47f' },
  { id: 'green',  name: 'Green',  main: '#4f9a4a', dark: '#2f6a2c', light: '#98d391' },
  { id: 'purple', name: 'Purple', main: '#8a5bb8', dark: '#5b3a7f', light: '#c5a1e6' },
  { id: 'teal',   name: 'Teal',   main: '#3d9fa3', dark: '#276a6d', light: '#8fd7da' },
];

const RESOURCES = ['food', 'wood', 'stone', 'gold'];
const RESOURCE_INFO = {
  food:  { name: 'Food',  color: '#d0603a', desc: 'Berries, farms and hunting. Feeds villagers and soldiers.' },
  wood:  { name: 'Wood',  color: '#8c6a3c', desc: 'Felled from forests. Builds nearly everything.' },
  stone: { name: 'Stone', color: '#9aa0a8', desc: 'Quarried from outcrops. Towers, keeps and monuments.' },
  gold:  { name: 'Gold',  color: '#e0b43c', desc: 'Mined from veins. Advanced soldiers and technologies.' },
};
