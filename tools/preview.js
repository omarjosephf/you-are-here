// Makes preview.png (1200 x 630, the link-preview image) and readme-shot.png
// (1280 x 720) in a fresh browser profile, with the controls hidden.
//   CHROME_PATH=<path to Chrome> node preview.js
// Look at both images by eye before publishing (rule 2 in the plan).
const path = require('path');
const { open } = require('./harness');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = path.join(__dirname, '..');

async function take(width, height, file, setup) {
  const { browser, page, errors } = await open({ width, height, executablePath: process.env.CHROME_PATH || undefined });
  try {
    await page.evaluate(setup);
    await sleep(9000);
    await page.evaluate(() => { document.body.classList.add('ui-off'); document.getElementById('showUi').hidden = true; });
    await sleep(600);
    await page.screenshot({ path: path.join(OUT, file) });
  } finally {
    await browser.close();
  }
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('saved', file);
}

(async () => {
  const galaxy = () => { const y = window.youAreHere; y.playTour && y.goTo('overview'); y.view.goalPhi = 0.85; y.view.goalRadius = 7.4; };
  await take(1200, 630, 'preview.png', galaxy);
  await take(1280, 720, 'readme-shot.png', galaxy);
})().catch((e) => { console.error(e); process.exit(1); });
