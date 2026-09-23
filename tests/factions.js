/* Peoples: choice and random draw, bonuses, unique warriors, bots training theirs, saving. Run: node tests/factions.js */
const { launch } = require('./lib');
(async () => {
  const H = await launch();
  const ok = (name, pass, info) => { console.log((pass ? 'ok   ' : 'FAIL ') + name, info ? JSON.stringify(info) : ''); if (!pass) process.exitCode = 1; };
  await H.start({ enemies: 5, faction: 'gauls', seedText: 'peoples', reveal: true });
  let r = await H.page.evaluate(() => ({ f: Game.players.map((p) => p.faction), farm: Game.players[0].mods.farmYield }));
  ok('you lead the people you chose; five bots all differ', r.f[0] === 'gauls' && new Set(r.f).size === 6, r);
  ok('the Gaulish farm bonus applies', Math.abs(r.farm - 0.15) < 1e-9, r);

  r = await H.page.evaluate(() => {
    const p = Game.players[0]; p.age = 1; p.res.food = p.res.gold = p.res.wood = 5000;
    const th = p.buildings('townhall')[0]; const b = Ent.building('barracks', 0, th.tx + 5, th.ty, true); World.setBuilding(b, true); Game.buildings.push(b);
    Game.select([b]); UI.refreshCommands();
    const labels = [...document.querySelectorAll('#commands button .lbl')].map((x) => x.textContent);
    const bad = Sim.enqueue(b, { kind: 'unit', id: 'praetorian' }), good = Sim.enqueue(b, { kind: 'unit', id: 'gaesatae' });
    return { labels, bad, good: good || 'queued', q: b.queue.map((q) => q.id) };
  });
  ok('the barracks offers your warrior and nobody else’s', r.labels.some((l) => /Gaesatae/.test(l)) && !r.labels.some((l) => /Praetorian|Hirdman|Phalangite/.test(l)), r);
  ok('another people’s warrior cannot be queued', /Only the Romans/.test(r.bad) && r.q.includes('gaesatae') && !r.q.includes('praetorian'), r);

  r = await H.page.evaluate(() => {
    const p = Game.players[1]; p.age = 1; p.res.food = p.res.gold = p.res.wood = 5000;
    const th = p.buildings('townhall')[0]; const uu = FACTIONS[p.faction].unique, from = UNITS[uu].from;
    const b = Ent.building(from, 1, th.tx + 5, th.ty, true); World.setBuilding(b, true); Game.buildings.push(b);
    for (let i = 0; i < 12; i++) Game.units.push(Ent.unit('villager', 1, th.x + 2, th.y + 2 + i * 0.1));
    for (const h of [0, 1, 2, 3]) { const hb = Ent.building('house', 1, th.tx - 3, th.ty + h * 2, true); World.setBuilding(hb, true); Game.buildings.push(hb); }
    const seen = new Set(); for (let i = 0; i < 20; i++) { AI.trainMilitary(p, p.ai); for (const q of b.queue) seen.add(q.id); b.queue.length = 0; }
    return { faction: p.faction, uu, seen: [...seen] };
  });
  ok('a bot trains its own unique warrior', r.seen.includes(r.uu), r);

  r = await H.page.evaluate(() => { const before = Game.players.map((p) => p.faction); const d = Save.serialize(); Save.restore(JSON.parse(JSON.stringify(d))); return { before, after: Game.players.map((p) => p.faction), farm: Game.players[0].mods.farmYield }; });
  ok('peoples survive a save', JSON.stringify(r.before) === JSON.stringify(r.after) && Math.abs(r.farm - 0.15) < 1e-9, r);

  await H.start({ enemies: 1, faction: 'random', seedText: 'peoples-2', reveal: true });
  r = await H.page.evaluate(() => Game.players.map((p) => FACTIONS[p.faction] ? p.faction : null));
  ok('random draws a real people', r.every(Boolean) && r[0] !== r[1], r);

  // line-up of the six warriors for a look
  await H.page.evaluate(() => {
    const th = Game.players[0].buildings('townhall')[0], ox = th.tx + 4, oy = th.ty + 4;
    for (let x = ox - 2; x < ox + 9; x++) for (let y = oy - 2; y < oy + 5; y++) { const i = World.idx(x, y); const r = World.resAt[i]; if (r) World.removeResource(r); }
    Game.players[0].age = 2;
    ['praetorian', 'steppearcher', 'hirdman', 'medjay', 'gaesatae', 'phalangite', 'swordsman', 'spearman'].forEach((t, i) => { const u = Ent.unit(t, 0, ox + i * 0.9, oy + 1.5); u.face = 0.3; Game.units.push(u); });
    Game.select([]); document.getElementById('hud').hidden = true; Renderer.cam.zoom = 1.9; Renderer.centerOn(ox + 3.5, oy + 1);
  });
  await H.page.waitForTimeout(400); await H.snap('factions-lineup');
  console.log('ERRORS', H.errors.length ? H.errors.join('\n') : 'none');
  await H.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
