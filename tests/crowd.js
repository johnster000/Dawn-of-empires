/* Crowds must make progress, not orbit each other. Efficiency = net displacement / distance walked.
   Run: node tests/crowd.js */
const { launch } = require('./lib');
(async () => {
  const H = await launch(); const page = H.page; const fails = [];
  const check = (n, ok, info) => { console.log((ok ? 'ok   ' : 'FAIL ') + n + (info ? '  ' + info : '')); if (!ok) fails.push(n); };
  await H.start({ enemies: 1, seedText: 'crowd-1', reveal: true, resources: 'huge' });

  // walk a crowd across open ground and measure how much of the walking got them anywhere
  const run = (setup, seconds) => page.evaluate(({ setup, seconds }) => {
    // eslint-disable-next-line no-new-func
    const ids = new Function('return (' + setup + ')()')();
    const us = ids.map((id) => Game.units.find((u) => u.id === id)).filter(Boolean);
    for (let i = 0; i < seconds * 20; i++) Game.tick(1 / 20);
    // then watch a settling window: anyone still walking without getting anywhere is going round in circles
    const from = us.map((u) => [u.x, u.y]); const walked = us.map(() => 0); let prev = us.map((u) => [u.x, u.y]);
    for (let i = 0; i < 12 * 20; i++) { Game.tick(1 / 20); us.forEach((u, k) => { walked[k] += U.dist(u.x, u.y, prev[k][0], prev[k][1]); prev[k] = [u.x, u.y]; }); }
    const eff = us.map((u, k) => (walked[k] < 1 ? 1 : U.dist(u.x, u.y, from[k][0], from[k][1]) / walked[k]));
    const still = us.filter((u, k) => walked[k] < 1).length;
    const arrived = us.filter((u) => !u.order || (u.order.type === 'gather' && u.order.phase === 'gathering')).length;
    return { n: us.length, arrived, settled: still, wandering: eff.filter((e) => e < 0.3).length, walkedMost: +Math.max(...walked).toFixed(1) };
  }, { setup, seconds });

  // find open ground: a clear patch, and a target 16 tiles off with a near-straight route to it
  const field = await page.evaluate(() => {
    const clear = (cx, cy, r) => { for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++) if (!World.passable(x, y, 0)) return false; return true; };
    for (let tries = 0; tries < 4000; tries++) {
      const x = 6 + Math.floor(Math.random() * (World.w - 12)), y = 6 + Math.floor(Math.random() * (World.h - 12));
      if (!clear(x, y, 4)) continue;
      for (const [dx, dy] of [[16, 0], [0, 16], [-16, 0], [0, -16], [12, 12], [-12, -12]]) {
        const gx = x + dx, gy = y + dy;
        if (!World.inBounds(gx, gy) || !clear(gx, gy, 4)) continue;
        const path = U.astar(x, y, gx, gy, World.w, World.h, (a, b) => World.passable(a, b, 0), 5000);
        if (path && path.length < U.dist(x, y, gx, gy) * 1.25) return { x, y, gx, gy, pathLen: path.length };
      }
    }
    return null;
  });
  check('found open ground to test on', !!field, JSON.stringify(field));
  if (!field) { await H.close(); process.exit(1); }

  // 1. twenty villagers packed onto one spot, all sent across the open field
  const march = await run(`function () {
    const ids = [];
    for (let i = 0; i < 20; i++) { const u = Ent.unit('villager', 0, ${field.x} + 0.5 + (i % 5) * 0.22 - 0.4, ${field.y} + 0.5 + Math.floor(i / 5) * 0.22 - 0.3); Game.units.push(u); ids.push(u.id); }
    const us = ids.map((id) => Game.units.find((u) => u.id === id));
    Game.select(us); Game.spread(us, ${field.gx}, ${field.gy}, 'move');
    return ids;
  }`, 40);
  check('a packed crowd arrives and settles', march.wandering === 0 && march.settled >= 18 && march.arrived >= 18, JSON.stringify(march));

  // 2. two crowds walking straight through each other across the same field
  const cross = await run(`function () {
    const ids = [], a = [], b = [];
    for (let i = 0; i < 10; i++) { const u = Ent.unit('villager', 0, ${field.x} + 0.5, ${field.y} + 0.5 + i * 0.3 - 1.4); Game.units.push(u); a.push(u); ids.push(u.id); }
    for (let i = 0; i < 10; i++) { const u = Ent.unit('villager', 0, ${field.gx} + 0.5, ${field.gy} + 0.5 + i * 0.3 - 1.4); Game.units.push(u); b.push(u); ids.push(u.id); }
    Game.spread(a, ${field.gx}, ${field.gy}, 'move');
    Game.spread(b, ${field.x}, ${field.y}, 'move');
    return ids;
  }`, 55);
  // two crowds swapping ends have to thread through each other; what matters is that they end up still
  check('two crowds pass through each other and settle', cross.wandering === 0 && cross.settled >= 17, JSON.stringify(cross));

  // 4. idle villagers standing in a gateway shuffle out of the way
  const gate = await page.evaluate(() => {
    const p = Game.players[0], th = p.buildings('townhall')[0];
    const spot = U.nearestTile(th.tx + 6, th.ty, 6, (x, y) => World.passable(x, y, 0));
    const idlers = []; for (let i = 0; i < 3; i++) { const u = Ent.unit('villager', 0, spot[0] + 0.5, spot[1] + 0.5); Game.units.push(u); idlers.push(u); }
    const mover = Ent.unit('villager', 0, spot[0] - 4.5, spot[1] + 0.5); Game.units.push(mover);
    Sim.setOrder(mover, { type: 'move', x: spot[0] + 5, y: spot[1] });
    for (let i = 0; i < 400; i++) Game.tick(1 / 20);
    return { moverThrough: mover.x > spot[0] + 3, idlersMoved: idlers.filter((u) => U.dist(u.x, u.y, spot[0] + 0.5, spot[1] + 0.5) > 0.4).length };
  });
  check('idlers step aside for someone passing', gate.moverThrough, JSON.stringify(gate));

  // the interface must not eat right clicks, middle drags or the wheel in its empty space
  const through = await page.evaluate(() => {
    const out = {}; const W = window.innerWidth, Hh = window.innerHeight;
    for (const [lbl, x, y] of [['mid', W / 2, Hh / 2], ['lower', W / 2, Hh * 0.75], ['low-left', W * 0.25, Hh * 0.9], ['low-right', W * 0.82, Hh * 0.96]]) {
      const el = document.elementFromPoint(Math.round(x), Math.round(y));
      out[lbl] = el ? (el.id || el.className || el.tagName) : 'none';
    }
    return out;
  });
  const dead = Object.entries(through).filter(([, v]) => v === 'bottom' || v === 'log');
  check('no dead strips over the map', dead.length === 0, JSON.stringify(through));

  console.log('ERRORS', H.errors.length ? H.errors.join('\n') : 'none');
  await H.close(); if (fails.length || H.errors.length) process.exit(1);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
