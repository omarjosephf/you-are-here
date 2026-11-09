// Stage 8 checks: "you are moving", the Pale Blue Dot (at true scale the
// camera must be as far from Earth as Voyager 1 was: 6.05 billion km, JPL
// Horizons), "jump to the next..." against known dates, shareable links
// (a reload with the link opens the same view), and the galaxy landmarks.
//   CHROME_PATH=<path to Chrome> node stage8-check.js [phone]
const { open } = require('./harness');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const phone = process.argv[2] === 'phone';
let failed = 0;
const say = (ok, msg) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };
const OPTS = Object.assign({ executablePath: process.env.CHROME_PATH || undefined }, phone ? { width: 390, height: 844, dpr: 3, touch: true } : {});

(async () => {
  const tag = phone ? 'phone' : 'desktop';
  let h = await open(OPTS);
  try {
    let { page, shot } = h;
    // 1. You are moving.
    const m1 = await page.evaluate(() => document.querySelector('#moving').textContent);
    await sleep(2000);
    const m2 = await page.evaluate(() => document.querySelector('#moving').textContent);
    say(/around the Sun/.test(m2) && m1 !== m2, `moving counter: "${m2}"`);

    // 2. Landmarks.
    await page.evaluate(() => window.youAreHere.goTo('landmarks'));
    await sleep(6000);
    const lm = await page.evaluate(() => window.youAreHere.landmarksShown());
    say(lm.length >= 3, `landmarks named near Sol: ${lm.join(', ')}`);
    await shot(`${tag}-s8-landmarks`);

    // 3. The Pale Blue Dot, at true scale.
    await page.evaluate(() => window.youAreHere.journeyTo('earth'));
    await page.waitForFunction(() => window.youAreHere.world === 'earth' && !window.youAreHere.journey, null, { timeout: 30000 });
    await page.evaluate(() => { const y = window.youAreHere; y.setScale('trueScale'); y.goTo('paleBlueDot'); });
    await sleep(12000);
    const pbd = await page.evaluate(() => {
      const y = window.youAreHere;
      const km = y.camera.position.length() * y.sky.EARTH_R_KM / y.sky.EARTH_R;
      return { km, clock: new Date(y.clock.now()).toISOString(), caption: y.captionText, card: document.querySelector('#cardTitle').textContent };
    });
    say(pbd.clock.startsWith('1990-02-14T04:48'), `clock set to ${pbd.clock}`);
    say(Math.abs(pbd.km / 6.0548e9 - 1) < 0.03, `camera is ${(pbd.km / 1e9).toFixed(3)} billion km from Earth (Horizons: 6.055)`);
    say(pbd.card === 'The Pale Blue Dot', `card: ${pbd.card}`);
    await shot(`${tag}-s8-pale-blue-dot-true-scale`);
    await page.evaluate(() => window.youAreHere.setScale('illustrative'));
    await sleep(6000);
    await shot(`${tag}-s8-pale-blue-dot`);

    // 4. Jump to the next... from 9 November 2026 (known dates).
    const jumps = {};
    for (const kind of ['lunar', 'season', 'opposition', 'conjunction', 'transit']) {
      jumps[kind] = await page.evaluate(async (k) => {
        const y = window.youAreHere;
        y.clock.setDate(Date.UTC(2026, 10, 9));
        y.nextEvent(k);
        await new Promise((r) => setTimeout(r, 1500));
        return new Date(y.clock.now()).toISOString().slice(0, 10);
      }, kind);
    }
    console.log('INFO  next events after 9 Nov 2026:', JSON.stringify(jumps));
    say(jumps.lunar === '2027-02-20', `next lunar eclipse ${jumps.lunar} (the penumbral eclipse of 20 February 2027)`);
    say(jumps.season === '2026-12-21', `next equinox or solstice ${jumps.season} (December solstice, 21 December 2026)`);
    say(jumps.transit === '2032-11-13', `next transit ${jumps.transit} (Mercury, 13 November 2032)`);
    say(jumps.opposition > '2026-11-09' && jumps.conjunction > '2026-11-09', 'opposition and conjunction are after the start date');
    await shot(`${tag}-s8-transit`);

    // 5. Shareable view: Jupiter, true sizes, a fixed date; reload with the link.
    await page.evaluate(() => { const y = window.youAreHere; y.clock.setDate(Date.UTC(2030, 5, 1, 12)); y.setScale('trueSizes'); y.goTo('jupiter'); });
    await sleep(3000);
    const link = await page.evaluate(() => { window.youAreHere.updateHash(true); return location.href; });
    console.log('INFO  link:', link.slice(link.indexOf('#')));
    await h.browser.close();
    h = await open(Object.assign({}, OPTS, { initScript: `history.replaceState(null, '', ${JSON.stringify(link.slice(link.indexOf('#')))});` }));
    page = h.page;
    await sleep(6000);
    const back = await page.evaluate(() => { const y = window.youAreHere; return { world: y.world, f: y.following, scale: y.earth && y.earth.scaleMode, date: new Date(y.clock.now()).toISOString().slice(0, 16), tour: y.tour.on }; });
    say(back.world === 'earth' && back.f === 'jupiter' && back.scale === 'trueSizes' && back.date === '2030-06-01T12:00' && !back.tour, `link reopens: ${JSON.stringify(back)}`);
    await h.shot(`${tag}-s8-shared-link`);
  } catch (err) {
    h.errors.push('test: ' + err.message);
  } finally {
    await h.browser.close();
  }
  for (const e of h.errors) { failed++; console.log('FAIL  ' + e); }
  console.log(failed ? `${failed} STAGE 8 CHECK(S) FAILED` : 'ALL STAGE 8 CHECKS PASSED');
  process.exit(failed ? 1 : 0);
})();
