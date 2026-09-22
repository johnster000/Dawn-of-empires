/* How long does a new game take to set up (world generation + ground texture)? Run: node tests/loadtime.js */
const { launch } = require('./lib');
(async () => {
  const H = await launch();
  for (const size of ['small', 'medium', 'large', 'huge']) {
    const ms = await H.page.evaluate((sz) => { const t = performance.now(); Game.newGame(Object.assign({}, Game.defaults, { mapSize: sz, enemies: 3, seedText: 'load' })); return Math.round(performance.now() - t); }, size);
    console.log(size, ms + ' ms');
  }
  await H.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
