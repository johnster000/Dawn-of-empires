/* Bot age pace: the same bots-only map at each pace setting, noting when each bot reaches each age.
   Run: node tests/pace.js [minutes] [difficulty] */
const { launch } = require('./lib');
(async () => {
  const minutes = +(process.argv[2] || 30), difficulty = process.argv[3] || 'normal';
  const out = {};
  for (const pace of ['chill', 'normal', 'aggressive']) {
    const H = await launch();
    await H.start({ enemies: 2, difficulty, pace, temper: 'chill', seedText: 'pace', reveal: true });
    await H.page.evaluate(() => { const p = Game.players[0]; p.isAI = true; p.difficulty = Game.settings.difficulty; AI.create(p); window._reach = Game.players.map(() => [0]); });
    for (let s = 0; s < minutes * 6; s++) {
      await H.ff(10);
      await H.page.evaluate(() => Game.players.forEach((p, i) => { const r = window._reach[i]; while (r.length <= p.age) r.push(Math.round(Game.time / 60 * 10) / 10); }));
    }
    out[pace] = await H.page.evaluate(() => window._reach);
    if (H.errors.length) console.log(pace, 'ERRORS', H.errors.join('\n'));
    await H.close();
  }
  const avg = (rows, a) => { const v = rows.map((r) => r[a]).filter((x) => x != null); return v.length ? (v.reduce((s, x) => s + x, 0) / v.length).toFixed(1) + (v.length < rows.length ? ` (${v.length}/${rows.length})` : '') : '—'; };
  for (const pace in out) { console.log(pace.padEnd(11), 'minutes to reach Hearth / Forge / Empire:', [1, 2, 3].map((a) => avg(out[pace], a)).join(' / ')); console.log('            each bot:', JSON.stringify(out[pace].map((r) => r.slice(1)))); }
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
