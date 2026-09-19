/* Do the bots wall up, ring the bell under attack, and repair? Run: node tests/aiwalls.js */
const { launch } = require('./lib');
(async () => {
  const H = await launch(); const page = H.page; const fails = [];
  const check = (name, ok, info) => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fails.push(name); };
  await H.start({ enemies: 1, difficulty: 'hard', seedText: 'aiwall-2', reveal: true });
  await H.ff(60 * 15);
  const w = await page.evaluate(() => { const p = Game.players[1]; return { walls: p.buildings().filter((b) => b.def.wall && !b.def.gate).length, built: p.buildings().filter((b) => b.def.wall && b.built).length, gates: p.buildings().filter((b) => b.def.gate).length, open: (() => { const r = p.ai.ring; if (!r) return -1; let n = 0; for (let x = r.x0; x <= r.x1; x++) for (let y = r.y0; y <= r.y1; y++) { if (x !== r.x0 && x !== r.x1 && y !== r.y0 && y !== r.y1) continue; if (World.open(x, y)) n++; } return n; })(), ring: p.ai.ring, gateTiles: p.ai.gateTiles, vill: p.units('villager').length, age: p.age, orders: p.units('villager').map((u) => u.order ? u.order.type : 'idle').join(',') }; });
  check('hard bot walls every open tile of its ring, gates first', w.ring && w.open <= 2 && w.gates >= 2 && w.built >= 10, JSON.stringify(w).slice(0, 300));
  // raid: drop six enemy horsemen beside the bot's town hall
  const bell = await page.evaluate(() => { const p = Game.players[1], th = p.buildings('townhall')[0]; for (let i = 0; i < 6; i++) { const e = Ent.unit('horseman', 0, th.x + 5 + i * 0.4, th.y + 5); Game.units.push(e); Sim.setOrder(e, { type: 'attack', target: th }); } for (let i = 0; i < 80; i++) Game.tick(1 / 20); const rung = th.bell, inside = th.garrison.length; for (const e of Game.units) if (e.owner === 0 && e.type === 'horseman') Sim.kill(e, null); for (let i = 0; i < 400; i++) Game.tick(1 / 20); return { rung, inside, after: th.bell, out: p.units('villager').length, working: p.units('villager').filter((u) => u.order).length }; });
  check('bell rings under a raid and clears afterwards', bell.rung && bell.inside >= 4 && !bell.after && bell.working >= bell.out * 0.6, JSON.stringify(bell));
  const rep = await page.evaluate(() => { const p = Game.players[1]; const h = p.buildings('house').find((b) => b.built); h.hp = 60; for (let i = 0; i < 100; i++) Game.tick(1 / 20); return { hp: Math.round(h.hp), repairing: p.units('villager').some((u) => u.order && u.order.type === 'build' && u.order.bld === h) }; });
  check('bot repairs a damaged house', rep.repairing || rep.hp > 60, JSON.stringify(rep));
  await page.evaluate(() => { const th = Game.players[1].buildings('townhall')[0]; Renderer.cam.zoom = 0.7; Renderer.centerOn(th.x, th.y); Renderer.draw(0.016); });
  await page.waitForTimeout(200); await H.snap('aiwalls');
  console.log('ERRORS', H.errors.length ? H.errors.join('\n') : 'none');
  await H.close(); if (fails.length || H.errors.length) process.exit(1);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
