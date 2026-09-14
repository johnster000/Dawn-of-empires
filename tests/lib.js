/* Shared harness: serve the folder, launch headless Chromium, collect console errors. */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
async function launch(opts = {}) {
  const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html'; const f = path.join(root, p); fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(d); }); });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: opts.viewport || { width: 1280, height: 800 }, deviceScaleFactor: opts.dpr || 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message + '\n' + (e.stack || '')));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  await page.goto(`http://localhost:${port}/index.html`); await page.waitForTimeout(400);
  fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
  return {
    page, browser, errors,
    snap: (name) => page.screenshot({ path: path.join(__dirname, 'shots', name + '.png') }),
    ff: (seconds) => page.evaluate((s) => { const n = Math.round(s * 20); for (let i = 0; i < n; i++) Game.tick(1 / 20); }, seconds),
    start: (settings) => page.evaluate((st) => Game.newGame(Object.assign({}, Game.defaults, st)), settings),
    close: async () => { await browser.close(); server.close(); },
  };
}
module.exports = { launch };
