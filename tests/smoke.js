/* Playwright smoke test: loads the game, starts a match, fast-forwards the simulation and reports
   console errors. Run: node tests/smoke.js  (serves the folder itself on :8791) */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html'; const f = path.join(root, p); fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(d); }); });
const PORT = 8791;
const fastForward = async (page, seconds) => page.evaluate((s) => { const n = Math.round(s / (1 / 20)); for (let i = 0; i < n; i++) Game.tick(1 / 20); }, seconds);
const snap = async (page, name) => page.screenshot({ path: path.join(__dirname, 'shots', name + '.png') });
const errors = [];
(async () => {
  fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message + '\n' + (e.stack || '')));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  await page.goto(`http://localhost:${PORT}/index.html`); await page.waitForTimeout(500);
  await snap(page, '01-title');
  await page.click('#btn-new'); await page.waitForTimeout(200); await snap(page, '02-setup');
  await page.selectOption('#set-enemies', '2'); await page.fill('#set-seed', 'smoke-1');
  await page.click('#btn-begin'); await page.waitForTimeout(600);
  await snap(page, '03-start');
  const start = await page.evaluate(() => ({ w: World.w, h: World.h, res: World.res.length, units: Game.units.length, buildings: Game.buildings.length, starts: World.starts, players: Game.players.map((p) => p.name) }));
  console.log('START', JSON.stringify(start));
  // Human: send villagers to work via the same command path the mouse uses
  await page.evaluate(() => {
    const p = Game.players[0], th = p.buildings('townhall')[0];
    const vill = p.units('villager');
    const tree = World.nearestResource('tree', th.x, th.y, 30), berry = World.nearestResource('berry', th.x, th.y, 30);
    Game.select([vill[0], vill[1]]); Game.command({ res: tree, x: tree.x, y: tree.y }, false, null);
    Game.select([vill[2]]); Game.command({ res: berry, x: berry.x, y: berry.y }, false, null);
    Game.select([th]); Game.train([th], { kind: 'unit', id: 'villager' }); Game.train([th], { kind: 'unit', id: 'villager' });
  });
  await fastForward(page, 60);
  await page.waitForTimeout(300); await snap(page, '04-one-minute');
  const t1 = await page.evaluate(() => { const p = Game.players[0]; return { res: p.res, pop: p.pop(), gathered: p.stats.gathered, orders: p.units().map((u) => u.order ? u.order.type + (u.order.phase ? ':' + u.order.phase : '') : 'idle') }; });
  console.log('T+60', JSON.stringify(t1));
  // Place a house and a barracks with the villagers
  await page.evaluate(() => {
    const p = Game.players[0], th = p.buildings('townhall')[0];
    const vill = p.units('villager'); Game.select(vill);
    Game.startPlacing('house');
    let placed = false;
    for (let dx = -3; dx <= 4 && !placed; dx++) for (let dy = -3; dy <= 4 && !placed; dy++) { const tx = th.tx + dx, ty = th.ty + dy; if (World.canPlace(BUILDINGS.house, tx, ty)) { Game.placing.tx = tx; Game.placing.ty = ty; Game.placing.ok = true; const [sx, sy] = Renderer.toScreen(tx + 1, ty + 1, 0); Game.placeAt(sx, sy, false); placed = true; } }
  });
  await fastForward(page, 90); await page.waitForTimeout(300); await snap(page, '05-building');
  const t2 = await page.evaluate(() => { const p = Game.players[0]; return { res: p.res, pop: p.pop(), cap: p.popCap(), buildings: p.buildings().map((b) => b.type + (b.built ? '' : ':' + Math.round(b.progress * 100) + '%')), villagers: p.units('villager').length }; });
  console.log('T+150', JSON.stringify(t2));
  // Real mouse interaction: click a villager, right-click a tree, box-select, hotkey, minimap
  const mouseCheck = await page.evaluate(() => {
    Game.select([]); const p = Game.players[0]; const th = p.buildings('townhall')[0]; Renderer.cam.zoom = 1; Renderer.centerOn(th.x, th.y);
    Renderer.draw(0); // refresh screen positions
    const v = p.units('villager').find((u) => u.sx > 60 && u.sx < Renderer.W - 60 && u.sy > 80 && u.sy < Renderer.H - 220);
    const tree = World.nearestResource('tree', th.x, th.y, 30); const ts = Renderer.toScreen(tree.x + 0.5, tree.y + 0.5, 0);
    return { v: v ? [v.sx, v.sy - v.sh / 2, v.id] : null, tree: ts, treeId: tree.id };
  });
  console.log('MOUSE-SETUP', JSON.stringify(mouseCheck));
  if (mouseCheck.v) {
    await page.mouse.click(mouseCheck.v[0], mouseCheck.v[1]); await page.waitForTimeout(100);
    const sel1 = await page.evaluate(() => Game.selection.map((s) => s.kind + ':' + s.type + ':' + s.id));
    await page.mouse.click(mouseCheck.tree[0], mouseCheck.tree[1] - 10, { button: 'right' }); await page.waitForTimeout(100);
    const ord = await page.evaluate(() => Game.selection.map((s) => s.order ? s.order.type + ':' + (s.order.res ? s.order.res.id : '') : 'none'));
    console.log('MOUSE-SELECT', JSON.stringify(sel1), 'ORDER', JSON.stringify(ord), 'expected tree', mouseCheck.treeId);
    if (!sel1.length || !sel1[0].startsWith('unit:villager') || ord[0] !== 'gather:' + mouseCheck.treeId) errors.push('mouse select/command failed: ' + JSON.stringify({ sel1, ord }));
  } else errors.push('no villager on screen for mouse test');
  // box select over the whole town centre
  const c = await page.evaluate(() => { const th = Game.players[0].buildings('townhall')[0]; return Renderer.toScreen(th.x, th.y, 0); });
  await page.mouse.move(c[0] - 260, c[1] - 200); await page.mouse.down(); await page.mouse.move(c[0] + 260, c[1] + 160, { steps: 5 }); await page.mouse.up(); await page.waitForTimeout(100);
  const box = await page.evaluate(() => Game.selection.length + ' units: ' + Game.selection.map((s) => s.type).join(','));
  console.log('BOX', box);
  // hotkey: Q opens the build menu with villagers selected, then W (farm) enters placing
  await page.keyboard.press('q'); await page.waitForTimeout(80); await page.keyboard.press('w'); await page.waitForTimeout(80);
  const placing = await page.evaluate(() => Game.placing ? Game.placing.type : null); console.log('PLACING', placing);
  if (placing !== 'farm') errors.push('hotkey placement failed: ' + placing);
  await page.keyboard.press('Escape'); await page.waitForTimeout(50);
  // minimap click moves the camera
  const before = await page.evaluate(() => [Renderer.cam.x, Renderer.cam.y]);
  const mm = await page.$('#minimap'); const mb = await mm.boundingBox(); await page.mouse.click(mb.x + mb.width / 2, mb.y + mb.height * 0.3); await page.waitForTimeout(50);
  const after = await page.evaluate(() => [Renderer.cam.x, Renderer.cam.y]); console.log('MINIMAP', JSON.stringify(before), '->', JSON.stringify(after));
  if (before[0] === after[0] && before[1] === after[1]) errors.push('minimap click did not move the camera');
  await page.evaluate(() => { const th = Game.players[0].buildings('townhall')[0]; Renderer.centerOn(th.x, th.y); });
  // wheel zoom
  await page.mouse.move(640, 400); await page.mouse.wheel(0, -300); await page.waitForTimeout(50);
  const z = await page.evaluate(() => Renderer.cam.zoom); console.log('ZOOM', z); if (!(z > 1)) errors.push('wheel zoom failed');
  await page.evaluate(() => { Renderer.cam.zoom = 1; });
  // Let the bots play for a long while at high speed; the human is idle
  for (let i = 0; i < 12; i++) { await fastForward(page, 60); }
  await page.waitForTimeout(300);
  const t3 = await page.evaluate(() => Game.players.map((p) => ({ name: p.name, age: p.age, alive: p.alive, res: Object.fromEntries(Object.entries(p.res).map(([k, v]) => [k, Math.round(v)])), vill: p.units('villager').length, mil: p.units().filter((u) => u.type !== 'villager').length, bld: p.buildings().map((b) => b.type).sort().join(','), techs: [...p.techs].join(','), kills: p.stats.kills, losses: p.stats.losses, ai: p.ai ? { attacking: p.ai.attacking } : null })));
  console.log('T+870', JSON.stringify(t3, null, 1));
  // Look at an AI base
  await page.evaluate(() => { const p = Game.players[1]; const th = p.buildings('townhall')[0] || p.buildings()[0]; if (th) Renderer.centerOn(th.x, th.y); Game.settings.reveal = true; World.updateFog(0, true); });
  await page.waitForTimeout(300); await snap(page, '06-ai-base');
  // Human interface: select a barracks-type building of the AI to check panel, then own things
  await page.evaluate(() => { const p = Game.players[0]; Game.select(p.units('villager').slice(0, 5)); Game.buildMenu = true; UI.refreshCommands(); Renderer.centerOn(p.buildings('townhall')[0].x, p.buildings('townhall')[0].y); });
  await page.waitForTimeout(300); await snap(page, '07-build-menu');
  await page.evaluate(() => { const p = Game.players[0]; Game.select([p.buildings('townhall')[0]]); });
  await page.waitForTimeout(300); await snap(page, '08-townhall-panel');
  // Zoomed-in look at units
  await page.evaluate(() => { Renderer.cam.zoom = 2; const p = Game.players[1]; const u = p.units().find((x) => x.type !== 'villager') || p.units()[0]; if (u) Renderer.centerOn(u.x, u.y); });
  await page.waitForTimeout(300); await snap(page, '09-closeup');
  // Continue further to see fighting
  for (let i = 0; i < 10; i++) { await fastForward(page, 60); }
  const t4 = await page.evaluate(() => ({ time: Game.time, over: Game.over, players: Game.players.map((p) => ({ name: p.name, age: p.age, alive: p.alive, vill: p.units('villager').length, mil: p.units().filter((u) => u.type !== 'villager').length, blds: p.buildings().length, kills: p.stats.kills, losses: p.stats.losses, razed: p.stats.razed })) }));
  console.log('T+1470', JSON.stringify(t4, null, 1));
  await page.evaluate(() => { Renderer.cam.zoom = 1; const e = Game.effects.find((x) => x.kind === 'corpse' || x.kind === 'rubble'); if (e) Renderer.centerOn(e.x, e.y); });
  await page.waitForTimeout(300); await snap(page, '10-aftermath');
  // Mobile layout
  await page.setViewportSize({ width: 390, height: 780 }); await page.waitForTimeout(400);
  await page.evaluate(() => { const p = Game.players[0]; const th = p.buildings('townhall')[0]; if (th) { Game.select([th]); Renderer.centerOn(th.x, th.y); } });
  await page.waitForTimeout(300); await snap(page, '11-mobile');
  await page.evaluate(() => UI.togglePause()); await page.waitForTimeout(200); await snap(page, '12-pause');
  console.log('ERRORS', errors.length ? errors.join('\n---\n') : 'none');
  await browser.close(); server.close();
  if (errors.length) process.exit(1);
})().catch((e) => { console.error('TEST FAILED', e); console.error('PAGE ERRORS SO FAR:\n' + errors.join('\n---\n')); process.exit(1); });
