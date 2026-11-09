// Smoke test: plays the whole tour once on a desktop and a phone-sized screen,
// tries every Go to entry, opens the panels, and fails on any page error or
// console error/warning. Screenshots go to tools/shots/.
//
//   node smoke.js                 (both screens)
//   node smoke.js desktop         (one screen: desktop or phone)
//   CHROME_PATH=/usr/bin/google-chrome node smoke.js   (use an installed Chrome)
const { open, SHOTS } = require('./harness');

const SCREENS = {
  desktop: { width: 1280, height: 800, dpr: 1, touch: false },
  phone: { width: 390, height: 844, dpr: 3, touch: true },
};
const TOUR_SECONDS = 30;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runScreen(name, opts) {
  const t0 = Date.now();
  const { browser, page, errors, shot } = await open({ ...opts, executablePath: process.env.CHROME_PATH || undefined });
  const log = (...a) => console.log(`[${name} ${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
  const report = { screen: name, stops: [], goTo: [], panels: [], errors };
  try {
    // 1. The tour, end to end, once.
    await page.evaluate((sec) => {
      const y = window.youAreHere;
      y.settings.tour.seconds = sec;
      y.playTour({ once: true });
    }, TOUR_SECONDS);
    const plan = await page.evaluate(() => window.youAreHere.tour.plan);
    log('tour plan', JSON.stringify(plan));
    const shotAt = new Set();
    // The test browser draws in software (a few frames a second) and the
    // tour's clock advances at most 0.1 s per frame, so allow for that:
    // wait until the tour itself says it has finished, up to 15 minutes.
    const deadline = Date.now() + 15 * 60 * 1000;
    while (Date.now() < deadline) {
      const t = await page.evaluate(() => window.youAreHere.tour);
      if (!t.on) break;
      const stop = plan[t.index];
      if (stop && !stop[0].startsWith('to') && !shotAt.has(t.index) && t.clock > stop[1] * 0.7) {
        shotAt.add(t.index);
        const caption = await page.evaluate(() => window.youAreHere.captionText);
        await shot(`${name}-tour-${String(t.index).padStart(2, '0')}-${stop[0]}`);
        report.stops.push({ stop: stop[0], world: await page.evaluate(() => window.youAreHere.world), caption });
        log('stop', stop[0], caption ? `caption: "${caption}"` : '');
      }
      await sleep(150);
    }
    const end = await page.evaluate(() => window.youAreHere.tour);
    report.tourFinished = !end.on;
    log('tour finished:', report.tourFinished, 'visited', report.stops.length, 'of', plan.filter((p) => !p[0].startsWith('to')).length, 'stops');

    // 2. Every Go to entry, in the galaxy and then on Earth.
    const goList = async () => page.evaluate(() => Array.from(document.querySelectorAll('#goMenu button[data-go]')).map((b) => b.dataset.go));
    await page.evaluate(() => window.youAreHere.goTo('overview'));
    await page.click('#goBtn');
    await sleep(300);
    const galaxyDest = await goList();
    await page.keyboard.press('Escape');
    for (const dest of galaxyDest.filter((d) => d !== 'earth')) {
      await page.evaluate((d) => window.youAreHere.goTo(d), dest);
      await sleep(2500);
      await shot(`${name}-goto-galaxy-${dest}`);
      report.goTo.push(`galaxy:${dest}`);
    }
    await page.evaluate(() => window.youAreHere.goTo('earth'));
    await page.waitForFunction(() => window.youAreHere.world === 'earth' && !window.youAreHere.journey, null, { timeout: 20000 });
    await page.click('#goBtn');
    await sleep(300);
    const earthDest = await goList();
    await page.keyboard.press('Escape');
    for (const dest of earthDest.filter((d) => d !== 'galaxy')) {
      await page.evaluate((d) => window.youAreHere.goTo(d), dest);
      await sleep(dest === 'eclipse' ? 6000 : 3000);
      const caption = await page.evaluate(() => window.youAreHere.captionText);
      await shot(`${name}-goto-earth-${dest}`);
      report.goTo.push(`earth:${dest}${caption ? ` (caption: ${caption})` : ''}`);
    }
    await page.evaluate(() => window.youAreHere.shootingStar());
    await page.evaluate(() => window.youAreHere.goTo('galaxy'));
    await page.waitForFunction(() => window.youAreHere.world === 'galaxy' && !window.youAreHere.journey, null, { timeout: 20000 });
    log('go to:', report.goTo.join(', '));

    // 3. Panels: editor, help, hide and show the controls.
    await page.click('#editBtn');
    await sleep(700);
    await shot(`${name}-editor`);
    report.panels.push('editor');
    await page.keyboard.press('Escape');
    await sleep(300);
    await page.click('#helpBtn');
    await sleep(500);
    await shot(`${name}-help`);
    report.panels.push('help');
    await page.keyboard.press('Escape');
    await page.click('#hideBtn');
    await sleep(300);
    await page.click('#showUi');
    report.panels.push('hide/show');
    await page.evaluate(() => window.youAreHere.goTo('overview'));
    await sleep(2500);
    await shot(`${name}-overview`);

    // 4. Loading a backup keeps only the settings this app has (made-up data only).
    const madeUp = {
      app: 'you-are-here', version: 1,
      galaxy: { branches: 4, spinSpeed: 0.08 }, extras: { waves: true, removedExtra: true }, tour: { seconds: 45 },
      oldList: ['A made-up line'], oldText: 'Made-up text',
    };
    await page.setInputFiles('#importFile', { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(madeUp)) });
    await sleep(1000);
    const st = await page.evaluate(() => JSON.parse(JSON.stringify(window.youAreHere.settings)));
    const backupOk = JSON.stringify(Object.keys(st).sort()) === '["extras","galaxy","tour"]'
      && st.galaxy.spinSpeed === 0.08 && !('branches' in st.galaxy) && st.extras.waves === true && !('removedExtra' in st.extras) && st.tour.seconds === 45;
    if (!backupOk) errors.push('test: backup import kept unexpected settings: ' + JSON.stringify(st));
    const other = { app: 'another-app', galaxy: { spinSpeed: 0.2 } };
    await page.setInputFiles('#importFile', { name: 'other.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(other)) });
    await sleep(800);
    const st2 = await page.evaluate(() => window.youAreHere.settings.galaxy.spinSpeed);
    if (st2 !== 0.08) errors.push('test: a backup from another app was loaded');
    report.backup = backupOk && st2 === 0.08;
    log('backup import:', report.backup ? 'ok' : 'FAILED');
  } catch (err) {
    errors.push('test: ' + (err && err.message ? err.message : err));
  } finally {
    await browser.close();
  }
  log(errors.length ? `ERRORS (${errors.length}):\n  ` + errors.join('\n  ') : 'no errors');
  return report;
}

(async () => {
  const which = process.argv[2] ? [process.argv[2]] : Object.keys(SCREENS);
  const reports = [];
  for (const name of which) reports.push(await runScreen(name, SCREENS[name]));
  const failed = reports.some((r) => r.errors.length || !r.tourFinished);
  console.log(`\nScreenshots: ${SHOTS}`);
  console.log(failed ? 'SMOKE TEST FAILED' : 'SMOKE TEST PASSED');
  process.exit(failed ? 1 : 0);
})();
