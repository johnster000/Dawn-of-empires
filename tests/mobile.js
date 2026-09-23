/* Phone behaviour: a close button dismisses any selection, and tapping your own Town Hall while villagers
   are selected selects the hall instead of commanding them. Run: node tests/mobile.js */
const { launch } = require('./lib');
(async () => {
  const H = await launch({ viewport: { width: 390, height: 780 } }); const page = H.page;
  await H.start({ seed: 7 }); await page.waitForTimeout(300);
  const ok = (name, pass, info) => console.log((pass ? 'ok   ' : 'FAIL ') + name, info ? JSON.stringify(info) : '');
  const r1 = await page.evaluate(() => {
    const p = Game.players[0]; Game.select(p.units('villager')); UI.refreshSelection && UI.refreshSelection();
    const multi = !!document.querySelector('#selpanel .sel-close');
    document.querySelector('#selpanel .sel-close').click();
    return { multi, after: Game.selection.length };
  });
  ok('close button clears a group selection', r1.multi && r1.after === 0, r1);
  await page.waitForTimeout(100);
  const r2 = await page.evaluate(() => {
    const p = Game.players[0], th = p.buildings('townhall')[0];
    Game.select(p.units('villager')); Renderer.centerOn ? Renderer.centerOn(th.x + th.def.size / 2, th.y + th.def.size / 2) : 0;
    Game.tick(1 / 20);
    const c = th.def.size / 2, [sx, sy] = Renderer.toScreen(th.x + c, th.y + c);
    const before = p.units('villager').map((v) => v.order && v.order.type);
    Input.tap(sx, sy - 10);
    const sel = Game.selection.map((e) => e.type);
    const orders = p.units('villager').map((v) => v.order && v.order.type);
    UI.refreshSelection(); const single = !!document.querySelector('#selpanel .sel-close');
    return { sel, garrisoned: orders.filter((o) => o === 'garrison').length, single, before };
  });
  ok('tapping the Town Hall selects it', r2.sel.length === 1 && r2.sel[0] === 'townhall' && r2.garrisoned === 0, r2);
  ok('single selection has a close button', r2.single);
  await H.snap('mobile-selected');
  const r3 = await page.evaluate(() => {
    const p = Game.players[0]; Game.select(p.units('villager')); UI.refreshCommands();
    const btn = [...document.querySelectorAll('#commands button')].find((x) => /Garrison/i.test(x.textContent));
    return { hasGarrison: !!btn };
  });
  ok('villagers have a Garrison button', r3.hasGarrison, r3);
  // touch: tapping a build button shows its card over the selection panel while placing
  const r4 = await page.evaluate(() => {
    const p = Game.players[0]; Game.select(p.units('villager')); Game.buildMenu = true; UI.refreshSelection(); UI.refreshCommands();
    const btns = [...document.querySelectorAll('#commands button')];
    const house = btns.find((x) => /House/.test(x.textContent)); house.click(); UI.refreshSelection();
    const card = document.querySelector('#selpanel .cmd-info');
    const out = { card: card && card.textContent.slice(0, 60), placing: !!Game.placing, cost: !!(card && card.querySelector('.tip-cost')) };
    Game.cancelPlacing(); UI.refreshSelection(); out.afterCancel = !!document.querySelector('#selpanel .cmd-info');
    Game.buildMenu = true; UI.refreshCommands();
    const locked = [...document.querySelectorAll('#commands button.disabled, #commands button.locked')][0];
    if (locked) { locked.click(); UI.refreshSelection(); const c2 = document.querySelector('#selpanel .cmd-info'); out.locked = c2 && c2.querySelector('.tip-why') ? c2.querySelector('.tip-why').textContent : null; }
    return out;
  });
  ok('tapping a build button shows its cost card while placing', r4.card && /House/.test(r4.card) && r4.placing && r4.cost, r4);
  ok('the card goes once placing ends', !r4.afterCancel, r4);
  ok('a locked button explains why on touch', !!r4.locked, r4);
  await page.evaluate(() => { const p = Game.players[0]; Game.select(p.units('villager')); Game.buildMenu = true; UI.refreshCommands(); [...document.querySelectorAll('#commands button')].find((x) => /Barracks/.test(x.textContent)).click(); UI.refreshSelection(); });
  await page.waitForTimeout(300); await H.snap('mobile-buildinfo');
  console.log('ERRORS', H.errors.length ? H.errors.join('\n') : 'none');
  await H.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
