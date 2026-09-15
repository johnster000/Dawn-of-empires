/* Terrain types: palette plus generation knobs. All art is drawn procedurally from these colours. */
const TERRAINS = {
  meadow: {
    name: 'Meadow', blurb: 'Rolling green, oak forests and gentle lakes. The classic start.',
    ground: ['#7a9140', '#86a049', '#92ab51', '#9cb45a'], dirt: '#c3aa72', shore: '#d4c18b', shoreDark: '#b39f6c',
    water: '#2f6390', waterDeep: '#244d74', waterLight: '#5d8fb8',
    canopy: ['#2f6229', '#376e31', '#3f7a38', '#478440'], canopyDark: '#22421d', trunk: '#5a3f24',
    rock: '#7f7c74', rockDark: '#57544d', gold: '#c99a2c', berry: '#a8323f', bush: '#33652b',
    treeShape: 'oak', treeDensity: 1.0, waterLevel: 0.33, stone: 1.0, goldOre: 1.0, berries: 1.0, roughness: 1.0,
  },
  desert: {
    name: 'Desert', blurb: 'Sun-baked sand, sparse palms and rich gold veins around scattered oases.',
    ground: ['#b89a5a', '#c2a563', '#cbaf6d', '#d2b877'], dirt: '#9a7f4c', shore: '#d8c896', shoreDark: '#b3a071',
    water: '#357a9a', waterDeep: '#285f7a', waterLight: '#6aa8c4',
    canopy: ['#4f7a34', '#5b8a3d', '#679645', '#72a04c'], canopyDark: '#3a5a26', trunk: '#7a5a34',
    rock: '#968060', rockDark: '#6a5940', gold: '#cfa22f', berry: '#b34f2a', bush: '#5c7a33',
    treeShape: 'palm', treeDensity: 0.45, waterLevel: 0.22, stone: 0.9, goldOre: 1.5, berries: 0.7, roughness: 0.6,
  },
  tundra: {
    name: 'Tundra', blurb: 'Snowfields and black pines around frozen lakes. Stone is plentiful; food is not.',
    ground: ['#c3ccd1', '#ccd4d8', '#d5dcdf', '#dde3e6'], dirt: '#8f8a7a', shore: '#a7b1b7', shoreDark: '#86929a',
    water: '#4f7d95', waterDeep: '#3b6075', waterLight: '#8db3c5',
    canopy: ['#27432f', '#2e4f38', '#365b40', '#3f6749'], canopyDark: '#1a2f21', trunk: '#3f2e20',
    rock: '#6f777d', rockDark: '#4c5358', gold: '#c9a23a', berry: '#8c3560', bush: '#3f5c42',
    treeShape: 'pine', treeDensity: 0.85, waterLevel: 0.3, stone: 1.5, goldOre: 0.8, berries: 0.6, roughness: 0.9,
  },
  highlands: {
    name: 'Highlands', blurb: 'Heather moors broken by crags and many small lochs. Chokepoints everywhere.',
    ground: ['#6f7f42', '#7a8a4a', '#849351', '#8e9c58'], dirt: '#a68f5e', shore: '#b5a473', shoreDark: '#94855a',
    water: '#39627e', waterDeep: '#2a4a60', waterLight: '#648ea8',
    canopy: ['#33552f', '#3d6237', '#476e3f', '#527947'], canopyDark: '#243f22', trunk: '#4e3a28',
    rock: '#726f66', rockDark: '#4d4a43', gold: '#c59d33', berry: '#a3427a', bush: '#3f6538',
    treeShape: 'oak', treeDensity: 0.75, waterLevel: 0.42, stone: 1.4, goldOre: 1.0, berries: 0.9, roughness: 1.3,
  },
};

const MAP_SIZES = { small: { w: 64, h: 64, name: 'Small' }, medium: { w: 88, h: 88, name: 'Medium' }, large: { w: 112, h: 112, name: 'Large' } };
