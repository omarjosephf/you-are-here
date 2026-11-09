// Stage 6 checks: info cards (real HTML with live values), the four scale
// modes (and that true scale really is to scale in the scene), the size
// line-up and the light-time ladder. Screenshots go to tools/shots/.
//   CHROME_PATH=<path to Chrome> node stage6-check.js [phone]
const { open } = require('./harness');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const phone = process.argv[2] === 'phone';
let failed = 0;
const say = (ok, msg) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

(async () => {
  const { browser, page, errors, shot } = await open(Object.assign({ executablePath: process.env.CHROME_PATH || undefined },
    phone ? { width: 390, height: 844, dpr: 3, touch: true } : {}));
  const tag = phone ? 'phone' : 'desktop';
  try {
    // A galaxy card.
    await page.evaluate(() => window.youAreHere.goTo('core'));
    await sleep(2500);
    let card = await page.evaluate(() => ({ open: !document.querySelector('#card').hidden, title: document.querySelector('#cardTitle').textContent }));
    say(card.open && card.title === 'The galactic centre', `galaxy card: ${card.title}`);
    await shot(`${tag}-s6-card-centre`);

    await page.evaluate(() => window.youAreHere.journeyTo('earth'));
    await page.waitForFunction(() => window.youAreHere.world === 'earth' && !window.youAreHere.journey, null, { timeout: 30000 });
    await page.evaluate(() => window.youAreHere.clock.setDate(Date.UTC(2026, 10, 9, 12)));
    for (const id of ['jupiter', 'luna', 'sol', 'pluto']) {
      await page.evaluate((d) => window.youAreHere.goTo(d), id);
      await sleep(5000);
      card = await page.evaluate(() => ({
        open: !document.querySelector('#card').hidden,
        title: document.querySelector('#cardTitle').textContent,
        live: Array.from(document.querySelectorAll('#cardLive dd')).map((d) => d.textContent),
      }));
      say(card.open && card.live.length >= 2, `${id} card: ${card.title} | ${card.live.join(' | ')}`);
      if (id === 'jupiter') await shot(`${tag}-s6-card-jupiter`);
    }

    // Scale modes. In true scale, sizes and distances must be in proportion.
    for (const mode of ['trueSizes', 'trueDistances', 'trueScale', 'illustrative']) {
      await page.evaluate((m) => { const y = window.youAreHere; y.setScale(m); y.goTo('system'); }, mode);
      await sleep(7000);
      const r = await page.evaluate(() => {
        const y = window.youAreHere;
        const e = y.earth;
        const j = y.planets.byId.jupiter;
        return {
          mode: e.scaleMode, note: document.querySelector('#scaleNote').textContent,
          jupOverEarth: j.R / e.R, sunOverEarth: e.sunR / e.R,
          sunDistOverEarthR: e.sunDist / e.R, sunAU: e.sunAU,
          moonDistOverEarthR: e.moonOrbit / e.R, points: y.planets.totalPoints() + e.drawn,
        };
      });
      console.log(`INFO  ${mode}: ${r.note} (points drawn: ${r.points})`);
      if (mode === 'trueScale') {
        say(Math.abs(r.jupOverEarth - 142984 / 12756) < 0.01, `true scale: Jupiter is ${r.jupOverEarth.toFixed(3)} Earths wide (11.209)`);
        say(Math.abs(r.sunOverEarth - 1391400 / 12756) < 0.01, `true scale: the Sun is ${r.sunOverEarth.toFixed(2)} Earths wide (109.08)`);
        const want = (r.sunAU * 149597870.7) / 6378;
        say(Math.abs(r.sunDistOverEarthR / want - 1) < 1e-6, `true scale: Sun is ${Math.round(r.sunDistOverEarthR)} Earth radii away (${Math.round(want)})`);
        say(r.moonDistOverEarthR > 55 && r.moonDistOverEarthR < 64, `true scale: the Moon is ${r.moonDistOverEarthR.toFixed(1)} Earth radii away (56 to 64)`);
      }
      await shot(`${tag}-s6-scale-${mode}`);
    }
    // Compare panels.
    for (const which of ['sizes', 'ladder']) {
      await page.evaluate((w) => window.youAreHere.goTo(w), which);
      await sleep(800);
      const p = await page.evaluate(() => ({ open: !document.querySelector('#compare').hidden, title: document.querySelector('#compareTitle').textContent, rows: document.querySelectorAll('#compareBody li, #compareBody circle').length }));
      say(p.open && p.rows > 5, `${p.title}: ${p.rows} items`);
      await shot(`${tag}-s6-${which}`);
      await page.keyboard.press('Escape');
    }
  } catch (err) {
    errors.push('test: ' + err.message);
  } finally {
    await browser.close();
  }
  for (const e of errors) { failed++; console.log('FAIL  ' + e); }
  console.log(failed ? `${failed} STAGE 6 CHECK(S) FAILED` : 'ALL STAGE 6 CHECKS PASSED');
  process.exit(failed ? 1 : 0);
})();
