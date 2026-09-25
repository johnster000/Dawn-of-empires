/* Zoom cost: frame time on the first frame after each zoom step, and while stepping back and forth, on a busy
   town at phone resolution (dpr 3). Run: node tests/zoomperf.js */
const { launch } = require('./lib');
(async () => {
  const H = await launch({ viewport: { width: 400, height: 800 }, dpr: 3 });
  await H.start({ enemies: 3, difficulty: 'hard', mapSize: 'normal', seedText: 'zoomperf', reveal: true });
  await H.page.evaluate(() => { const p = Game.players[0]; p.isAI = true; p.difficulty = 'hard'; AI.create(p); for (const q of Game.players) q.age = Math.max(q.age, 0); });
  await H.ff(60 * 16);
  const r = await H.page.evaluate(() => {
    const p = Game.players[1]; const th = p.buildings('townhall')[0] || p.buildings()[0]; if (th) Renderer.centerOn(th.x, th.y);
    Renderer.sprites.clear(); Renderer.cam.zoom = 1; Renderer.draw(1 / 60);
    const flush = () => Renderer.g.getImageData(0, 0, 1, 1); // make the GPU finish each frame so it is timed on its own
    const time = (f) => { flush(); const t = performance.now(); f(); flush(); return performance.now() - t; };
    const firsts = [];
    for (const z of Renderer.ZOOMS) { Renderer.cam.zoom = z; firsts.push(+time(() => Renderer.draw(1 / 60)).toFixed(1)); }
    // steady stepping: in and out repeatedly, as a pinch does
    let worst = 0, total = 0, n = 0;
    for (let rep = 0; rep < 4; rep++) for (const z of [...Renderer.ZOOMS, ...Renderer.ZOOMS.slice().reverse()]) { Renderer.cam.zoom = z; const t = time(() => Renderer.draw(1 / 60)); worst = Math.max(worst, t); total += t; n++; }
    // animation churn at one zoom: units walking and working make new frames
    Renderer.cam.zoom = 1; let anim = 0; for (let i = 0; i < 60; i++) { Game.tick(1 / 20); anim += time(() => Renderer.draw(1 / 60)); }
    return { units: Game.units.length, buildings: Game.buildings.length, sprites: Renderer.sprites.size, firstFrameMs: firsts, stepAvgMs: +(total / n).toFixed(2), stepWorstMs: +worst.toFixed(1), animAvgMs: +(anim / 60).toFixed(2) };
  });
  console.log('ZOOM', JSON.stringify(r));
  const errs = H.errors.filter((e) => !/willReadFrequently/.test(e)); // our own per-frame readback, not the game
  console.log('ERRORS', errs.length ? errs.join('\n') : 'none');
  await H.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
