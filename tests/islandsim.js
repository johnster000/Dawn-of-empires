/* Bots on an islands map: docks, boats, colonies on the neutral isles, and seaborne attacks.
   Run: node tests/islandsim.js [minutes] [difficulty] */
const { launch } = require('./lib');
(async () => {
  const minutes = +(process.argv[2] || 30), difficulty = process.argv[3] || 'hard';
  const H = await launch();
  await H.start({ enemies: 2, difficulty, mapType: 'islands', mapSize: 'large', seedText: 'islandsim', reveal: true });
  await H.page.evaluate(() => { const p = Game.players[0]; p.isAI = true; p.difficulty = Game.settings.difficulty; AI.create(p); });
  let landedEver = 0, colonyEver = 0, tickMs = 0;
  for (let m = 3; m <= minutes; m += 3) {
    const t0 = Date.now();
    for (let k = 0; k < 18; k++) { await H.ff(10); const n = await H.page.evaluate(() => Math.max(0, ...Game.players.map((p) => { const hr = p.ai.home ? World.regionAt(p.ai.home.x, p.ai.home.y) : 0; return p.units().filter((u) => !u.def.naval && u.type !== 'villager' && Game.players.some((q) => q !== p && q.ai.home && World.regionAt(q.ai.home.x, q.ai.home.y) === World.regionAt(u.x, u.y))).length; }))); landedEver = Math.max(landedEver, n); }
    tickMs = (Date.now() - t0) / (180 * 20);
    const st = await H.page.evaluate(() => Game.players.map((p) => {
      const home = p.ai.home, hr = home ? World.regionAt(home.x, home.y) : 0;
      const away = p.units().filter((u) => !u.def.naval && World.regionAt(u.x, u.y) !== hr);
      const onEnemy = away.filter((u) => Game.players.some((q) => q !== p && q.ai.home && World.regionAt(q.ai.home.x, q.ai.home.y) === World.regionAt(u.x, u.y)));
      return { name: p.name, age: p.age, alive: p.alive, vill: p.units('villager').length, mil: p.units().filter((u) => u.type !== 'villager' && !u.def.naval).length,
        docks: p.buildings('dock').filter((b) => b.built).length, boats: p.units('fishboat').length, galleys: p.units('galley').length, trans: p.units('transport').length,
        colonists: away.filter((u) => u.type === 'villager').length, colOrders: away.filter((u) => u.type === 'villager').map((u) => u.order ? u.order.type + (u.order.res ? ':' + (u.order.res.kind || 'b') : '') : 'idle').join(','), raiders: onEnemy.length, invasion: p.ai.invasion ? p.ai.invasion.phase : '', colony: p.ai.colony ? p.ai.colony.phase : '',
        res: `f${Math.round(p.res.food)} w${Math.round(p.res.wood)} s${Math.round(p.res.stone)} g${Math.round(p.res.gold)}`, k: p.stats.kills, l: p.stats.losses, r: p.stats.razed, fish: Math.round(p.stats.gathered.food) };
    }));
    console.log(`--- ${m} min (tick ${tickMs.toFixed(2)} ms) ---`);
    for (const s of st) { console.log(JSON.stringify(s)); colonyEver = Math.max(colonyEver, s.colonists); }
    if (await H.page.evaluate(() => Game.over)) { console.log('GAME OVER'); break; }
  }
  console.log('SUMMARY raiders-landed-max', landedEver, 'colonists-max', colonyEver);
  console.log('ERRORS', H.errors.length ? H.errors.join('\n---\n') : 'none');
  await H.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
