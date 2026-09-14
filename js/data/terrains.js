/* Terrain types: palette plus generation knobs. All art is drawn procedurally from these colours. */
const TERRAINS = {
  meadow: {
    name: 'Meadow', blurb: 'Rolling green, oak forests and gentle lakes. The classic start.',
    ground: ['#5f8f3f', '#6d9c48', '#7ba854', '#88b25e'], shore: '#c9b77a', shoreDark: '#a89860',
    water: '#3b78a6', waterDeep: '#2b5f8a', waterLight: '#63a3cc',
    canopy: ['#3c7a33', '#4b8a3a', '#5c9a45', '#6da752'], canopyDark: '#2c5a26', trunk: '#6b4a2a',
    rock: '#8e8e8a', rockDark: '#66665f', gold: '#d8ad3a', berry: '#c73d5c', bush: '#3e7f36',
    treeShape: 'oak', treeDensity: 1.0, waterLevel: 0.33, stone: 1.0, goldOre: 1.0, berries: 1.0, roughness: 1.0,
  },
  desert: {
    name: 'Desert', blurb: 'Sun-baked sand, sparse palms and rich gold veins around scattered oases.',
    ground: ['#c9ad6a', '#d4ba75', '#dcc684', '#e3d093'], shore: '#e8dbb0', shoreDark: '#c7b88a',
    water: '#3f8fb0', waterDeep: '#2f7091', waterLight: '#74bcd6',
    canopy: ['#5d8b3d', '#6d9a48', '#7fa855', '#8fb35e'], canopyDark: '#446a2b', trunk: '#8a6a3c',
    rock: '#a8916a', rockDark: '#7a6748', gold: '#e2b53a', berry: '#c95a2e', bush: '#6a8a3a',
    treeShape: 'palm', treeDensity: 0.45, waterLevel: 0.22, stone: 0.9, goldOre: 1.5, berries: 0.7, roughness: 0.6,
  },
  tundra: {
    name: 'Tundra', blurb: 'Snowfields and black pines around frozen lakes. Stone is plentiful; food is not.',
    ground: ['#d3dade', '#dde3e7', '#e6ebee', '#eef2f4'], shore: '#b9c3c9', shoreDark: '#95a2ab',
    water: '#5f8fa8', waterDeep: '#476f86', waterLight: '#9cc2d3',
    canopy: ['#2e4f3a', '#375c44', '#40694e', '#4b7658'], canopyDark: '#1f3829', trunk: '#4a3626',
    rock: '#7d858b', rockDark: '#565d63', gold: '#d9b043', berry: '#9c3e6e', bush: '#4a6a4e',
    treeShape: 'pine', treeDensity: 0.85, waterLevel: 0.3, stone: 1.5, goldOre: 0.8, berries: 0.6, roughness: 0.9,
  },
  highlands: {
    name: 'Highlands', blurb: 'Heather moors broken by crags and many small lochs. Chokepoints everywhere.',
    ground: ['#6f7f4a', '#7c8c52', '#88985a', '#94a262'], shore: '#a89d6e', shoreDark: '#877d55',
    water: '#41708f', waterDeep: '#30566f', waterLight: '#6f9db8',
    canopy: ['#3f6a3a', '#4b7843', '#58864d', '#659357'], canopyDark: '#2c4c29', trunk: '#5c4630',
    rock: '#7f7f78', rockDark: '#585851', gold: '#d2aa3c', berry: '#b84a8a', bush: '#4b7a42',
    treeShape: 'oak', treeDensity: 0.75, waterLevel: 0.42, stone: 1.4, goldOre: 1.0, berries: 0.9, roughness: 1.3,
  },
};

const MAP_SIZES = { small: { w: 64, h: 64, name: 'Small' }, medium: { w: 88, h: 88, name: 'Medium' }, large: { w: 112, h: 112, name: 'Large' } };
