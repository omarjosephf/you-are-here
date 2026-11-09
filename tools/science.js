// Science checks for the galaxy model (no browser needed):  node science.js
// Each check compares the model with a published figure. Exits 1 if any fails.
require('../galaxy-model.js');
const G = globalThis.YouAreHereGalaxy;

let failed = 0;
function check(name, value, expected, tolerance, unit = '') {
  const ok = Math.abs(value - expected) <= tolerance;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${value.toFixed(2)}${unit} (expected ${expected}${unit} +/- ${tolerance})`);
}

// 1. The Sun is R0 = 8.15 kpc from the centre (Reid et al. 2019).
const [sx, sy, sz] = G.sunPosition;
check('Sun to galactic centre', Math.hypot(sx, sz) / G.S, 8.15, 0.001, ' kpc');

// 2. Fourth-quadrant tangent directions of the arms (Reid et al. 2019, Table 2,
//    "l Tangency"). The tangent point is where the arm reaches its smallest
//    longitude in the fourth quadrant (270-360 degrees).
const curves = G.armCurves();
function q4Tangency(id) {
  let best = 360;
  for (const c of curves.filter((x) => x.arm.id === id)) {
    for (const [b, r] of c.pts) {
      const [X, Y] = G.polarToXYZ(r, b);
      const l = G.longitudeOf(X, Y);
      if (l > 270 && l < best) best = l;
    }
  }
  return best;
}
// The Scutum-Centaurus and Sagittarius-Carina tangents lie in the extended
// parts of the model, so they test the extension choice too.
check('Scutum-Centaurus tangent longitude', q4Tangency('sctcen'), 306.1, 3, ' deg');
check('Sagittarius-Carina tangent longitude', q4Tangency('sgrcar'), 285.6, 5, ' deg');
check('Norma tangent longitude', q4Tangency('norma'), 327.5, 3, ' deg');
check('Near 3 kpc arm tangent longitude', q4Tangency('near3'), 337.0, 3, ' deg');

// 3. The Sun sits near the inner edge of the Orion (Local) Arm: the arm's
//    centre line at the Sun's azimuth is a little further out than the Sun.
const local = G.ARMS.find((a) => a.id === 'local');
const gap = G.measuredR(local, 0) - G.R0;
console.log(`INFO  Orion Arm centre line is ${(gap * 1000).toFixed(0)} pc outside the Sun (fitted 1-sigma width ${local.width * 1000} pc)`);
check('Sun inside the Orion Arm, towards its inner side (gap in kpc)', gap, 0.35, 0.25, ' kpc');

// 4. The bar's near end is at positive longitude, 28-33 degrees from the Sun-centre line.
const nearEnd = G.polarToXYZ(G.BAR.halfLength, G.BAR.angle);
const lEnd = G.longitudeOf(nearEnd[0], nearEnd[1]);
console.log(`INFO  bar near end at longitude ${lEnd.toFixed(1)} deg`);
if (!(lEnd > 0 && lEnd < 90)) { failed++; console.log('FAIL  bar near end should be at positive longitude'); } else console.log('PASS  bar near end at positive longitude');
check('Bar angle to the Sun-centre line', G.BAR.angle, 30.5, 2.5, ' deg');

// 5. A full sample is valid: no missing numbers, nothing far outside the disc.
const s = G.sample(100000);
let bad = 0;
let maxR = 0;
for (let i = 0; i < s.radii.length; i++) {
  if (!Number.isFinite(s.positions[i * 3]) || !Number.isFinite(s.positions[i * 3 + 1]) || !Number.isFinite(s.positions[i * 3 + 2])) bad++;
  maxR = Math.max(maxR, s.radii[i] / G.S);
}
if (bad) { failed++; console.log(`FAIL  ${bad} stars have invalid positions`); } else console.log('PASS  100,000 stars, all valid');
if (maxR > 16.01) { failed++; console.log(`FAIL  largest star radius ${maxR.toFixed(2)} kpc (should be at most 16)`); } else console.log(`PASS  largest star radius ${maxR.toFixed(2)} kpc (at most 16)`);

// ---------------------------------------------------------------------
// Stage 3: the clock, the frames and the scale system (sky.js), checked
// against Astronomy Engine's own answers for fixed dates.
require('../sky.js');
const SK = globalThis.YouAreHereSky;
const AE = SK.A;
const DATES = [Date.UTC(1950, 2, 20, 6, 0), Date.UTC(2000, 0, 1, 12, 0), Date.UTC(2026, 10, 9, 18, 30), Date.UTC(2080, 6, 4, 23, 15)];
const wrap180 = (x) => ((x % 360) + 540) % 360 - 180;
// Independent J2000 ecliptic longitude and latitude from a J2000 equatorial
// vector, using the IAU 1976 obliquity at J2000 (23.4392911 deg). (Astronomy
// Engine's Ecliptic() uses the ecliptic of date, which drifts by precession.)
const EPS = 23.4392911 * Math.PI / 180;
function eclJ2000(v) {
  const y = v.y * Math.cos(EPS) + v.z * Math.sin(EPS);
  const z = -v.y * Math.sin(EPS) + v.z * Math.cos(EPS);
  const r = Math.hypot(v.x, y, z);
  return { elon: Math.atan2(y, v.x) * 180 / Math.PI, elat: Math.asin(z / r) * 180 / Math.PI };
}
function localOf(M, v) { // M^T v (scene -> Earth's own frame)
  return [M[0] * v[0] + M[3] * v[1] + M[6] * v[2], M[1] * v[0] + M[4] * v[1] + M[7] * v[2], M[2] * v[0] + M[5] * v[1] + M[8] * v[2]];
}
for (const ms of DATES) {
  const tag = new Date(ms).toISOString().slice(0, 16);
  const t = AE.MakeTime(new Date(ms));
  // (a) Earth's lit side faces the Sun: the point with the Sun overhead in
  //     the scene matches the Sun's declination and (RA - sidereal time).
  const loc = localOf(SK.earthMatrix(ms), SK.norm3(SK.geoVector('Sun', ms)));
  const lat = Math.asin(loc[1]) / SK.DEG;
  const lon = Math.atan2(-loc[2], loc[0]) / SK.DEG;
  const eq = AE.Equator('Sun', t, new AE.Observer(0, 0, 0), true, true);
  check(`${tag} subsolar latitude`, lat, eq.dec, 0.02, ' deg');
  check(`${tag} subsolar longitude error`, wrap180(lon - (eq.ra - AE.SiderealTime(t)) * 15), 0, 0.05, ' deg');
  // (b) The Moon's direction in the scene matches Astronomy Engine's ecliptic longitude and latitude.
  const m = SK.geoVector('Moon', ms);
  const ecl = eclJ2000(AE.GeoMoon(t));
  const mLon = Math.atan2(-m[2], m[0]) / SK.DEG;
  const mLat = Math.asin(m[1] / SK.len3(m)) / SK.DEG;
  check(`${tag} Moon ecliptic longitude error`, wrap180(mLon - ecl.elon), 0, 0.01, ' deg');
  check(`${tag} Moon ecliptic latitude`, mLat, ecl.elat, 0.01, ' deg');
  // (c) The Moon's phase: the lit fraction matches (1 - cos(elongation)) / 2, near enough.
  const p = SK.moonPhase(ms);
  const sun = SK.norm3(SK.geoVector('Sun', ms));
  const elong = Math.acos(SK.dot3(sun, SK.norm3(m)));
  check(`${tag} Moon lit fraction vs elongation`, p.fraction, (1 - Math.cos(elong)) / 2, 0.02);
  // (d) Planets: heliocentric directions in the scene match Astronomy Engine.
  for (const b of ['Mercury', 'Jupiter', 'Neptune', 'Pluto']) {
    const v = SK.helioVector(b, ms);
    const e = eclJ2000(AE.HelioVector(b, t));
    check(`${tag} ${b} heliocentric longitude error`, wrap180(Math.atan2(-v[2], v[0]) / SK.DEG - e.elon), 0, 0.01, ' deg');
  }
}
// (e) The direction to the galactic centre, seen from Earth, is in Sagittarius.
const gcName = SK.constellationOf(SK.galacticToScene(0, 0));
if (gcName !== 'Sagittarius') { failed++; console.log(`FAIL  galactic centre seen from Earth is in ${gcName}`); } else console.log('PASS  galactic centre seen from Earth is in Sagittarius');
// (f) The galactic plane meets the ecliptic at about 60 degrees (Swinburne).
const ngp = SK.galacticToScene(0, 90);
check('angle between galactic plane and ecliptic', Math.acos(ngp[1]) / SK.DEG, 60.2, 0.5, ' deg');
// (g) The clock: rates, range and live time.
const ck = SK.createClock({ now: () => Date.UTC(2026, 10, 9) });
ck.setRate(3600); ck.tick(2);
check('clock at 1 hour a second, after 2 s', (ck.now() - Date.UTC(2026, 10, 9)) / 3600e3, 2, 1e-9, ' h');
ck.setRate(-86400); ck.tick(1);
check('clock backwards 1 day a second, after 1 s', (ck.now() - Date.UTC(2026, 10, 9)) / 3600e3, -22, 1e-9, ' h');
ck.setDate(Date.UTC(1900, 0, 1, 0, 0, 5), true); ck.setRate(-60);
const edge = ck.tick(1);
if (!(edge && ck.paused && ck.now() === SK.RANGE.min)) { failed++; console.log('FAIL  clock stops at 1900'); } else console.log('PASS  clock stops at the start of 1900');
ck.setLive();
if (!(ck.live && ck.now() === Date.UTC(2026, 10, 9))) { failed++; console.log('FAIL  Now returns to live time'); } else console.log('PASS  Now returns to live time');
// (h) Eclipses: the next solar eclipse after 9 Nov 2026 is the annular
//     eclipse of 6 February 2027, then the total eclipse of 2 August 2027.
const ne = SK.nextSolarEclipse(Date.UTC(2026, 10, 9));
if (!(ne.kind === 'annular' && new Date(ne.peak).toISOString().startsWith('2027-02-06'))) { failed++; console.log('FAIL  next solar eclipse', ne.kind, new Date(ne.peak).toISOString()); } else console.log('PASS  next solar eclipse: annular, 6 February 2027');
const te = SK.nextSolarEclipse(Date.UTC(2027, 6, 1));
if (!(te.kind === 'total' && new Date(te.peak).toISOString().startsWith('2027-08-02'))) { failed++; console.log('FAIL  total eclipse of 2 August 2027', te.kind, new Date(te.peak).toISOString()); } else console.log('PASS  total solar eclipse of 2 August 2027');
// The Moon is fully in Earth's umbra at the peak of the total lunar eclipse of 7 September 2025.
const le = SK.nextLunarEclipse(Date.UTC(2025, 8, 1));
check('umbra coverage at the peak of the 7 Sep 2025 lunar eclipse', SK.lunarShadow(le.peak).umbra, 1, 0.001);
// (i) Scale system: Earth is 2 units; true scale keeps sizes and distances in proportion.
check('true scale: 1 AU in Earth radii', SK.distanceUnits(1, 'trueScale') / 2, SK.AU_KM / SK.EARTH_R_KM, 1e-6);
check('true sizes: Jupiter / Earth radius', SK.radiusUnits(142984, 'trueSizes') / SK.radiusUnits(12756, 'trueSizes'), 142984 / 12756, 1e-9);
check('illustrative: Earth at 1 AU sits 70 units from the Sun', SK.distanceUnits(1, 'illustrative'), 70, 1e-9);

// ---------------------------------------------------------------------
// Stage 4: tilt and spin of every body from the IAU model (sky.bodyMatrix),
// against the NASA Planetary Fact Sheet's axial tilts (PLAN.md, section 6).
// The tilt is the angle between the spin vector and the orbit's normal (from
// Astronomy Engine's heliocentric position and velocity); over 90 degrees
// means it spins backwards.
{
  const T0 = Date.UTC(2026, 10, 9);
  const TILT = { Mercury: 0.034, Venus: 177.4, Earth: 23.4, Mars: 25.2, Jupiter: 3.1, Saturn: 26.7, Uranus: 97.8, Neptune: 28.3, Pluto: 119.5 };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  for (const body of Object.keys(TILT)) {
    const dt = 60e3; // one minute
    const M0 = body === 'Earth' ? SK.earthMatrix(T0) : SK.bodyMatrix(body, T0);
    const M1 = body === 'Earth' ? SK.earthMatrix(T0 + dt) : SK.bodyMatrix(body, T0 + dt);
    // Spin vector: the axis the body's frame turns about, signed by the turn.
    const col = (M, j) => [M[j], M[3 + j], M[6 + j]];
    const x0 = col(M0, 0), x1 = col(M1, 0), y0 = col(M0, 1);
    const turn = cross(x0, x1); // points along +spin for a small turn
    const spinSign = Math.sign(SK.dot3(turn, y0));
    const spin = y0.map((v) => v * spinSign); // the pole the body turns anticlockwise about
    const p0 = SK.helioVector(body, T0);
    const p1 = SK.helioVector(body, T0 + 864e5);
    const n = SK.norm3(cross(p0, p1.map((v, i) => v - p0[i])));
    const tilt = Math.acos(Math.max(-1, Math.min(1, SK.dot3(spin, n)))) / SK.DEG;
    check(`${body} axial tilt to its orbit`, tilt, TILT[body], 1.0, ' deg');
  }
}
console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL SCIENCE CHECKS PASSED');
process.exit(failed ? 1 : 0);
