// Checks the live-site set-up: serves the project over http (like a host
// would), blocks every request that leaves the site, and checks that the
// page still starts, with three.js and the fonts from vendor/.
//   CHROME_PATH=<path to Chrome> node served.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.md': 'text/markdown', '': 'text/plain' };

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!file.startsWith(ROOT) || /node_modules|PLAN\.md|\.private/.test(file) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage();
  const outside = [];
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(`http://127.0.0.1:${port}/`)) return route.continue();
    outside.push(u);
    return route.abort();
  });
  let ok = false;
  try {
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForFunction(() => window.youAreHere, null, { timeout: 30000 });
    await page.waitForTimeout(2500);
    const fonts = await page.evaluate(async () => { await document.fonts.ready; return ['italic 600 20px "Cormorant Garamond"', '400 16px "Jost"'].map((f) => document.fonts.check(f)); });
    const loading = await page.evaluate(() => document.getElementById('loading').hidden);
    console.log('started: yes; fonts loaded:', fonts.join(', '), '; loading screen gone:', loading);
    console.log('requests that tried to leave the site:', outside.length ? outside.join(', ') : 'none');
    ok = fonts.every(Boolean) && loading && !outside.length && !errors.length;
  } catch (err) {
    errors.push(err.message);
  }
  console.log(errors.length ? 'ERRORS:\n  ' + errors.join('\n  ') : 'no errors');
  console.log(ok ? 'SERVED CHECK PASSED' : 'SERVED CHECK FAILED');
  await browser.close();
  server.close();
  process.exit(ok ? 0 : 1);
});
