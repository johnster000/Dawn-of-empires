/* Building art check: each building in every age it can appear in, side by side, close up.
   Run: node tests/buildings.js [type ...]   (shots/bld-<type>.png) */
const { launch } = require('./lib');
const ALL = ['townhall', 'house', 'granary', 'lumbercamp', 'miningcamp', 'barracks', 'range', 'stables', 'blacksmith', 'tower', 'library', 'keep', 'workshop', 'monument', 'dock'];
(async () => {
  const types = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
  const H = await launch({ viewport: { width: 1280, height: 520 } });
  await H.start({ enemies: 1, seedText: 'bld-gallery', reveal: true, mapSize: 'large', mapType: 'land' });
  for (const type of types) {
    await H.page.evaluate((type) => {
      Game.checkVictory = () => {}; for (const b of Game.buildings.slice()) { World.setBuilding(b, false); } Game.buildings.length = 0; for (const u of Game.units) u.dead = true; Game.units.length = 0;
      const def = BUILDINGS[type], s = def.size, ages = [0, 1, 2, 3].filter((a) => a >= def.age), gap = s + 2, ox = 30, oy = 30;
      const water = !!def.water;
      for (let x = ox - 4; x < ox + gap * 4 + 4; x++) for (let y = oy - 6; y < oy + s + 6; y++) { const i = World.idx(x, y); const r = World.resAt[i]; if (r) World.removeResource(r); World.tiles[i] = water && y >= oy - 1 ? 1 : 0; }
      World.decals = World.decals.filter((d) => !(d.x > ox - 5 && d.x < ox + gap * 4 + 5 && d.y > oy - 7 && d.y < oy + s + 7));
      ages.forEach((a, i) => { const b = Ent.building(type, 0, ox + i * gap, oy, true); b.ageVisual = a; World.setBuilding(b, true); Game.buildings.push(b); });
      World.markShores(); Renderer.prepareMap(); Renderer.sprites.clear(); Game.select([]); document.getElementById('hud').hidden = true;
      Renderer.cam.zoom = s >= 4 ? 1 : s >= 3 ? 1.25 : 1.55; Renderer.centerOn(ox + (ages.length * gap - 2) / 2, oy + s / 2 - (s >= 3 ? 1.6 : 1.1));
    }, type);
    await H.page.waitForTimeout(250); await H.snap('bld-' + type);
  }
  console.log('ERRORS', H.errors.length ? H.errors.join('\n') : 'none');
  await H.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
