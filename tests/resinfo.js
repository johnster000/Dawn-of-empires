/* Resource selection, hover highlight, info panel and the minimap frame. Run: node tests/resinfo.js */
const { launch } = require('./lib');
(async () => {
  const H = await launch({ viewport: { width: 1280, height: 800 } }); const page = H.page; const fails = [];
  const check = (n, ok, info) => { console.log((ok ? 'ok   ' : 'FAIL ') + n + (info ? '  ' + info : '')); if (!ok) fails.push(n); };
  await H.start({ enemies: 1, seedText: 'res-1', reveal: true });
  // put a known tree on screen and click it like a player would
  const at = await page.evaluate(() => {
    const th = Game.players[0].buildings('townhall')[0]; const tree = World.nearestResource('tree', th.x, th.y, 30);
    Renderer.cam.zoom = 1.25; Renderer.centerOn(tree.x, tree.y); Game.select([]); Renderer.draw(0.016);
    tree.amount = 62;
    const [sx, sy] = Renderer.toScreen(tree.x + 0.5 + tree.ox, tree.y + 0.5 + tree.oy, 0);
    return { sx, sy: sy - 18, id: tree.id, amount: tree.amount };
  });
  await page.mouse.move(at.sx, at.sy); await page.waitForTimeout(120);
  const hov = await page.evaluate(() => Renderer.hoverRes ? Renderer.hoverRes.id : null);
  check('hovering a tree marks it', hov === at.id, 'hover ' + hov + ' expected ' + at.id);
  await H.snap('res-hover');
  await page.mouse.click(at.sx, at.sy); await page.waitForTimeout(250);
  const sel = await page.evaluate(() => ({ id: Game.selectedRes ? Game.selectedRes.id : null, units: Game.selection.length, panel: document.getElementById('selpanel').innerText.replace(/\n+/g, ' | '), cmdHidden: document.getElementById('commands').hidden }));
  check('clicking selects it', sel.id === at.id && sel.units === 0, 'selected ' + sel.id);
  check('the panel says what is left', /62 \/ 100/.test(sel.panel) && /Loads left/.test(sel.panel), sel.panel.slice(0, 150));
  check('no command buttons for a resource', sel.cmdHidden, '');
  await H.snap('res-selected');
  // selecting a unit clears it; felling the tree clears it too
  const cleared = await page.evaluate(() => { Game.select(Game.players[0].units('villager').slice(0, 1)); return Game.selectedRes; });
  check('selecting a unit clears the resource', cleared === null, '');
  const gone = await page.evaluate(() => { const r = World.res.find((x) => x.id === Game.lastTreeId) || World.res[0]; Game.selectedRes = r; Game.select([]); Game.selectedRes = r; World.removeResource(r); UI.refreshSelection(); return { sel: Game.selectedRes, hidden: document.getElementById('selpanel').hidden }; });
  check('a felled tree stops being selected', gone.sel === null && gone.hidden, JSON.stringify(gone));
  // minimap: the diamond should fill its frame
  const mm = await page.evaluate(() => {
    const c = document.getElementById('minimap'); Renderer.drawMinimap();
    const g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height).data;
    let top = -1, bottom = -1;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) { const o = (y * c.width + x) * 4; if (d[o] + d[o + 1] + d[o + 2] > 60) { if (top < 0) top = y; bottom = y; } }
    return { w: c.width, h: c.height, cssW: c.clientWidth, cssH: c.clientHeight, top, bottom, fill: ((bottom - top) / c.height) };
  });
  check('the minimap fills its frame', mm.fill > 0.9 && Math.abs(mm.cssW / mm.cssH - 2) < 0.1, JSON.stringify(mm));
  // a click on the minimap still lands where you expect
  const jump = await page.evaluate(() => {
    const c = document.getElementById('minimap'), r = c.getBoundingClientRect();
    const mid = Renderer.miniToWorld(r.width / 2, r.height / 2);
    const left = Renderer.miniToWorld(4, r.height / 2), topc = Renderer.miniToWorld(r.width / 2, 2);
    return { mid: mid.map(Math.round), left: left.map(Math.round), top: topc.map(Math.round), w: World.w, h: World.h };
  });
  check('minimap clicks map to the right tiles', Math.abs(jump.mid[0] - jump.w / 2) < 4 && Math.abs(jump.mid[1] - jump.h / 2) < 4 && jump.top[0] < 6 && jump.top[1] < 6, JSON.stringify(jump));
  await H.page.evaluate(() => { document.getElementById('hud').hidden = false; });
  await H.snap('res-minimap');
  console.log('ERRORS', H.errors.length ? H.errors.join('\n') : 'none');
  await H.close(); if (fails.length || H.errors.length) process.exit(1);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
