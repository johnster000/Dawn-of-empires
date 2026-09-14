/* Renders thumb.png (960x540): a developed Hearth Age town, no interface. Run: node tests/thumb.js */
const { launch } = require('./lib');
const path = require('path');
(async () => {
  const H = await launch({ viewport: { width: 960, height: 540 }, dpr: 1 });
  await H.start({ enemies: 2, difficulty: 'hard', terrain: 'meadow', seedText: 'thumb-3', reveal: true, popCap: 150 });
  await H.page.evaluate(() => { const p = Game.players[0]; p.isAI = true; p.difficulty = 'hard'; AI.create(p); });
  await H.ff(60 * 16);
  await H.page.evaluate(() => {
    const p = Game.players[0]; const th = p.buildings('townhall')[0] || p.buildings()[0];
    Renderer.cam.zoom = 1.25; Renderer.centerOn(th.x + 1.5, th.y - 1.5);
    document.getElementById('hud').hidden = true; Game.select([]);
    Renderer.draw(0.016);
  });
  await H.page.waitForTimeout(200);
  await H.page.screenshot({ path: path.join(__dirname, '..', 'thumb.png') });
  const st = await H.page.evaluate(() => Game.players.map((p) => p.name + ':' + p.age + ':' + p.buildings().length));
  console.log('thumb written', st.join(' '));
  await H.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
