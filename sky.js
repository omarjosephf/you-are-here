/*  You Are Here: sky.js
    ------------------------------------------------------------------
    One clock, one set of coordinate frames and one scale system for
    everything that depends on time or position. All the astronomy comes
    from Astronomy Engine (astronomy.browser.min.js, MIT licence, by Don
    Cross), which is accurate to within about 1 arcminute for the Sun, the
    Moon and the planets.

    The clock
      Live (real time) or simulated. A simulated clock can run at any rate,
      forwards or backwards, or be paused. It is bounded to 1900-2100 (a
      decision made on 9 November 2026). The city lights on Earth are
      modern satellite data, so the further a date is from today the less
      true the night side looks.

    Frames (all right-handed)
      J2000 ecliptic (ECL): X towards the March equinox of J2000, Z towards
        the north ecliptic pole. The solar system is built in this frame.
      Galactic (GAL, IAU 1958): X towards the galactic centre, Z towards the
        north galactic pole. The galaxy (galaxy-model.js) is built in it.
      Astronomy Engine's rotation matrices join them (EQJ = J2000 equator),
      so the galactic plane meets the ecliptic at about 60 degrees.
      In the scene (Three.js, y up) every frame maps the same way:
        scene x = X, scene y = Z, scene z = -Y.

    The scale system: "separate worlds per scale"
      The galaxy and the solar system are two separate scenes (worlds), each
      with its own units, joined by the journey through Sol. Inside the
      solar-system world, Earth's centre is the origin and Earth's radius is
      always 2 scene units. Everything is placed from its real position
      (Astronomy Engine) through one of four modes:
        illustrative   sizes enlarged (the Sun shrunk), distances compressed
        trueSizes      sizes to scale, distances compressed
        trueDistances  distances to scale, sizes enlarged
        trueScale      sizes and distances both to scale
      Three.js computes each object's model-view matrix in double precision
      on the CPU, so bodies far from the origin stay steady (camera-relative
      positions), and main.js moves the camera's near and far planes with
      the zoom so the depth buffer keeps its precision at every scale.

    Loaded as a classic script (window.YouAreHereSky) and by the Node tests.
*/
(function (root) {
  'use strict';
  const A = root.Astronomy || (typeof require === 'function' ? require('./astronomy.browser.min.js') : null);
  if (!A) return;

  const DEG = Math.PI / 180;
  const DAY_MS = 864e5;
  const AU_KM = 149597870.7;            // IAU 2012 (exact)
  // Earth's radius for the scene's scale: half the 12,756 km equatorial
  // diameter in the NASA Planetary Fact Sheet, the same kind of diameter the
  // fact sheet gives for every planet, so true sizes keep its exact ratios.
  const EARTH_R_KM = 6378.0;
  const EARTH_R = 2;                    // Earth's radius in scene units (every mode)
  const SUN_R_KM = 695700;              // IAU 2015 nominal solar radius
  const MOON_R_KM = 1737.4;             // NASA Moon Fact Sheet, volumetric mean radius
  const RANGE = { min: Date.UTC(1900, 0, 1, 0, 0, 0), max: Date.UTC(2100, 11, 31, 23, 59, 59) };

  // ---- frames -----------------------------------------------------------
  const ROT = {
    EQJ_ECL: A.Rotation_EQJ_ECL(),
    ECL_EQJ: A.Rotation_ECL_EQJ(),
    GAL_EQJ: A.Rotation_GAL_EQJ(),
    EQJ_GAL: A.Rotation_EQJ_GAL(),
  };
  ROT.GAL_ECL = A.CombineRotation(ROT.GAL_EQJ, ROT.EQJ_ECL);
  ROT.ECL_GAL = A.CombineRotation(ROT.ECL_EQJ, ROT.EQJ_GAL);

  const timeOf = (ms) => A.MakeTime(new Date(ms));
  const toScene = (v) => [v.x, v.z, -v.y];
  const fromScene = (s, t) => new A.Vector(s[0], -s[2], s[1], t);
  const len3 = (v) => Math.hypot(v[0], v[1], v[2]);
  const norm3 = (v) => { const l = len3(v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const eqjToScene = (v) => toScene(A.RotateVector(ROT.EQJ_ECL, v));

  // A direction given in galactic longitude and latitude (degrees), in the
  // solar system's scene frame (J2000 ecliptic).
  function galacticToScene(lDeg, bDeg) {
    const l = lDeg * DEG;
    const b = bDeg * DEG;
    const g = new A.Vector(Math.cos(b) * Math.cos(l), Math.cos(b) * Math.sin(l), Math.sin(b), timeOf(Date.UTC(2000, 0, 1, 12)));
    return toScene(A.RotateVector(ROT.GAL_ECL, g));
  }
  // A scene direction in the solar system (ecliptic) turned into the
  // galaxy's scene frame (galactic), e.g. to tilt the solar system's plane
  // correctly inside the galaxy.
  function eclipticSceneToGalacticScene(s) {
    return toScene(A.RotateVector(ROT.ECL_GAL, fromScene(s, timeOf(Date.UTC(2000, 0, 1, 12)))));
  }
  // The constellation a scene direction (ecliptic frame) points into.
  function constellationOf(s, ms) {
    const eq = A.EquatorFromVector(A.RotateVector(ROT.ECL_EQJ, fromScene(s, timeOf(ms || Date.UTC(2000, 0, 1, 12)))));
    return A.Constellation(eq.ra, eq.dec).name;
  }

  // ---- positions (scene frame, astronomical units) ----------------------
  // Geocentric: the apparent direction from Earth's centre (with light time
  // and aberration), as you would see it in the sky.
  function geoVector(body, ms) {
    const t = timeOf(ms);
    if (body === 'Moon') return eqjToScene(A.GeoMoon(t));
    return eqjToScene(A.GeoVector(body, t, true));
  }
  // Heliocentric: from the Sun's centre (geometric, no light time).
  function helioVector(body, ms) {
    return eqjToScene(A.HelioVector(body, timeOf(ms)));
  }

  // Earth's orientation: a 3x3 matrix (row-major) taking a direction in
  // Earth's own frame, written the way earth.js writes it (x towards
  // longitude 0, y towards the north pole, z towards longitude 90 W), into
  // the scene frame. Uses the apparent sidereal time and the precession and
  // nutation from Astronomy Engine.
  let eqdCache = { ms: NaN, rot: null };
  function earthMatrix(ms) {
    const t = timeOf(ms);
    if (!(Math.abs(ms - eqdCache.ms) < DAY_MS)) eqdCache = { ms, rot: A.Rotation_EQD_EQJ(t) };
    const theta = A.SiderealTime(t) * 15 * DEG;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    // Earth-fixed (X lon 0, Y lon 90 E, Z north) -> equator of date: turn by theta about Z.
    const col = (X, Y, Z) => {
      const v = new A.Vector(c * X - s * Y, s * X + c * Y, Z, t);
      return toScene(A.RotateVector(ROT.EQJ_ECL, A.RotateVector(eqdCache.rot, v)));
    };
    const cx = col(1, 0, 0);   // local x = Earth-fixed X
    const cy = col(0, 0, 1);   // local y = Earth-fixed Z (north)
    const cz = col(0, -1, 0);  // local z = -Earth-fixed Y
    return [cx[0], cy[0], cz[0], cx[1], cy[1], cz[1], cx[2], cy[2], cz[2]];
  }

  // Any body's orientation from the IAU rotation model (Astronomy Engine's
  // RotationAxis): its north pole and how far it has spun. Same layout as
  // earthMatrix. Bodies that spin backwards (Venus, Uranus, Pluto) come out
  // spinning backwards, because the angle W decreases or the pole points
  // south of the ecliptic, as the IAU defines it.
  function bodyMatrix(body, ms) {
    const t = timeOf(ms);
    const ax = A.RotationAxis(body, t);
    const n = [ax.north.x, ax.north.y, ax.north.z];
    // Q: the ascending node of the body's equator on the J2000 equator.
    let q = [-n[1], n[0], 0];
    const ql = Math.hypot(q[0], q[1]);
    q = ql > 1e-9 ? [q[0] / ql, q[1] / ql, 0] : [1, 0, 0];
    const nq = [n[1] * q[2] - n[2] * q[1], n[2] * q[0] - n[0] * q[2], n[0] * q[1] - n[1] * q[0]];
    const w = ax.spin * DEG;
    const ex = [0, 1, 2].map((i) => Math.cos(w) * q[i] + Math.sin(w) * nq[i]);
    const ey = [n[1] * ex[2] - n[2] * ex[1], n[2] * ex[0] - n[0] * ex[2], n[0] * ex[1] - n[1] * ex[0]];
    const sc = (v) => eqjToScene(new A.Vector(v[0], v[1], v[2], t));
    const cx = sc(ex);
    const cy = sc(n);
    const cz = sc(ey.map((x) => -x));
    return [cx[0], cy[0], cz[0], cx[1], cy[1], cz[1], cx[2], cy[2], cz[2]];
  }
  // The north pole direction alone (scene frame), for orbit and ring planes.
  function poleOf(body, ms) {
    const ax = A.RotationAxis(body, timeOf(ms));
    return eqjToScene(ax.north);
  }

  // ---- the Moon -----------------------------------------------------------
  const PHASE_NAMES = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
  function moonPhase(ms, withNext) {
    const t = timeOf(ms);
    const angle = A.MoonPhase(t); // 0 new, 90 first quarter, 180 full, 270 last quarter
    const ill = A.Illumination('Moon', t);
    const out = {
      angle,
      name: PHASE_NAMES[Math.round(angle / 45) % 8],
      fraction: ill.phase_fraction,
      lit: Math.round(ill.phase_fraction * 100),
      waxing: angle < 180,
    };
    if (withNext) {
      const full = A.SearchMoonPhase(180, t, 40);
      out.nextFull = full ? full.date.getTime() : null;
    }
    return out;
  }

  // How much of the Moon is inside Earth's shadow right now (0..1 each), from
  // the real geometry: the umbra's and penumbra's angular radii at the Moon's
  // distance (the usual formula, enlarged 2% for Earth's atmosphere, as in
  // the Explanatory Supplement to the Astronomical Almanac), against how far
  // the Moon is from the point opposite the Sun.
  function lunarShadow(ms) {
    const sun = geoVector('Sun', ms);
    const moon = geoVector('Moon', ms);
    const ds = len3(sun) * AU_KM;
    const dm = len3(moon) * AU_KM;
    const pS = Math.asin(EARTH_R_KM / ds);
    const pM = Math.asin(EARTH_R_KM / dm);
    const sS = Math.asin(SUN_R_KM / ds);
    const rM = Math.asin(MOON_R_KM / dm);
    const umbra = 1.02 * (pM + pS - sS);
    const pen = 1.02 * (pM + pS + sS);
    const anti = norm3(sun).map((x) => -x);
    const sep = Math.acos(Math.max(-1, Math.min(1, dot3(anti, norm3(moon)))));
    const cover = (r) => Math.max(0, Math.min(1, (r + rM - sep) / (2 * rM)));
    return { umbra: cover(umbra), penumbra: cover(pen), separation: sep / DEG };
  }

  // ---- eclipses (real predictions from Astronomy Engine) ----------------
  // The next solar eclipse after ms, with where it is greatest and what an
  // observer there sees (contact times).
  function nextSolarEclipse(ms) {
    let g = A.SearchGlobalSolarEclipse(timeOf(ms));
    if (g.peak.date.getTime() > RANGE.max) g = A.SearchGlobalSolarEclipse(timeOf(RANGE.min));
    const peak = g.peak.date.getTime();
    const lat = g.latitude;
    const lon = g.longitude;
    const out = { kind: g.kind, peak, lat, lon, obscuration: g.obscuration, local: null };
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      const loc = A.SearchLocalSolarEclipse(timeOf(peak - 6 * 3600e3), new A.Observer(lat, lon, 0));
      const ev = (e) => (e ? e.time.date.getTime() : null);
      out.local = {
        kind: loc.kind,
        partialBegin: ev(loc.partial_begin), totalBegin: ev(loc.total_begin), peak: ev(loc.peak),
        totalEnd: ev(loc.total_end), partialEnd: ev(loc.partial_end), obscuration: loc.obscuration,
      };
    }
    return out;
  }
  function nextLunarEclipse(ms) {
    let e = A.SearchLunarEclipse(timeOf(ms));
    if (e.peak.date.getTime() > RANGE.max) e = A.SearchLunarEclipse(timeOf(RANGE.min));
    const peak = e.peak.date.getTime();
    return { kind: e.kind, peak, obscuration: e.obscuration, halfPenumbral: e.sd_penum * 60e3, halfPartial: e.sd_partial * 60e3, halfTotal: e.sd_total * 60e3 };
  }
  // The Sun and Moon as seen from a place on Earth (topocentric): directions
  // in the scene frame, and their angular radii (radians).
  function topocentric(ms, lat, lon) {
    const t = timeOf(ms);
    const obs = new A.Observer(lat, lon, 0);
    const one = (body, rKm) => {
      const eq = A.Equator(body, t, obs, false, true);
      const v = eqjToScene(eq.vec);
      const dKm = len3(v) * AU_KM;
      return { dir: norm3(v), radius: Math.asin(rKm / dKm), distKm: dKm };
    };
    return { sun: one('Sun', SUN_R_KM), moon: one('Moon', MOON_R_KM) };
  }

  // ---- the scale system ---------------------------------------------------
  // au: scene units per AU; power: distances go as r^power (1 = to scale).
  // sizes: 'enlarged' uses radius = 2 * (diameter / Earth's)^0.42 for the
  // planets and moons, so small worlds stay visible; the Sun is shrunk to 6
  // units so it doesn't swallow the inner planets.
  const SCALE_MODES = {
    illustrative: { id: 'illustrative', label: 'Illustrative', sizes: 'enlarged', distances: 'compressed', au: 70, power: 0.5, moonDist: 10,
      badge: 'Not to scale: planets enlarged, the Sun shrunk, distances compressed' },
    trueSizes: { id: 'trueSizes', label: 'True sizes', sizes: 'true', distances: 'compressed', au: 640, power: 0.5, moonDist: 10,
      badge: 'Sizes to scale; distances compressed' },
    trueDistances: { id: 'trueDistances', label: 'True distances', sizes: 'enlarged', distances: 'true', au: 1000, power: 1, moonDist: 10,
      badge: "Distances to scale; sizes enlarged (and the Moon's distance)" },
    trueScale: { id: 'trueScale', label: 'True scale', sizes: 'true', distances: 'true', au: AU_KM * EARTH_R / EARTH_R_KM, power: 1, moonDist: null,
      badge: 'Sizes and distances to scale' },
  };
  const ENLARGE_POWER = 0.42;
  const ILLUSTRATIVE_SUN_R = 6;
  const EARTH_D_KM = EARTH_R_KM * 2;
  function radiusUnits(diameterKm, mode, isSun) {
    const m = SCALE_MODES[mode] || SCALE_MODES.illustrative;
    if (m.sizes === 'true') return EARTH_R * diameterKm / EARTH_D_KM;
    if (isSun) return ILLUSTRATIVE_SUN_R;
    return EARTH_R * Math.pow(diameterKm / EARTH_D_KM, ENLARGE_POWER);
  }
  function distanceUnits(rAU, mode) {
    const m = SCALE_MODES[mode] || SCALE_MODES.illustrative;
    return m.au * Math.pow(Math.max(0, rAU), m.power);
  }
  // A heliocentric vector (AU) placed in scene units: same direction, its
  // length mapped by the mode.
  function placeHelio(v, mode) {
    const r = len3(v);
    if (r < 1e-12) return [0, 0, 0];
    const d = distanceUnits(r, mode) / r;
    return [v[0] * d, v[1] * d, v[2] * d];
  }
  // A moon's distance from its planet in scene units. True when sizes and
  // distances are both to scale; otherwise spread out from the planet so
  // the moons clear its enlarged disc (planetR: the planet's scene radius).
  function moonDistanceUnits(aKm, planetRkm, planetR, mode, fixed) {
    const m = SCALE_MODES[mode] || SCALE_MODES.illustrative;
    if (m.sizes === 'true' && m.distances === 'true') return EARTH_R * aKm / EARTH_R_KM;
    if (fixed) return fixed;
    return planetR * (1.6 + 0.9 * Math.sqrt(aKm / planetRkm));
  }

  // ---- the clock ----------------------------------------------------------
  // Rates are simulated seconds per real second.
  const RATES = [-31557600, -2629800, -604800, -86400, -3600, -60, -1, 1, 60, 3600, 86400, 604800, 2629800, 31557600];
  const RATE_NAMES = {
    1: 'real time', 60: '1 minute a second', 3600: '1 hour a second', 86400: '1 day a second',
    604800: '1 week a second', 2629800: '1 month a second', 31557600: '1 year a second',
  };
  function rateName(r) {
    const base = RATE_NAMES[Math.abs(r)] || `${Math.abs(r)} times real time`;
    return r < 0 ? `${base}, backwards` : base;
  }
  function createClock(opts) {
    const o = Object.assign({ min: RANGE.min, max: RANGE.max, now: () => Date.now() }, opts || {});
    const st = { live: true, sim: o.now(), rate: 1, paused: false, hitEdge: 0 };
    const clampMs = (ms) => Math.min(o.max, Math.max(o.min, ms));
    const api = {
      get live() { return st.live; },
      get rate() { return st.live ? 1 : st.rate; },
      get paused() { return !st.live && st.paused; },
      get min() { return o.min; },
      get max() { return o.max; },
      now() { return st.live ? clampMs(o.now()) : st.sim; },
      // Advance by dt real seconds. Returns true when the clock just hit an
      // end of its range (and paused there).
      tick(dt) {
        if (st.live || st.paused) return false;
        const next = st.sim + dt * 1000 * st.rate;
        const c = clampMs(next);
        st.sim = c;
        if (c !== next) { st.paused = true; st.hitEdge++; return true; }
        return false;
      },
      setLive() { st.live = true; st.rate = 1; st.paused = false; },
      setDate(ms, keepRunning) {
        if (st.live) { st.rate = 1; st.paused = !keepRunning; }
        st.live = false;
        st.sim = clampMs(+ms);
        if (!keepRunning) st.paused = true;
      },
      setRate(r) {
        if (st.live) { st.sim = clampMs(o.now()); st.live = false; }
        st.rate = r;
        st.paused = false;
        if (r === 1 && Math.abs(st.sim - o.now()) < 2000) st.live = true;
      },
      setPaused(p) {
        if (st.live && p) { st.sim = clampMs(o.now()); st.live = false; st.rate = 1; }
        st.paused = !!p;
      },
      // One step along the rate ladder (dir +1 faster forwards, -1 towards backwards).
      stepRate(dir) {
        const cur = api.rate;
        let i = RATES.indexOf(cur);
        if (i < 0) i = RATES.indexOf(1);
        i = Math.max(0, Math.min(RATES.length - 1, i + dir));
        api.setRate(RATES[i]);
        return RATES[i];
      },
      snapshot() { return { live: st.live, sim: st.sim, rate: st.rate, paused: st.paused }; },
      restore(s) { if (!s) return; st.live = !!s.live; st.sim = clampMs(s.sim); st.rate = s.rate; st.paused = !!s.paused; },
    };
    return api;
  }

  root.YouAreHereSky = {
    A, DEG, AU_KM, EARTH_R_KM, EARTH_R, SUN_R_KM, MOON_R_KM, RANGE, ROT,
    toScene, fromScene, eqjToScene, timeOf, len3, norm3, dot3,
    galacticToScene, eclipticSceneToGalacticScene, constellationOf,
    geoVector, helioVector, earthMatrix, bodyMatrix, poleOf,
    moonPhase, lunarShadow, nextSolarEclipse, nextLunarEclipse, topocentric,
    SCALE_MODES, radiusUnits, distanceUnits, placeHelio, moonDistanceUnits,
    RATES, rateName, createClock,
  };
})(typeof window !== 'undefined' ? window : globalThis);
