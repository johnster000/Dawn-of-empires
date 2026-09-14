/* Frame-time check on a large, busy map. Run: node tests/perf.js */
const { launch } = require('./lib');
(async () => {
  const H = await launch({ viewport: { width: 1920, height: 1080 } });
  await H.start({ enemies: 5, difficulty: 'hard', mapSize: 'large', seedText: 'perf', reveal: true });
  await H.page.evaluate(() => { const p = Game.players[0]; p.isAI = true; p.difficulty = 'hard'; AI.create(p); });
  const t0 = Date.now(); await H.ff(60 * 20); const simMs = Date.now() - t0;
  const r = await H.page.evaluate(() => {
    const p = Game.players[1]; const th = p.buildings('townhall')[0] || p.buildings()[0]; if (th) Renderer.centerOn(th.x, th.y);
    const n = 30; let t = performance.now(); for (let i = 0; i < n; i++) Renderer.draw(1 / 60); const draw = (performance.now() - t) / n;
    t = performance.now(); for (let i = 0; i < 20; i++) Game.tick(1 / 20); const tick = (performance.now() - t) / 20;
    Renderer.cam.zoom = 0.45; t = performance.now(); for (let i = 0; i < n; i++) Renderer.draw(1 / 60); const drawFar = (performance.now() - t) / n;
    return { units: Game.units.length, buildings: Game.buildings.length, res: World.res.length, drawMs: draw.toFixed(2), drawFarMs: drawFar.toFixed(2), tickMs: tick.toFixed(2), time: Math.round(Game.time) };
  });
  console.log('PERF', JSON.stringify(r), 'sim 20 game-minutes took', simMs, 'ms');
  await H.snap('perf-far');
  console.log('ERRORS', H.errors.length ? H.errors.join('\n---\n') : 'none');
  await H.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
