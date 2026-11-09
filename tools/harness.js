// Shared test harness: opens the page (index.html) from disk with file://, like
// a double-click, and serves the CDN copy of Three.js and the Google Fonts from
// local copies in tools/node_modules, so tests run without the internet.
//
//   cd tools && npm install playwright three@0.170.0 @fontsource/cormorant-garamond @fontsource/jost
//
// APP_DIR can point at another copy of the project (default: the folder above tools/).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const NM = path.join(__dirname, 'node_modules');
const APP_DIR = process.env.APP_DIR || path.join(__dirname, '..');
const APP = require('url').pathToFileURL(path.join(APP_DIR, 'index.html')).href;
const SHOTS = path.join(__dirname, 'shots'); // ignored by git
fs.mkdirSync(SHOTS, { recursive: true });

const fontFile = (pkg, f) => path.join(NM, '@fontsource', pkg, 'files', f);
const FONT_CSS = `
@font-face{font-family:'Cormorant Garamond';font-style:italic;font-weight:500;src:url(https://fonts.gstatic.com/local/cg-500i.woff2) format('woff2');}
@font-face{font-family:'Cormorant Garamond';font-style:italic;font-weight:600;src:url(https://fonts.gstatic.com/local/cg-600i.woff2) format('woff2');}
@font-face{font-family:'Jost';font-style:normal;font-weight:400;src:url(https://fonts.gstatic.com/local/jost-400.woff2) format('woff2');}
@font-face{font-family:'Jost';font-style:normal;font-weight:500;src:url(https://fonts.gstatic.com/local/jost-500.woff2) format('woff2');}`;
const FONT_FILES = {
  'cg-500i.woff2': fontFile('cormorant-garamond', 'cormorant-garamond-latin-500-italic.woff2'),
  'cg-600i.woff2': fontFile('cormorant-garamond', 'cormorant-garamond-latin-600-italic.woff2'),
  'jost-400.woff2': fontFile('jost', 'jost-latin-400-normal.woff2'),
  'jost-500.woff2': fontFile('jost', 'jost-latin-500-normal.woff2'),
};

// Opens a fresh browser (a new profile every time) at the given size.
// touch: true emulates a phone (touch events, mobile viewport).
async function open({ width = 1280, height = 800, dpr = 1, touch = false, initScript, launchArgs = [], executablePath } = {}) {
  const browser = await chromium.launch({
    executablePath,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', ...launchArgs],
  });
  const context = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: dpr, hasTouch: touch, isMobile: touch, acceptDownloads: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });

  await context.route('https://cdn.jsdelivr.net/**', (route) => {
    const url = route.request().url();
    const m = url.match(/three@0\.170\.0\/(.*)$/);
    if (!m) return route.abort();
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/javascript', 'access-control-allow-origin': '*' },
      body: fs.readFileSync(path.join(NM, 'three', m[1])),
    });
  });
  await context.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ status: 200, headers: { 'content-type': 'text/css', 'access-control-allow-origin': '*' }, body: FONT_CSS }));
  await context.route('https://fonts.gstatic.com/**', (route) => {
    const name = route.request().url().split('/').pop();
    if (!FONT_FILES[name]) return route.abort();
    route.fulfill({ status: 200, headers: { 'content-type': 'font/woff2', 'access-control-allow-origin': '*' }, body: fs.readFileSync(FONT_FILES[name]) });
  });
  if (initScript) await page.addInitScript(initScript);
  await page.goto(APP);
  await page.waitForFunction(() => window.youAreHere, null, { timeout: 30000 });
  return { browser, context, page, errors, APP, shot: (name) => page.screenshot({ path: path.join(SHOTS, name + '.png') }) };
}

module.exports = { open, SHOTS };
