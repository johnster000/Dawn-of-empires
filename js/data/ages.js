/* The four ages. Each one changes the look of every building (roof / wall palette) and unlocks new
   buildings, units and technologies. Names are our own — no borrowed lore. */
const AGES = [
  { id: 'dawn',   name: 'Dawn Age',   numeral: 'I',   blurb: 'A handful of settlers, thatch roofs and stone tools.',
    roof: '#a88a48', roofDark: '#7d6530', wall: '#8f7048', wallDark: '#6a5236', trim: '#5a4630', wallMat: 'plank', roofMat: 'thatch',
    advance: null },
  { id: 'hearth', name: 'Hearth Age', numeral: 'II',  blurb: 'Plastered walls, shingle roofs, the first archers and riders.',
    roof: '#6f4c30', roofDark: '#4d3320', wall: '#cdb994', wallDark: '#a3906e', trim: '#4f3823', wallMat: 'plaster', roofMat: 'shingle',
    advance: { cost: { food: 400 }, time: 60, need: ['granary', 'lumbercamp', 'miningcamp', 'barracks', 'farm'], needCount: 2 } },
  { id: 'forge',  name: 'Forge Age',  numeral: 'III', blurb: 'Stone walls, red tile roofs, iron and heavy cavalry.',
    roof: '#9a4029', roofDark: '#6e2b1c', wall: '#8f887d', wallDark: '#675f56', trim: '#433d38', wallMat: 'stone', roofMat: 'tile',
    advance: { cost: { food: 800, gold: 200 }, time: 90, need: ['range', 'stables', 'blacksmith', 'tower'], needCount: 2 } },
  { id: 'empire', name: 'Empire Age', numeral: 'IV',  blurb: 'Pale stone, slate and gold. Siege engines and monuments.',
    roof: '#465a7c', roofDark: '#2f3e57', wall: '#d2cbbd', wallDark: '#a8a092', trim: '#b8963f', wallMat: 'ashlar', roofMat: 'slate',
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
