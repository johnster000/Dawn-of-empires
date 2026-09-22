/* Gathering spots, jam-free crowds and villager flight. Run: node tests/pathing.js */
const { launch } = require('./lib');
(async () => {
  const H = await launch(); const page = H.page; const fails = [];
  const check = (name, ok, info) => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fails.push(name); };
  await H.start({ enemies: 1, seedText: 'path-1', reveal: true, resources: 'huge' });

  // --- ten villagers sent to one tree: everyone ends up working, each on its own tile
  const many = await page.evaluate(() => {
    const p = Game.players[0], th = p.buildings('townhall')[0];
    for (let i = 0; i < 7; i++) Game.units.push(Ent.unit('villager', 0, th.x + 1.5, th.y + 1.5));
    const v = p.units('villager'); const tree = World.nearestResource('tree', th.x, th.y, 30);
    Game.select(v); Game.command({ res: tree, x: tree.x, y: tree.y }, false, null);
    for (let i = 0; i < 1200; i++) Game.tick(1 / 20);
    const tiles = new Set(), states = {};
    for (const u of p.units('villager')) { const o = u.order; const k = !o ? 'idle' : o.type === 'gather' ? 'gather:' + o.phase : o.type; states[k] = (states[k] || 0) + 1; if (o && o.type === 'gather' && o.phase === 'gathering') tiles.add(Math.floor(u.x) + ',' + Math.floor(u.y)); }
    const working = p.units('villager').filter((u) => u.order && u.order.type === 'gather').length;
    const trees = new Set(p.units('villager').filter((u) => u.order && u.order.res).map((u) => u.order.res.id));
    return { total: p.units('villager').length, working, idle: states.idle || 0, states, uniqueTiles: tiles.size, gathering: [...tiles].length, trees: trees.size, wood: Math.round(p.stats.gathered.wood) };
  });
  check('a crowd sent to one tree all find work', many.working === many.total && many.idle === 0, JSON.stringify(many));
  check('each worker stands on its own tile', many.uniqueTiles === many.gathering, JSON.stringify({ tiles: many.uniqueTiles }));
  check('they spill onto neighbouring trees', many.trees >= 3, 'trees used ' + many.trees);
  check('wood actually comes in', many.wood > 100, 'wood ' + many.wood);

  // --- nobody is jammed: every villager is either working or genuinely moving
  const jam = await page.evaluate(() => {
    const p = Game.players[0]; const before = p.units('villager').map((u) => [u.x, u.y]);
    for (let i = 0; i < 200; i++) Game.tick(1 / 20);
    const v = p.units('villager'); let stuckWalkers = 0;
    v.forEach((u, i) => { const o = u.order; const gathering = o && o.type === 'gather' && o.phase === 'gathering'; const moved = U.dist(u.x, u.y, before[i][0], before[i][1]); if (!gathering && moved < 0.2) stuckWalkers++; });
    return { stuckWalkers, total: v.length, jams: v.filter((u) => (u.jam || 0) > 1).length };
  });
  check('no villager is stuck in place', jam.stuckWalkers === 0, JSON.stringify(jam));

  // --- felling a tree moves its workers on rather than stranding them
  const fell = await page.evaluate(() => {
    const p = Game.players[0]; const u = p.units('villager').find((x) => x.order && x.order.res && x.order.phase === 'gathering'); const r = u.order.res; const id = r.id;
    r.amount = 1; for (let i = 0; i < 200; i++) Game.tick(1 / 20);
    return { gone: !!r.removed, stranded: p.units('villager').filter((x) => x.order && x.order.res && x.order.res.id === id && x.order.phase !== 'return').length, working: p.units('villager').filter((x) => x.order).length, total: p.units('villager').length };
  });
  check('workers move on when a tree is felled', fell.gone && fell.stranded === 0 && fell.working === fell.total, JSON.stringify(fell));

  // --- flight: an enemy horseman sends the nearest villagers running
  const flee = await page.evaluate(() => {
    const p = Game.players[0]; const v = p.units('villager').filter((u) => u.order && u.order.phase === 'gathering');
    const target = v[0]; const e = Ent.unit('horseman', 1, target.x + 2, target.y + 1); Game.units.push(e); Sim.setOrder(e, { type: 'move', x: Math.floor(target.x), y: Math.floor(target.y) });
    for (let i = 0; i < 40; i++) Game.tick(1 / 20);
    const running = p.units('villager').filter((u) => u.order && (u.order.type === 'flee' || u.order.type === 'garrison')).length;
    const d0 = U.dist(target.x, target.y, e.x, e.y);
    for (let i = 0; i < 100; i++) Game.tick(1 / 20);
    const inside = Game.buildings.reduce((a, b) => a + b.garrison.length, 0);
    const d1 = target.inside ? 99 : U.dist(target.x, target.y, e.x, e.y);
    Sim.kill(e, null);
    for (let i = 0; i < 40 * 8; i++) Game.tick(1 / 20);
    const back = p.units('villager').filter((u) => u.order && u.order.type === 'gather').length;
    return { running, inside, fledOrHid: d1 > d0 || inside > 0, back, stillInside: Game.buildings.reduce((a, b) => a + b.garrison.length, 0), total: p.units('villager').length };
  });
  check('villagers run from a soldier', flee.running > 0 && flee.fledOrHid, JSON.stringify(flee));
  check('and go back to work once it is gone', flee.stillInside === 0 && flee.back >= flee.total - 1, JSON.stringify(flee));

  // --- claims survive a save
  const saved = await page.evaluate(() => { const before = Game.units.filter((u) => u.order && u.order.spot).length; Save.importText(Save.exportText()); const after = Game.units.filter((u) => u.order && u.order.spot).length; const claims = Sim.claims.size; for (let i = 0; i < 100; i++) Game.tick(1 / 20); return { before, after, claims, working: Game.players[0].units('villager').filter((u) => u.order).length }; });
  check('claimed spots survive a save', saved.after === saved.before && saved.claims === saved.after, JSON.stringify(saved));

  await page.evaluate(() => { const th = Game.players[0].buildings('townhall')[0]; Renderer.cam.zoom = 1.25; Renderer.centerOn(th.x, th.y); });
  await page.waitForTimeout(200); await H.snap('pathing');
  console.log('ERRORS', H.errors.length ? H.errors.join('\n') : 'none');
  await H.close(); if (fails.length || H.errors.length) process.exit(1);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
