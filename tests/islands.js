/* Islands and ships: map shape, docks, fishing boats, transports, galleys, saving. Run: node tests/islands.js */
const { launch } = require('./lib');
(async () => {
  const H = await launch();
  const ok = (name, pass, info) => { console.log((pass ? 'ok   ' : 'FAIL ') + name, info ? JSON.stringify(info) : ''); if (!pass) process.exitCode = 1; };
  await H.start({ enemies: 3, mapType: 'islands', mapSize: 'huge', seedText: 'isles', reveal: true });
  let r = await H.page.evaluate(() => {
    const regs = World.starts.map((s) => World.regionAt(s.x, s.y));
    const count = (kind, reg) => World.res.filter((x) => x.kind === kind && World.resRegion(x) === reg).length;
    const home = regs.map((g) => ({ gold: count('gold', g), stone: count('stone', g), trees: count('tree', g) }));
    const neutral = World.neutral.map((n) => World.regionAt(n.x, n.y)).filter((g) => g > 0 && !regs.includes(g));
    const richest = Math.max(0, ...neutral.map((g) => count('gold', g) + count('stone', g)));
    const deep = World.res.filter((x) => x.kind === 'fish' && World.isDeep(x.x, x.y)).length;
    return { regs, distinct: new Set(regs).size, home, neutral: neutral.length, richest, deep };
  });
  ok('every people has its own island', r.distinct === r.regs.length && r.regs.every((g) => g > 0), r);
  ok('home islands carry a little gold and stone, and wood', r.home.every((h) => h.gold >= 3 && h.gold <= 5 && h.stone >= 3 && h.stone <= 5 && h.trees > 40), r.home);
  ok('neutral isles hold the rich deposits', r.neutral >= 2 && r.richest >= 10, r);
  ok('there are fish out in open water', r.deep >= 20, r);
  await H.page.evaluate(() => { const s = World.starts[0]; Renderer.cam.zoom = 0.45; Renderer.centerOn(World.w / 2, World.h / 2); document.getElementById('hud').hidden = true; });
  await H.page.waitForTimeout(400); await H.snap('islands-overview');
  await H.page.evaluate(() => { document.getElementById('hud').hidden = false; });

  // a dock on the home shore, built and training boats
  r = await H.page.evaluate(() => {
    const p = Game.players[0], th = p.buildings('townhall')[0]; p.res.wood = p.res.food = p.res.gold = 5000; p.age = 1; Game.settings.popCap = 200; for (let k = 0; k < 3; k++) { const h = Ent.building('house', 0, 1, 1 + k * 2, true); Game.buildings.push(h); }
    let site = null, bd = Infinity;
    for (let x = th.tx - 20; x < th.tx + 20; x++) for (let y = th.ty - 20; y < th.ty + 20; y++) if (World.canPlace(BUILDINGS.dock, x, y)) { const d = U.dist2(x, y, th.x, th.y); if (d < bd) { bd = d; site = [x, y]; } }
    if (!site) return { site };
    const dock = Game.placeBuilding(p, 'dock', site[0], site[1]);
    const v = p.units('villager')[0]; Sim.setOrder(v, { type: 'build', bld: dock });
    return { site, id: dock.id };
  });
  ok('a dock fits on the home shore', !!r.site, r);
  await H.ff(80);
  r = await H.page.evaluate(() => {
    const p = Game.players[0], dock = p.buildings('dock')[0];
    for (const id of ['fishboat', 'transport', 'galley']) Sim.enqueue(dock, { kind: 'unit', id });
    return { built: dock.built };
  });
  ok('villagers build the dock from the shore', r.built, r);
  await H.ff(100);
  r = await H.page.evaluate(() => {
    const p = Game.players[0], ships = p.units().filter((u) => u.def.naval);
    return { types: ships.map((s) => s.type), onWater: ships.every((s) => World.tiles[World.idx(Math.floor(s.x), Math.floor(s.y))] === 1) };
  });
  ok('the dock launches boats onto the water', r.types.length === 3 && r.onWater, r);

  // fishing: a boat sent to deep fish brings food back to the dock
  r = await H.page.evaluate(() => {
    const p = Game.players[0], boat = p.units('fishboat')[0], dock = p.buildings('dock')[0];
    let best = null, bd = Infinity; for (const f of World.res) if (f.kind === 'fish' && f.amount > 0 && World.regionAt(f.x, f.y) === 0) {}
    for (const f of World.res) { if (f.kind !== 'fish' || f.amount <= 0 || !Sim.freeSpot(boat, f)) continue; const d = U.dist2(f.x, f.y, dock.x, dock.y); if (d < bd) { bd = d; best = f; } }
    Sim.assignGather(boat, best, null, 14); p.stats.gathered.food = 0;
    return { fish: best && [best.x, best.y], deep: best && World.isDeep(best.x, best.y) };
  });
  await H.ff(90);
  r = await H.page.evaluate(() => { const p = Game.players[0], boat = p.units('fishboat')[0]; return { food: Math.round(p.stats.gathered.food), order: boat.order && boat.order.type, phase: boat.order && boat.order.phase }; });
  ok('a fishing boat brings its catch home', r.food >= 20, r);

  // a transport carries soldiers to another island and lands them
  r = await H.page.evaluate(() => {
    const p = Game.players[0], ship = p.units('transport')[0], th = p.buildings('townhall')[0];
    const men = []; for (let i = 0; i < 5; i++) { const t = U.nearestTile(Math.floor(th.x) + 3, Math.floor(th.y) + 3 + i, 5, (x, y) => World.passable(x, y, 0) && !men.some((m) => Math.floor(m.x) === x && Math.floor(m.y) === y)); const u = Ent.unit('spearman', 0, t[0] + 0.5, t[1] + 0.5); Game.units.push(u); men.push(u); }
    Game.select(men); Game.command({ unit: ship, bld: null, res: null, x: ship.x, y: ship.y }, false, null);
    window._men = men.map((m) => m.id);
    return { orders: men.map((m) => m.order && m.order.type) };
  });
  ok('right-clicking a transport sends soldiers aboard', r.orders.every((o) => o === 'board'), r);
  await H.ff(40);
  r = await H.page.evaluate(() => { const ship = Game.players[0].units('transport')[0]; return { aboard: ship.cargo.length, pop: Game.players[0].pop() }; });
  ok('they walk to the shore and step aboard', r.aboard === 5, r);
  r = await H.page.evaluate(() => {
    const ship = Game.players[0].units('transport')[0], home = World.regionAt(ship.x + 1, ship.y) || World.regionAt(Game.players[0].buildings('townhall')[0].x, Game.players[0].buildings('townhall')[0].y);
    const isl = World.neutral.map((n) => ({ n, g: World.regionAt(n.x, n.y) })).filter((o) => o.g > 0).sort((a, b) => U.dist2(a.n.x, a.n.y, ship.x, ship.y) - U.dist2(b.n.x, b.n.y, ship.x, ship.y))[0];
    Game.select([ship]); Game.command({ unit: null, bld: null, res: null, x: isl.n.x + 0.5, y: isl.n.y + 0.5 }, false, null);
    window._isle = isl.g;
    return { order: ship.order && ship.order.type, isle: isl.g };
  });
  ok('right-clicking land with a laden transport sails to land them', r.order === 'unload', r);
  await H.ff(120);
  r = await H.page.evaluate(() => { const ship = Game.players[0].units('transport')[0]; const men = Game.units.filter((u) => window._men.includes(u.id)); return { aboard: ship.cargo.length, landed: men.length, onIsle: men.filter((m) => World.regionAt(m.x, m.y) === window._isle).length }; });
  ok('the soldiers come ashore on the other island', r.aboard === 0 && r.landed === 5 && r.onIsle === 5, r);

  // walking across the sea is refused politely
  r = await H.page.evaluate(() => { const men = Game.units.filter((u) => window._men.includes(u.id)); const th = Game.players[0].buildings('townhall')[0]; Game.select(men); Game.command({ unit: null, bld: null, res: null, x: th.x + 3, y: th.y + 3 }, false, null); return { orders: men.map((m) => m.order ? m.order.type : null) }; });
  ok('land units are not sent walking across the water', r.orders.every((o) => o === null), r);

  // a war galley sinks an enemy boat
  r = await H.page.evaluate(() => {
    const gal = Game.players[0].units('galley')[0]; const t = U.nearestTile(Math.floor(gal.x) + 3, Math.floor(gal.y), 6, (x, y) => World.sailable(x, y));
    const foe = Ent.unit('fishboat', 1, t[0] + 0.5, t[1] + 0.5); Game.units.push(foe); window._foe = foe.id;
    return { d: U.dist(gal.x, gal.y, foe.x, foe.y).toFixed(1) };
  });
  await H.ff(30);
  r = await H.page.evaluate(() => ({ sunk: !Game.units.some((u) => u.id === window._foe && !u.dead) }));
  ok('a galley on guard sinks an enemy boat', r.sunk, r);

  // save with passengers aboard
  r = await H.page.evaluate(() => {
    const ship = Game.players[0].units('transport')[0], men = Game.units.filter((u) => window._men.includes(u.id));
    for (const m of men.slice(0, 2)) Sim.embark(m, ship);
    const d = Save.serialize(); Save.restore(JSON.parse(JSON.stringify(d)));
    const s2 = Game.players[0].units('transport')[0];
    return { aboard: s2 ? s2.cargo.length : -1, mapType: Game.settings.mapType, regions: World.regionAt(World.starts[0].x, World.starts[0].y) > 0 };
  });
  ok('a save keeps the passengers aboard', r.aboard === 2 && r.mapType === 'islands' && r.regions, r);
  await H.page.evaluate(() => { const s = Game.players[0].units('transport')[0] || Game.players[0].units()[0]; document.getElementById('hud').hidden = true; Renderer.cam.zoom = 1.55; Renderer.centerOn(s.x, s.y); Game.select([]); });
  await H.page.waitForTimeout(400); await H.snap('islands-ships');
  console.log('ERRORS', H.errors.length ? H.errors.join('\n') : 'none');
  await H.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
