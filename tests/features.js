/* Feature checks: spacing, garrison and bell, walls and gates, save round trip. Run: node tests/features.js */
const { launch } = require('./lib');
(async () => {
  const H = await launch(); const page = H.page; const fails = [];
  const check = (name, ok, info) => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fails.push(name); };
  await H.start({ enemies: 1, seedText: 'feat-1', reveal: true, resources: 'huge' });
  // --- spacing: pile twelve villagers onto one tile and let them settle
  await page.evaluate(() => { const p = Game.players[0], th = p.buildings('townhall')[0]; for (let i = 0; i < 12; i++) Game.units.push(Ent.unit('villager', 0, th.x + 3.5, th.y + 0.5)); });
  await H.ff(6);
  const minD = await page.evaluate(() => { const us = Game.players[0].units(); let m = 9; for (const a of us) for (const b of us) if (a !== b) m = Math.min(m, U.dist(a.x, a.y, b.x, b.y)); return m; });
  check('units keep apart', minD > 0.35, 'min distance ' + minD.toFixed(2));
  // --- garrison: order five villagers into the town hall, ring the bell for the rest, then all clear
  const g1 = await page.evaluate(async () => { const p = Game.players[0], th = p.buildings('townhall')[0]; const v = p.units('villager'); Game.select(v.slice(0, 5)); Game.command({ bld: th, x: th.x, y: th.y }, false, null); for (let i = 0; i < 200; i++) Game.tick(1 / 20); return { inside: th.garrison.length, pop: p.pop(), outside: p.units('villager').length }; });
  check('villagers garrison in the town hall', g1.inside === 5, JSON.stringify(g1));
  const g2 = await page.evaluate(() => { const p = Game.players[0], th = p.buildings('townhall')[0]; const tree = World.nearestResource('tree', th.x, th.y, 30); for (const u of p.units('villager')) Sim.setOrder(u, { type: 'gather', res: tree }); Sim.ringBell(th); for (let i = 0; i < 400; i++) Game.tick(1 / 20); const inside = th.garrison.length; Sim.ringBell(th); for (let i = 0; i < 20; i++) Game.tick(1 / 20); return { inside, after: th.garrison.length, working: p.units('villager').filter((u) => u.order && u.order.type === 'gather').length, total: p.units('villager').length }; });
  check('town bell shelters then returns villagers', g2.inside >= 10 && g2.after === 0 && g2.working >= 5, JSON.stringify(g2));
  // --- walls: a run with a gate; the owner passes, the enemy does not
  const w = await page.evaluate(() => {
    const p = Game.players[0], th = p.buildings('townhall')[0]; const y = th.ty + 6; const line = Game.wallLine(th.tx - 3, y, th.tx + 6, y);
    let n = 0; for (const [x, yy] of line) if (World.canPlace(BUILDINGS.palisade, x, yy)) { const b = Game.placeBuilding(p, 'palisade', x, yy); if (b) { Sim.completeBuilding(b); n++; } }
    const gx = th.tx + 1; const gate = Game.placeBuilding(p, 'palisadegate', gx, y); if (gate) Sim.completeBuilding(gate);
    return { pieces: n, gate: !!gate, ownerPass: World.passable(gx, y, 0), enemyPass: World.passable(gx, y, 1), wallPass: World.passable(gx + 1, y, 0), mask: World.wallMask(World.bld[World.idx(gx + 1, y)]) };
  });
  check('wall run with a gate', w.pieces >= 7 && w.gate && w.ownerPass && !w.enemyPass && !w.wallPass && w.mask > 0, JSON.stringify(w));
  // --- attackers break through: ring the town hall completely, put an enemy outside, and watch it hit the wall
  const atk = await page.evaluate(() => {
    const p = Game.players[0], th = p.buildings('townhall')[0]; const x0 = th.tx - 4, y0 = th.ty - 4, x1 = th.tx + 6, y1 = th.ty + 6;
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) { if (x !== x0 && x !== x1 && y !== y0 && y !== y1) continue; const r = World.resAt[World.idx(x, y)]; if (r) World.removeResource(r); if (World.canPlace(BUILDINGS.palisade, x, y, true)) { const b = Game.placeBuilding(p, 'palisade', x, y); if (b) Sim.completeBuilding(b); } }
    const e = Ent.unit('spearman', 1, th.x, y1 + 3.5); Game.units.push(e); Sim.setOrder(e, { type: 'attack', target: th });
    for (let i = 0; i < 400; i++) Game.tick(1 / 20);
    return { target: e.order && e.order.target ? e.order.target.type : (e.order ? e.order.type : 'idle'), after: e.order && e.order.after ? e.order.after.type : null, hp: e.order && e.order.target ? Math.round(e.order.target.hp) : null };
  });
  check('blocked attacker hits the wall', (atk.target === 'palisade' || atk.target === 'palisadegate') && atk.after === 'townhall', JSON.stringify(atk));
  await H.snap('feat-walls');
  // --- save round trip (a few seconds first so anyone whose tree the ring test deleted has found another)
  await H.ff(30);
  const before = await page.evaluate(() => { const d = Save.serialize(); const txt = JSON.stringify(d); return { len: txt.length, units: Game.units.length, blds: Game.buildings.length, res: World.res.length, time: Math.round(Game.time), food: Math.round(Game.players[0].res.food), orders: Game.units.filter((u) => u.order).length, garrison: Game.buildings.reduce((a, b) => a + b.garrison.length, 0) }; });
  const after = await page.evaluate(() => { const txt = Save.exportText(); const r = Save.importText(txt); if (r.error) return { error: r.error }; return { units: Game.units.length, blds: Game.buildings.length, res: World.res.length, time: Math.round(Game.time), food: Math.round(Game.players[0].res.food), orders: Game.units.filter((u) => u.order).length, garrison: Game.buildings.reduce((a, b) => a + b.garrison.length, 0), farmsWorked: Game.buildings.filter((b) => b.def.farm && b.worker).length }; });
  console.log('SAVE', before.len, 'chars', JSON.stringify(before), '->', JSON.stringify(after));
  check('save round trip preserves the match', !after.error && after.units === before.units && after.blds === before.blds && after.res === before.res && after.time === before.time && after.food === before.food && after.garrison === before.garrison && after.orders === before.orders, '');
  await H.ff(60);
  const later = await page.evaluate(() => ({ units: Game.units.length, err: null, gathered: Math.round(Game.players[0].stats.gathered.wood) }));
  check('restored game keeps running', later.units > 0, JSON.stringify(later));
  // continue button on title after quit
  const cont = await page.evaluate(() => { Game.quit(); return { saved: Save.exists(), label: document.getElementById('btn-continue').textContent, hidden: document.getElementById('btn-continue').hidden }; });
  check('continue button appears after quitting', cont.saved && !cont.hidden && /Continue/.test(cont.label), JSON.stringify(cont));
  await H.snap('feat-title');
  console.log('ERRORS', H.errors.length ? H.errors.join('\n') : 'none');
  await H.close();
  if (fails.length || H.errors.length) process.exit(1);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
