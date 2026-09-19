/* Bot-only simulation: every player is an AI. Prints the state of each empire every few minutes.
   Run: node tests/botsim.js [minutes] [difficulty] [terrain] */
const { launch } = require('./lib');
(async () => {
  const minutes = +(process.argv[2] || 20), difficulty = process.argv[3] || 'normal', terrain = process.argv[4] || 'meadow';
  const H = await launch();
  await H.start({ enemies: 2, difficulty, terrain, seedText: 'botsim', reveal: true });
  // make the human a bot too
  await H.page.evaluate(() => { const p = Game.players[0]; p.isAI = true; p.difficulty = Game.settings.difficulty; AI.create(p); });
  for (let m = 3; m <= minutes; m += 3) {
    await H.ff(180);
    const st = await H.page.evaluate(() => Game.players.map((p) => { const orders = {}; for (const u of p.units('villager')) { const k = !u.order ? 'idle' : u.order.type === 'gather' ? (u.order.res ? rk(u.order.res) : 'return') : u.order.type; orders[k] = (orders[k] || 0) + 1; } return `${p.name.padEnd(8)} age ${p.age} ${p.alive ? '' : 'DEAD'} res f${Math.round(p.res.food)} w${Math.round(p.res.wood)} s${Math.round(p.res.stone)} g${Math.round(p.res.gold)} | vill ${p.units('villager').length} ${JSON.stringify(orders)} | mil ${p.units().filter((u) => u.type !== 'villager').length} | bld ${p.buildings().map((b) => b.type.slice(0, 5) + (b.built ? '' : '*')).sort().join(' ')} | walls ${p.buildings().filter((b) => b.def.wall).length} | techs ${p.techs.size} | k${p.stats.kills} l${p.stats.losses} r${p.stats.razed}${p.ai && p.ai.attacking ? ' ATTACKING' : ''}${p.ai && p.ai.goal ? ' saving' : ''}`; }));
    console.log(`--- ${m} min ---`); for (const l of st) console.log(l);
    const over = await H.page.evaluate(() => Game.over); if (over) { console.log('GAME OVER'); break; }
  }
  await H.page.evaluate(() => { const p = Game.players[1]; const th = p.buildings('townhall')[0] || p.buildings()[0]; if (th) Renderer.centerOn(th.x, th.y); });
  await H.page.waitForTimeout(300); await H.snap('bot-base');
  console.log('ERRORS', H.errors.length ? H.errors.join('\n---\n') : 'none');
  await H.close();
  if (H.errors.length) process.exit(1);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
