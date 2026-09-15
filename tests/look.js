/* Quick art check: start screen close-up, a forest edge, and a mid-game AI town. Run: node tests/look.js */
const { launch } = require('./lib');
(async () => {
  const H = await launch({ viewport: { width: 1280, height: 800 } });
  await H.start({ enemies: 2, seedText: 'look-2', reveal: true });
  await H.page.evaluate(() => { const th = Game.players[0].buildings('townhall')[0]; Renderer.cam.zoom = 1.25; Renderer.centerOn(th.x, th.y); Game.select([]); document.getElementById('hud').hidden = true; });
  await H.page.waitForTimeout(400); await H.snap('look-start');
  await H.page.evaluate(() => { const p = Game.players[0]; p.isAI = true; p.difficulty = 'hard'; AI.create(p); for (const q of Game.players.slice(1)) q.difficulty = 'hard'; });
  await H.ff(60 * 14);
  await H.page.evaluate(() => { const th = Game.players[1].buildings('townhall')[0] || Game.players[1].buildings()[0]; Renderer.cam.zoom = 1; Renderer.centerOn(th.x, th.y); });
  await H.page.waitForTimeout(400); await H.snap('look-town');
  await H.page.evaluate(() => { const u = Game.units.find((x) => x.type !== 'villager') || Game.units[0]; Renderer.cam.zoom = 1.9; Renderer.centerOn(u.x, u.y); });
  await H.page.waitForTimeout(400); await H.snap('look-units');
  console.log('ERRORS', H.errors.length ? H.errors.join('\n') : 'none');
  await H.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
