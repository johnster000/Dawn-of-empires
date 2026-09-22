/* Check the disclaimer fits the title screen and the How to Play panel. Run: node tests/legal.js */
const { launch } = require('./lib');
(async () => {
  const H = await launch({ viewport: { width: 1280, height: 800 } });
  await H.snap('legal-title');
  await H.page.setViewportSize({ width: 390, height: 780 }); await H.page.waitForTimeout(200);
  await H.snap('legal-title-phone');
  const fits = await H.page.evaluate(() => { const b = document.body; return { overflow: b.scrollWidth - b.clientWidth, legal: !!document.querySelector('.legal') }; });
  console.log('phone overflow', fits.overflow, 'legal line present', fits.legal);
  await H.page.setViewportSize({ width: 1280, height: 900 }); await H.page.click('#btn-howto'); await H.page.waitForTimeout(200);
  await H.snap('legal-howto');
  console.log('ERRORS', H.errors.length ? H.errors.join('\n') : 'none');
  await H.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
