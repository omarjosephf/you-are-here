// Visits every body in the solar system and takes a screenshot of each,
// reporting how many particles are drawn (the on-screen budget) and any
// errors.   CHROME_PATH=<path to Chrome> node planets-check.js [phone]
const { open } = require('./harness');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const phone = process.argv[2] === 'phone';

(async () => {
  const { browser, page, errors, shot } = await open(Object.assign({ executablePath: process.env.CHROME_PATH || undefined },
    phone ? { width: 390, height: 844, dpr: 3, touch: true } : {}));
  const tag = phone ? 'phone' : 'desktop';
  try {
    await page.evaluate(() => { window.youAreHere.playTour && window.youAreHere.zoomTo(9); window.youAreHere.journeyTo('earth'); });
    await page.waitForFunction(() => window.youAreHere.world === 'earth' && !window.youAreHere.journey, null, { timeout: 30000 });
    await sleep(4000);
    const ids = ['sol', 'mercury', 'venus', 'earth', 'luna', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto', 'system'];
    for (const id of ids) {
      await page.evaluate((d) => window.youAreHere.goTo(d), id);
      await sleep(id === 'system' ? 7000 : 6000);
      const info = await page.evaluate(() => {
        const y = window.youAreHere;
        return { following: y.following, points: (y.planets ? y.planets.totalPoints() : 0) + (y.earth ? y.earth.drawn : 0), note: document.querySelector('#scaleNote').textContent, radius: +y.view.radius.toFixed(2) };
      });
      await shot(`${tag}-s4-${id}`);
      console.log(id, JSON.stringify(info));
    }
    // A rough frame rate (software rendering in the test browser, so slow).
    const fps = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(n / 2); }; requestAnimationFrame(f); }));
    console.log('frames per second (software renderer):', fps);
  } catch (err) {
    errors.push('test: ' + err.message);
  } finally {
    await browser.close();
  }
  console.log(errors.length ? 'ERRORS:\n  ' + errors.join('\n  ') : 'no errors');
  process.exit(errors.length ? 1 : 0);
})();
