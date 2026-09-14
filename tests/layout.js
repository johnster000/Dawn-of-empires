/* Layout snapshots: setup panel, and the in-game HUD at desktop and phone sizes. Run: node tests/layout.js */
const { launch } = require('./lib');
(async () => {
  const H = await launch({ viewport: { width: 1280, height: 800 } }); const page = H.page;
  await page.click('#btn-new'); await page.waitForTimeout(150); await H.snap('layout-setup');
  await page.setViewportSize({ width: 390, height: 780 }); await page.waitForTimeout(200); await H.snap('layout-setup-phone');
  await page.click('#btn-begin'); await page.waitForTimeout(400);
  await page.evaluate(() => { const p = Game.players[0]; Game.select([p.buildings('townhall')[0]]); });
  await page.waitForTimeout(300); await H.snap('layout-phone-townhall');
  await page.evaluate(() => { const p = Game.players[0]; Game.select(p.units('villager')); Game.buildMenu = true; UI.refreshCommands(); });
  await page.waitForTimeout(300); await H.snap('layout-phone-build');
  await page.setViewportSize({ width: 820, height: 1180 }); await page.waitForTimeout(300); await H.snap('layout-tablet-build');
  await page.evaluate(() => UI.togglePause()); await page.setViewportSize({ width: 390, height: 780 }); await page.waitForTimeout(300); await H.snap('layout-phone-pause');
  console.log('ERRORS', H.errors.length ? H.errors.join('\n') : 'none');
  await H.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
