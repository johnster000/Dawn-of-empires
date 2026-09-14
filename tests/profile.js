/* Where does frame time go? Wraps renderer stages with timers on a busy map. Run: node tests/profile.js */
const { launch } = require('./lib');
(async () => {
  const H = await launch({ viewport: { width: 1920, height: 1080 } });
  await H.start({ enemies: 5, difficulty: 'hard', mapSize: 'large', seedText: 'perf', reveal: false });
  await H.page.evaluate(() => { const p = Game.players[0]; p.isAI = true; p.difficulty = 'hard'; AI.create(p); });
  await H.ff(60 * 20);
  const r = await H.page.evaluate(() => {
    const p = Game.players[1]; const th = p.buildings('townhall')[0] || p.buildings()[0]; if (th) Renderer.centerOn(th.x, th.y);
    Game.settings.reveal = true; World.updateFog(0, true); Renderer.fogDirty = true;
    const T = {}; const wrap = (name) => { const f = Renderer[name]; Renderer[name] = function (...a) { const t = performance.now(); const r = f.apply(this, a); T[name] = (T[name] || 0) + performance.now() - t; return r; }; };
    ['drawGround', 'drawResource', 'drawBuilding', 'drawUnit', 'drawEffect', 'drawMapImage', 'drawMinimap', 'drawUnitBar', 'drawBuildingBar'].forEach(wrap);
    const out = {};
    for (const z of [1, 0.45, 2]) {
      Renderer.cam.zoom = z; for (const k in T) T[k] = 0;
      const n = 20; const t0 = performance.now(); for (let i = 0; i < n; i++) Renderer.draw(1 / 60); const total = (performance.now() - t0) / n;
      const counts = { res: 0, bld: 0, unit: 0 }; const v = Renderer.view; for (const r of World.res) if (r.x >= v.x0 && r.x <= v.x1 && r.y >= v.y0 && r.y <= v.y1) counts.res++; for (const b of Game.buildings) if (b.x >= v.x0 && b.x <= v.x1 && b.y >= v.y0 && b.y <= v.y1) counts.bld++; for (const u of Game.units) if (u.x >= v.x0 && u.x <= v.x1 && u.y >= v.y0 && u.y <= v.y1) counts.unit++;
      out['zoom ' + z] = { total: total.toFixed(1), counts, stages: Object.fromEntries(Object.entries(T).map(([k, v]) => [k, (v / n).toFixed(2)])) };
    }
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
  await H.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
