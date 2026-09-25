/* A mid-range tablet: 1280x800 CSS px at 2x (2560x1600 backbuffer), CPU slowed 4x. Plays a live game with villagers
   walking and a building selected, and reports frames per second and where the main thread's time goes.
   Run: node tests/tabletperf.js [seconds] [--profile] */
const { launch } = require('./lib');
(async () => {
  const secs = +(process.argv[2] || 6), wantProfile = process.argv.includes('--profile');
  const H = await launch({ viewport: { width: 1280, height: 800 }, dpr: 2 });
  const cdp = await H.page.context().newCDPSession(H.page);
  await H.start({ enemies: 2, difficulty: 'normal', seedText: 'tablet', mapSize: 'medium' });
  // a working town: a few minutes in, then select the town hall and give the villagers errands
  await H.page.evaluate(() => { const p = Game.players[0]; p.isAI = true; p.difficulty = 'normal'; AI.create(p); });
  await H.ff(60 * 6);
  await H.page.evaluate(() => { const p = Game.players[0]; p.isAI = false; p.ai = null; const th = p.buildings('townhall')[0]; Renderer.cam.zoom = 1; Renderer.centerOn(th.x, th.y); Game.select([th]); });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Performance.enable');
  const m0 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  if (wantProfile) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }
  await H.page.evaluate(() => { window._frames = []; let last = performance.now(); const tick = (t) => { window._frames.push(t - last); last = t; if (window._frames.length < 100000) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  // tap through the menus while it runs, the way a player does
  for (let i = 0; i < secs * 2; i++) { await H.page.waitForTimeout(500); await H.page.evaluate((i) => { const p = Game.players[0]; if (i % 2) Game.select(p.units('villager').slice(0, 4)); else Game.select([p.buildings('townhall')[0]]); UI.selDirty = UI.cmdDirty = true; }, i); }
  const m1 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  const fr = await H.page.evaluate(() => { const f = window._frames.slice(5).sort((a, b) => a - b); return { n: f.length, median: f[f.length >> 1], p90: f[Math.floor(f.length * 0.9)], worst: f[f.length - 1] }; });
  const d = (k) => ((m1[k] - m0[k]) * 1000 / (m1.Timestamp - m0.Timestamp) / 10).toFixed(1) + '%';
  console.log('frames', fr.n, 'fps', (fr.n / secs).toFixed(1), 'frame ms median', fr.median.toFixed(1), 'p90', fr.p90.toFixed(1), 'worst', fr.worst.toFixed(1));
  console.log('main thread busy: script', d('ScriptDuration'), 'style', d('RecalcStyleDuration'), 'layout', d('LayoutDuration'), 'task total', d('TaskDuration'), '| layouts', m1.LayoutCount - m0.LayoutCount, 'style recalcs', m1.RecalcStyleCount - m0.RecalcStyleCount, 'nodes', m1.Nodes);
  if (wantProfile) {
    const { profile } = await cdp.send('Profiler.stop');
    const self = new Map(), byId = new Map(profile.nodes.map((n) => [n.id, n]));
    const dt = profile.timeDeltas; const counts = new Map(); profile.samples.forEach((id, i) => counts.set(id, (counts.get(id) || 0) + (dt[i] || 0)));
    for (const [id, us] of counts) { const n = byId.get(id), cf = n.callFrame, k = (cf.functionName || '(anon)') + ' ' + cf.url.split('/').pop() + ':' + (cf.lineNumber + 1); self.set(k, (self.get(k) || 0) + us); }
    const total = [...self.values()].reduce((a, b) => a + b, 0);
    console.log('top self time:'); for (const [k, us] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 22)) console.log(((us / total) * 100).toFixed(1).padStart(5) + '%  ' + k);
  }
  console.log('ERRORS', H.errors.length ? H.errors.join('\n') : 'none');
  await H.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
