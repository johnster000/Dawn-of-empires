/* Work animation and phone dock check. Run: node tests/anim.js */
const { launch } = require('./lib');
(async () => {
  const H = await launch({ viewport: { width: 1280, height: 800 } }); const page = H.page;
  await H.start({ enemies: 1, seedText: 'anim-1', reveal: true, resources: 'high' });
  await page.evaluate(() => {
    const p = Game.players[0], th = p.buildings('townhall')[0], v = p.units('villager');
    const tree = World.nearestResource('tree', th.x, th.y, 30), stone = World.nearestResource('stone', th.x, th.y, 30);
    Sim.setOrder(v[0], { type: 'gather', res: tree }); Sim.setOrder(v[1], { type: 'gather', res: stone });
    // a farm right next to the town hall for the third villager to build then work
    for (let dx = -4; dx <= 6; dx++) for (let dy = -4; dy <= 6; dy++) { if (World.canPlace(BUILDINGS.farm, th.tx + dx, th.ty + dy)) { const b = Game.placeBuilding(p, 'farm', th.tx + dx, th.ty + dy); Sim.setOrder(v[2], { type: 'build', bld: b }); dx = 99; break; } }
  });
  await H.ff(12);
  const shots = async (name, who) => {
    for (let i = 0; i < 4; i++) {
      await page.evaluate((w) => { const p = Game.players[0]; const u = p.units('villager')[w]; Renderer.cam.zoom = 1.9; Renderer.centerOn(u.x, u.y - 0.4); document.getElementById('hud').hidden = true; for (let k = 0; k < 8; k++) Game.tick(1 / 20); Renderer.draw(0.016); }, who);
      await page.waitForTimeout(60); await H.snap(`anim-${name}-${i}`);
    }
  };
  await shots('chop', 0); await shots('mine', 1);
  await H.ff(30); await shots('farm', 2);
  const states = await page.evaluate(() => Game.players[0].units('villager').map((u) => (u.order ? u.order.type + ':' + (u.order.phase || '') + ':' + Renderer.unitPose(u).tool : 'idle') + ' anim=' + u.anim.toFixed(1)));
  console.log('STATES', JSON.stringify(states));
  // phone dock
  await page.setViewportSize({ width: 390, height: 780 }); await page.waitForTimeout(300);
  await page.evaluate(() => { document.getElementById('hud').hidden = false; const p = Game.players[0]; const th = p.buildings('townhall')[0]; Renderer.cam.zoom = 1; Renderer.centerOn(th.x, th.y); Game.select(p.units('villager')); Game.buildMenu = true; UI.refreshCommands(); });
  await page.waitForTimeout(300); await H.snap('anim-phone-build');
  await page.evaluate(() => { const p = Game.players[0]; Game.select([p.units('villager')[0]]); });
  await page.waitForTimeout(300); await H.snap('anim-phone-unit');
  console.log('ERRORS', H.errors.length ? H.errors.join('\n') : 'none');
  await H.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
