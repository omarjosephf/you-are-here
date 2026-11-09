// Stage 7 checks: the moons' distances against JPL's mean elements (Io,
// Europa, Ganymede and Callisto come from Astronomy Engine, so this checks
// them independently), Triton going round backwards, Saturn's ring edges
// against NASA's fact sheet, the belts' ranges; screenshots of each.
//   CHROME_PATH=<path to Chrome> node stage7-check.js [phone]
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
    await page.evaluate(() => window.youAreHere.journeyTo('earth'));
    await page.waitForFunction(() => window.youAreHere.world === 'earth' && !window.youAreHere.journey, null, { timeout: 30000 });
    const r = await page.evaluate(() => {
      const y = window.youAreHere;
      const A = y.sky.A;
      const ms = Date.UTC(2026, 10, 9);
      // JPL semi-major axes (km), PLAN.md section 6. Average the distance over one orbit.
      const A_KM = { io: 421800, europa: 671100, ganymede: 1070400, callisto: 1882700, titan: 1221900, triton: 354800, charon: 19600 };
      const P_D = { io: 1.762732, europa: 3.525463, ganymede: 7.155588, callisto: 16.690440, titan: 15.945448, triton: 5.8792, charon: 6.387222 };
      const out = {};
      for (const id of Object.keys(A_KM)) {
        let sum = 0;
        const N = 48;
        for (let k = 0; k < N; k++) { const v = y.moons.offsetKm(id, ms + (k / N) * P_D[id] * 864e5); sum += Math.hypot(v[0], v[1], v[2]); }
        out[id] = sum / N / A_KM[id];
      }
      // Which way each goes round, against its planet's north (positive) pole.
      const sense = (id, body) => {
        const a = y.moons.offsetKm(id, ms);
        const b = y.moons.offsetKm(id, ms + 3600e3);
        const h = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
        const n = A.RotationAxis(body, A.MakeTime(new Date(ms))).north;
        return Math.sign(h[0] * n.x + h[1] * n.y + h[2] * n.z);
      };
      return { ratio: out, triton: sense('triton', 'Neptune'), titan: sense('titan', 'Saturn'), io: sense('io', 'Jupiter'), charon: sense('charon', 'Pluto'), rings: y.moons.ringEdges() };
    });
    for (const [id, q] of Object.entries(r.ratio)) say(Math.abs(q - 1) < 0.03, `${id}: average distance is ${(q * 100).toFixed(1)}% of JPL's semi-major axis`);
    say(r.triton < 0, 'Triton goes round Neptune backwards (retrograde)');
    say(r.titan > 0 && r.io > 0 && r.charon > 0, 'Titan, Io and Charon go round forwards');
    say(Math.abs(r.rings[0] - 66900) < 300 && Math.abs(r.rings[1] - 140026) < 300, `Saturn's rings span ${Math.round(r.rings[0]).toLocaleString()} to ${Math.round(r.rings[1]).toLocaleString()} km (NASA: D ring from 66,900; F ring at 139,826)`);

    for (const id of ['jupiter', 'saturn', 'neptune', 'pluto']) {
      await page.evaluate((d) => window.youAreHere.goTo(d), id);
      await sleep(6000);
      if (id === 'jupiter' || id === 'pluto') await page.evaluate(() => { const y = window.youAreHere; y.view.goalRadius *= 3.5; });
      if (id === 'saturn') await page.evaluate(() => { const y = window.youAreHere; y.view.goalPhi = 1.15; y.view.goalRadius *= 1.4; });
      await sleep(3500);
      await shot(`${tag}-s7-${id}`);
    }
    await page.evaluate(() => window.youAreHere.goTo('system'));
    await sleep(7000);
    await shot(`${tag}-s7-belts`);
    const counts = await page.evaluate(() => ({ asteroids: window.youAreHere.moons.asteroidBelt.geometry.getAttribute('aOrbit').count, kuiper: window.youAreHere.moons.kuiperBelt.geometry.getAttribute('aOrbit').count }));
    console.log('INFO  belt particles:', JSON.stringify(counts));
  } catch (err) {
    errors.push('test: ' + err.message);
  } finally {
    await browser.close();
  }
  for (const e of errors) { failed++; console.log('FAIL  ' + e); }
  console.log(failed ? `${failed} STAGE 7 CHECK(S) FAILED` : 'ALL STAGE 7 CHECKS PASSED');
  process.exit(failed ? 1 : 0);
})();
