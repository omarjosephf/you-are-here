// Science checks inside the real page: sets the clock to fixed dates and
// compares what is in the scene with Astronomy Engine's own answers.
//   CHROME_PATH=<path to Chrome> node science-browser.js
const { open } = require('./harness');

let failed = 0;
const results = [];
function check(name, value, expected, tol, unit = '') {
  const ok = Number.isFinite(value) && Math.abs(value - expected) <= tol;
  if (!ok) failed++;
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${Number.isFinite(value) ? value.toFixed(3) : value}${unit} (expected ${expected}${unit} +/- ${tol})`);
}
function truthy(name, ok, detail = '') {
  if (!ok) failed++;
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ': ' + detail : ''}`);
}

(async () => {
  const { browser, page, errors } = await open({ executablePath: process.env.CHROME_PATH || undefined });
  try {
    await page.evaluate(() => { window.youAreHere.playTour && window.youAreHere.goTo('overview'); window.youAreHere.journeyTo('earth'); });
    await page.waitForFunction(() => window.youAreHere.world === 'earth' && !window.youAreHere.journey, null, { timeout: 30000 });
    const DATES = [Date.UTC(1969, 6, 20, 20, 17), Date.UTC(2000, 0, 1, 12), Date.UTC(2026, 10, 9, 18, 30), Date.UTC(2099, 11, 31, 6)];
    for (const ms of DATES) {
      const r = await page.evaluate(async (ms) => {
        const y = window.youAreHere;
        y.clock.setDate(ms);
        await new Promise((res) => setTimeout(res, 300)); // a few frames
        const A = y.sky.A;
        const t = A.MakeTime(new Date(ms));
        const e = y.earth;
        const ss = e.subsolar();
        const eq = A.Equator('Sun', t, new A.Observer(0, 0, 0), true, true);
        let refLon = (eq.ra - A.SiderealTime(t)) * 15;
        refLon = ((refLon % 360) + 540) % 360 - 180;
        const sl = e.sublunar();
        // geocentric (from Earth's centre), in the equator of date
        const mq = A.EquatorFromVector(A.RotateVector(A.Rotation_EQJ_EQD(t), A.GeoMoon(t)));
        let mLon = (mq.ra - A.SiderealTime(t)) * 15;
        mLon = ((mLon % 360) + 540) % 360 - 180;
        // The scene's Sun (the sprite group) lies along the lit side's direction.
        const sp = e.sol.position.clone().normalize();
        const sunVsLight = Math.acos(Math.min(1, sp.dot(e.sunDir))) * 180 / Math.PI;
        const info = e.moonInfo();
        const ref = y.sky.moonPhase(ms);
        return { clock: y.clock.now(), ss, refDec: eq.dec, refLon, sl, mDec: mq.dec, mLon, sunVsLight, phase: info && info.name, lit: info && info.lit, refPhase: ref.name, refLit: ref.lit };
      }, ms);
      const tag = new Date(ms).toISOString().slice(0, 16);
      const wrap = (x) => ((x % 360) + 540) % 360 - 180;
      check(`${tag} clock reads the set date (s off)`, (r.clock - ms) / 1000, 0, 1);
      check(`${tag} Earth: Sun overhead at latitude`, r.ss.lat, r.refDec, 0.05, ' deg');
      check(`${tag} Earth: Sun overhead at longitude (error)`, wrap(r.ss.lon - r.refLon), 0, 0.1, ' deg');
      check(`${tag} Moon overhead at latitude (geocentric)`, r.sl.lat, r.mDec, 0.05, ' deg');
      check(`${tag} Moon overhead at longitude (error)`, wrap(r.sl.lon - r.mLon), 0, 0.1, ' deg');
      check(`${tag} the scene's Sun lies where the light comes from`, r.sunVsLight, 0, 0.01, ' deg');
      truthy(`${tag} Moon label phase`, r.phase === r.refPhase && r.lit === r.refLit, `${r.phase} ${r.lit}% (Astronomy Engine: ${r.refPhase} ${r.refLit}%)`);
    }
    // Stage 4: every planet's place in the scene, for several dates. The
    // direction from the scene's Sun to the planet must match Astronomy
    // Engine's heliocentric J2000 ecliptic longitude and latitude (worked
    // out independently here), and its distance the scale mapping.
    for (const ms of [Date.UTC(1910, 4, 18), Date.UTC(1986, 1, 9), Date.UTC(2026, 10, 9, 18), Date.UTC(2061, 6, 28)]) {
      const rows = await page.evaluate(async (ms) => {
        const y = window.youAreHere;
        y.clock.setDate(ms);
        await new Promise((res) => setTimeout(res, 300));
        const A = y.sky.A;
        const t = A.MakeTime(new Date(ms));
        const EPS = 23.4392911 * Math.PI / 180;
        const sun = y.earth.sunPos;
        return y.planets.bodies.map((b) => {
          const h = A.HelioVector(b.body, t);
          const yy = h.y * Math.cos(EPS) + h.z * Math.sin(EPS);
          const zz = -h.y * Math.sin(EPS) + h.z * Math.cos(EPS);
          const r = Math.hypot(h.x, yy, zz);
          const p = b.group.position.clone().sub(sun);
          const sLon = Math.atan2(-p.z, p.x) * 180 / Math.PI;
          const sLat = Math.asin(p.y / p.length()) * 180 / Math.PI;
          return { id: b.id, dLon: sLon - Math.atan2(yy, h.x) * 180 / Math.PI, sLat, lat: Math.asin(zz / r) * 180 / Math.PI, dist: p.length(), want: y.sky.distanceUnits(r, y.earth.scaleMode) };
        });
      }, ms);
      const tag = new Date(ms).toISOString().slice(0, 10);
      const wrap = (x) => ((x % 360) + 540) % 360 - 180;
      for (const r of rows) {
        check(`${tag} ${r.id}: direction from the Sun, longitude error`, wrap(r.dLon), 0, 0.05, ' deg');
        check(`${tag} ${r.id}: latitude above the ecliptic`, r.sLat, r.lat, 0.05, ' deg');
        check(`${tag} ${r.id}: distance from the Sun (scene units)`, r.dist, r.want, r.want * 0.001);
      }
    }
    // Now returns to live time.
    const live = await page.evaluate(() => { const y = window.youAreHere; y.clock.setLive(); return { live: y.clock.live, off: Math.abs(y.clock.now() - Date.now()) }; });
    truthy('Now returns to live time', live.live && live.off < 2000);
    // The time bar is on screen and shows the date.
    const bar = await page.evaluate(() => ({ date: document.querySelector('#timeDate').textContent, visible: !!document.querySelector('#timebar').getClientRects().length }));
    truthy('date on screen', bar.visible && /\d{4}/.test(bar.date), bar.date);
  } catch (err) {
    failed++;
    results.push('FAIL  ' + (err && err.message ? err.message : err));
  } finally {
    await browser.close();
  }
  for (const e of errors) { failed++; results.push('FAIL  page ' + e); }
  console.log(results.join('\n'));
  console.log(failed ? `\n${failed} BROWSER SCIENCE CHECK(S) FAILED` : '\nALL BROWSER SCIENCE CHECKS PASSED');
  process.exit(failed ? 1 : 0);
})();
