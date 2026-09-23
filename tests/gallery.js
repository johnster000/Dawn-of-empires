/* Building gallery: one of every building on cleared ground, per age, plus a wall ring with a diagonal run.
   Run: node tests/gallery.js [age]   (shots/gallery-age<N>.png) */
const { launch } = require('./lib');
(async () => {
  const H = await launch({ viewport: { width: 1400, height: 900 } });
  await H.start({ enemies: 1, seedText: 'gallery', reveal: true, mapSize: 'large' });
  const ages = process.argv[2] != null ? [+process.argv[2]] : [0, 1, 2, 3];
  for (const age of ages) {
    await H.page.evaluate((age) => {
      for (const b of Game.buildings.slice()) if (b.owner === 0) { World.setBuilding(b, false); Game.buildings.splice(Game.buildings.indexOf(b), 1); }
      for (const u of Game.units) u.x = u.y = 1.5;
      const ox = 20, oy = 20;
      for (let x = ox - 2; x < ox + 30; x++) for (let y = oy - 2; y < oy + 24; y++) { const i = World.idx(x, y); const r = World.resAt[i]; if (r) World.removeResource(r); World.tiles[i] = 0; }
      const types = Object.keys(BUILDINGS).filter((t) => !BUILDINGS[t].wall);
      let x = ox, y = oy, rowH = 0;
      for (const t of types) {
        const s = BUILDINGS[t].size; if (x + s > ox + 22) { x = ox; y += rowH + 2; rowH = 0; }
        const b = Ent.building(t, 0, x, y, true); b.ageVisual = age; World.setBuilding(b, true); Game.buildings.push(b);
        x += s + 2; rowH = Math.max(rowH, s);
      }
      // a wall: straight run, a corner, a diagonal and a gate
      const wy = y + rowH + 3, wall = age >= 2 ? 'stonewall' : 'palisade', gate = age >= 2 ? 'stonegate' : 'palisadegate';
      const pts = []; for (let i = 0; i < 6; i++) pts.push([ox + i, wy]); for (let i = 1; i < 4; i++) pts.push([ox + 5, wy + i]); for (let i = 1; i < 5; i++) pts.push([ox + 5 + i, wy + 3 + i]);
      for (let i = 0; i < 5; i++) pts.push([ox + 12 + i, wy]);
      pts.forEach(([a, c], i) => { const b = Ent.building(i === 2 ? gate : wall, 0, a, c, true); b.ageVisual = age; World.setBuilding(b, true); Game.buildings.push(b); });
      World.markShores(); Renderer.prepareMap(); Game.select([]); document.getElementById('hud').hidden = true;
      Renderer.cam.zoom = 0.85; Renderer.centerOn(ox + 11, oy + 12);
    }, age);
    await H.page.waitForTimeout(400); await H.snap('gallery-age' + age);
    await H.page.evaluate(() => { Renderer.cam.zoom = 1.55; Renderer.centerOn(26, 24); }); await H.page.waitForTimeout(300); await H.snap('gallery-zoom-age' + age);
    await H.page.evaluate(() => { Renderer.cam.zoom = 1.55; Renderer.centerOn(28, 38); }); await H.page.waitForTimeout(300); await H.snap('gallery-walls-age' + age);
  }
  console.log('ERRORS', H.errors.length ? H.errors.join('\n') : 'none');
  await H.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
