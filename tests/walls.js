/* Walls: a staircase (diagonal) run joins corner to corner and seals; an L bend doesn't grow a diagonal.
   Run: node tests/walls.js */
const { launch } = require('./lib');
(async () => {
  const H = await launch();
  await H.start({ enemies: 1, seedText: 'walls', reveal: true, mapSize: 'large' });
  const ok = (name, pass, info) => console.log((pass ? 'ok   ' : 'FAIL ') + name, info ? JSON.stringify(info) : '');
  const r = await H.page.evaluate(() => {
    const ox = 30, oy = 30;
    for (let x = ox - 12; x < ox + 14; x++) for (let y = oy - 12; y < oy + 14; y++) { const i = World.idx(x, y); const r = World.resAt[i]; if (r) World.removeResource(r); World.tiles[i] = 0; const b = World.bld[i]; if (b) World.setBuilding(b, false); }
    const put = (x, y, t) => { const b = Ent.building(t || 'palisade', 0, x, y, true); World.setBuilding(b, true); Game.buildings.push(b); return b; };
    // a diagonal line right across the cleared square, plus an L-bend elsewhere
    const diag = []; for (let i = -11; i <= 12; i++) diag.push(put(ox + i, oy - i));
    const l1 = put(ox - 8, oy - 8), l2 = put(ox - 7, oy - 8), l3 = put(ox - 7, oy - 7);
    const masks = diag.slice(2, 5).map((b) => World.wallMask(b));
    const lMask = World.wallMask(l1), cMask = World.wallMask(l2);
    // enemy tries to cross from one side to the other within the square
    const path = U.astar(ox - 3, oy - 3, ox + 3, oy + 3, World.w, World.h, (x, y) => x > ox - 12 && x < ox + 13 && y > oy - 12 && y < oy + 13 && World.passable(x, y, 1), 4000);
    const own = U.astar(ox - 3, oy - 3, ox + 3, oy + 3, World.w, World.h, (x, y) => World.passable(x, y, 1), 20000);
    const bad = path ? path.filter(([x, y]) => World.bld[World.idx(x, y)]).map(([x, y]) => [x - ox, y - oy, World.bld[World.idx(x, y)].type]) : null;
    return { masks, lMask, cMask, crossed: !!path && path.length > 0 && path[path.length - 1][0] === ox + 3 && path[path.length - 1][1] === oy + 3, aroundLen: own ? own.length : null, path: path && path.map(([x, y]) => (x - ox) + ',' + (y - oy)).join(' '), bad };
  });
  ok('diagonal pieces join corner to corner', r.masks.every((m) => m === (16 | 64)), r);
  ok('an L bend does not add a diagonal', r.lMask === 1 && r.cMask === (4 | 2), r);
  ok('a diagonal wall cannot be slipped through', !r.crossed, r);
  console.log('ERRORS', H.errors.length ? H.errors.join('\n') : 'none');
  await H.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
