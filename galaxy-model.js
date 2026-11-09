/*  You Are Here: galaxy-model.js
    ------------------------------------------------------------------
    The shape of the Milky Way, as a model built from published
    measurements. Nobody can see our galaxy from outside, so this is a
    best estimate, not a photograph. The sources are named below.

    Spiral arms: Reid et al. 2019 (ApJ 885, 131), Table 2. They fitted
    log-periodic spirals to the measured distances (parallaxes) of about
    200 young, high-mass star-forming regions:
        ln(R / Rkink) = -(beta - betaKink) * tan(psi)
    R is the distance from the galactic centre (kpc). beta is the
    galactocentric azimuth: 0 towards the Sun, increasing in the direction
    the galaxy turns (clockwise seen from the north galactic pole). psi is
    the pitch angle, which may change at the kink.
    The measurements cover mostly our side of the galaxy. Beyond each
    measured range the arms are continued as smooth spirals (marked
    "extended" below): with the neighbouring measured pitch angle when it
    is at least 5 degrees, otherwise with 10 degrees, the average pitch of
    the major arms in the same paper. Those continuations are a modelling
    choice, not measurements.

    Central bar: half-length 5.0 kpc and 28-33 degrees to the Sun-centre
    line (Wegg, Gerhard & Portail 2015), with its near end at positive
    galactic longitude (Bland-Hawthorn & Gerhard 2016). The bulge's
    exponential scale lengths are 0.70 : 0.44 : 0.18 kpc (same review).

    Disc: exponential, scale length 2.6 kpc (the value assumed in
    Bland-Hawthorn & Gerhard 2016) and a thin-disc scale height of about
    0.3 kpc (Gaia DR3 gives 280 pc).

    Some numbers here are drawing choices, not measurements: how many stars
    each part gets, the long bar's thickness, and how far the 3 kpc arms
    extend. They are marked "drawing choice". The arms are drawn at the
    widths fitted to young star-forming regions; older stars spread wider.

    Coordinates. Galactocentric kpc: X from the Sun towards the centre, Y
    towards galactic longitude 90 degrees (the way the Sun moves), Z towards
    the north galactic pole. The Sun is at X = -R0, Y = 0. In the scene
    (Three.js, y up) a point goes to x = X * S, y = Z * S, z = -Y * S, with
    S = 1/3 scene unit per kpc, so the galaxy is about 5 units across its
    radius as before.

    This is a plain script (no modules), so the page still works when the
    .html file is double-clicked. It is also loaded by tools/science.js.
*/
(function (root) {
  'use strict';
  const DEG = Math.PI / 180;

  const R0 = 8.15;          // Sun to galactic centre, kpc (Reid et al. 2019: 8.15 +/- 0.15)
  const Z_SUN = 0.0055;     // Sun above the plane, kpc (Reid et al. 2019: 5.5 +/- 5.8 pc)
  const S = 1 / 3;          // scene units per kpc
  const R_OUT = 15.5;       // where the arms and disc are drawn to, kpc (drawing choice)
  const R_IN = 5.0;         // major arms start at about the bar's ends (bar half-length 5.0 kpc)
  const EXT_PITCH = 10;     // pitch for extended parts when the measured one is under 5 degrees

  // Reid et al. 2019, Table 2. width: 1-sigma width at Rkink, kpc.
  // betaRange: the measured range of azimuth.
  const ARMS = [
    { id: 'sctcen', name: 'Scutum-Centaurus Arm', major: true, betaRange: [0, 104], betaKink: 23, rKink: 4.91, psiBefore: 14.1, psiAfter: 12.1, width: 0.23 },
    { id: 'perseus', name: 'Perseus Arm', major: true, betaRange: [-23, 115], betaKink: 40, rKink: 8.87, psiBefore: 10.3, psiAfter: 8.7, width: 0.35 },
    { id: 'norma', name: 'Norma Arm', major: false, betaRange: [5, 54], betaKink: 18, rKink: 4.46, psiBefore: -1.0, psiAfter: 19.5, width: 0.14 },
    { id: 'sgrcar', name: 'Sagittarius-Carina Arm', major: false, betaRange: [2, 97], betaKink: 24, rKink: 6.04, psiBefore: 17.1, psiAfter: 1.0, width: 0.27 },
    { id: 'local', name: 'Orion Arm', note: 'the Local Arm', major: false, betaRange: [-8, 34], betaKink: 9, rKink: 8.26, psiBefore: 11.4, psiAfter: 11.4, width: 0.31 },
    { id: 'outer', name: 'Outer Arm', major: false, betaRange: [-16, 71], betaKink: 18, rKink: 12.24, psiBefore: 3.0, psiAfter: 9.4, width: 0.65 },
    { id: 'near3', name: 'Near 3 kpc Arm', major: false, betaRange: [15, 18], betaKink: 15, rKink: 3.52, psiBefore: -4.2, psiAfter: -4.2, width: 0.18 },
  ];

  // How each arm is extended past its measured range (drawing choices).
  //   outTo: stop extending outwards (decreasing beta) at this radius, kpc
  //   inTo: stop extending inwards (increasing beta) at this radius, kpc
  //   span: for the 3 kpc arms, the azimuth range drawn, degrees
  const EXTEND = {
    sctcen: { outTo: R_OUT, inTo: R_IN },
    perseus: { outTo: R_OUT, inTo: R_IN },
    sgrcar: { outTo: R_OUT, inTo: R_IN },
    // Norma keeps its measured, nearly circular pitch through the fourth
    // quadrant (as the paper's tangent-direction priors do), then continues
    // outwards into the Outer Arm (together, the Norma-Outer arm).
    norma: { joinOuter: true, keepPitchTo: -60, inTo: 3.5 },
    outer: { outTo: R_OUT },               // its inner end is where the Norma Arm arrives
    local: {},                             // a short segment: not extended
    near3: { span: [-70, 40] },            // drawing choice, reaching its tangent direction; the far 3 kpc arm mirrors it
  };

  // Stars per part, as shares of the total (drawing choices).
  const SHARE = { arms: 0.64, disc: 0.2, bar: 0.16 };
  const ARM_WEIGHT = { sctcen: 1.0, perseus: 1.0, norma: 0.7, sgrcar: 0.7, outer: 0.55, local: 0.8, near3: 0.5, far3: 0.5 };
  const ARM_SPREAD = 1.0;   // arms drawn at the width fitted to the young star-forming regions

  const BAR = {
    halfLength: 5.0,       // kpc (Wegg, Gerhard & Portail 2015: 5.0 +/- 0.2)
    angle: 30,             // degrees from the Sun-centre line (28-33); near end at positive longitude
    halfWidth: 1.4,        // kpc, the long bar's half-width (drawing choice)
    height: 0.18,          // kpc, thin bar scale height (Wegg, Gerhard & Portail 2015, about 180 pc)
    bulge: [0.70, 0.44, 0.18], // kpc, exponential scale lengths along, across and up (review above)
  };
  const DISC = { scaleLength: 2.6, scaleHeight: 0.3, rMin: 2.0 };

  // ---- the arms as curves ------------------------------------------------
  // Radius (kpc) at azimuth beta (degrees) inside the measured range.
  function measuredR(arm, beta) {
    const psi = beta < arm.betaKink ? arm.psiBefore : arm.psiAfter;
    return arm.rKink * Math.exp(-(beta - arm.betaKink) * DEG * Math.tan(psi * DEG));
  }
  function extendPitch(psi) { return Math.abs(psi) >= 5 ? psi : EXT_PITCH; }

  // Builds each arm as a list of [beta, R, measured] points, 0.5 degrees apart.
  function armCurves() {
    const out = [];
    const step = 0.5;
    const outer = ARMS.find((a) => a.id === 'outer');
    const outerStartR = measuredR(outer, outer.betaRange[1]);
    for (const arm of ARMS) {
      const ext = EXTEND[arm.id];
      const pts = [];
      if (ext.span) {
        for (let b = ext.span[0]; b <= ext.span[1]; b += step) {
          const m = b >= arm.betaRange[0] && b <= arm.betaRange[1];
          pts.push([b, arm.rKink * Math.exp(-(b - arm.betaKink) * DEG * Math.tan(arm.psiBefore * DEG)), m]);
        }
        out.push({ arm, pts });
        // The far 3 kpc arm: the same shape on the other side of the centre.
        out.push({ arm: { id: 'far3', name: 'Far 3 kpc Arm', major: false, width: arm.width, rKink: arm.rKink }, pts: pts.map(([b, r]) => [b + 180, r, false]) });
        continue;
      }
      const [b0, b1] = arm.betaRange;
      // Outwards (decreasing beta), extended part, built backwards then reversed.
      const before = [];
      const limitOut = ext.joinOuter ? outerStartR : ext.outTo;
      if (limitOut) {
        let psi = extendPitch(arm.psiBefore);
        if (ext.joinOuter) {
          // The pitch that makes the arm arrive exactly where the Outer Arm
          // begins, one turn round (it comes out at about 12 degrees).
          const r1 = measuredR(arm, ext.keepPitchTo);
          const b1 = outer.betaRange[1] - 360;
          psi = Math.atan(Math.log(outerStartR / r1) / ((ext.keepPitchTo - b1) * DEG)) / DEG;
        }
        let bRef = b0;
        let rRef = measuredR(arm, b0);
        for (let b = b0 - step; b > b0 - 720; b -= step) {
          let r;
          if (ext.keepPitchTo !== undefined && b >= ext.keepPitchTo) {
            r = measuredR(arm, b); // the measured pitch, continued
            bRef = b;
            rRef = r;
          } else {
            r = rRef * Math.exp(-(b - bRef) * DEG * Math.tan(psi * DEG));
          }
          if (r > limitOut + 1e-6) break;
          before.push([b, r, false]);
        }
        before.reverse();
      }
      for (let b = b0; b <= b1 + 1e-9; b += step) pts.push([b, measuredR(arm, b), true]);
      const after = [];
      if (ext.inTo) {
        const psi = extendPitch(arm.psiAfter);
        const r1 = measuredR(arm, b1);
        for (let b = b1 + step; b < b1 + 720; b += step) {
          const r = r1 * Math.exp(-(b - b1) * DEG * Math.tan(psi * DEG));
          if (r < ext.inTo) break;
          after.push([b, r, false]);
        }
      }
      out.push({ arm, pts: before.concat(pts, after) });
    }
    return out;
  }

  // ---- coordinates -----------------------------------------------------------
  // Galactocentric (R kpc, beta degrees, Z kpc) to X, Y, Z kpc.
  function polarToXYZ(r, beta, z) {
    return [-r * Math.cos(beta * DEG), r * Math.sin(beta * DEG), z || 0];
  }
  // Galactocentric kpc to scene units (y up).
  function toScene(X, Y, Z, out, i) {
    out[i] = X * S;
    out[i + 1] = Z * S;
    out[i + 2] = -Y * S;
  }
  // Galactic longitude (degrees, 0..360) of a galactocentric point, seen from the Sun.
  function longitudeOf(X, Y) {
    const l = Math.atan2(Y, X + R0) / DEG;
    return (l + 360) % 360;
  }

  // ---- random helpers ----------------------------------------------------
  function gauss(rand) {
    let u = 0;
    while (u === 0) u = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  }
  const laplace = (rand, scale) => (rand() < 0.5 ? -1 : 1) * -Math.log(1 - rand()) * scale;

  // ---- sampling the stars ----------------------------------------------------
  // Returns positions (scene units, 3 per star), radii (scene units) and
  // part (0 bar/bulge, 1 disc, 2 arm) for count stars.
  function sample(count, rand = Math.random) {
    const positions = new Float32Array(count * 3);
    const radii = new Float32Array(count);
    const part = new Uint8Array(count);
    const curves = armCurves();

    // Arm points, weighted by length along the arm (and the arm's weight),
    // so the stars spread evenly along each arm.
    const segs = [];
    let total = 0;
    for (const { arm, pts } of curves) {
      const w = ARM_WEIGHT[arm.id] || 0.5;
      for (let k = 1; k < pts.length; k++) {
        const [ba, ra] = pts[k - 1];
        const [bb, rb] = pts[k];
        const [xa, ya] = polarToXYZ(ra, ba);
        const [xb, yb] = polarToXYZ(rb, bb);
        const len = Math.hypot(xb - xa, yb - ya);
        total += len * w;
        segs.push({ cum: total, arm, a: [ba, ra], b: [bb, rb] });
      }
    }
    const pickSeg = (u) => {
      let lo = 0;
      let hi = segs.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (segs[mid].cum < u) lo = mid + 1; else hi = mid; }
      return segs[lo];
    };
    // Arm width grows outwards: Reid et al. 2019 fit w(R) = 336 + 36 (R - 8.15) pc overall.
    const widthAt = (arm, r) => arm.width * (0.336 + 0.036 * (r - 8.15)) / (0.336 + 0.036 * (arm.rKink - 8.15));

    const nArm = Math.round(count * SHARE.arms);
    const nDisc = Math.round(count * SHARE.disc);
    const nBar = count - nArm - nDisc;
    const barDir = [-Math.cos(BAR.angle * DEG), Math.sin(BAR.angle * DEG)]; // towards the near end
    const barSide = [barDir[1], -barDir[0]];

    for (let i = 0; i < count; i++) {
      let X;
      let Y;
      let Z;
      if (i < nArm) {
        const s = pickSeg(rand() * total);
        const f = rand();
        const beta = s.a[0] + (s.b[0] - s.a[0]) * f;
        const r = s.a[1] + (s.b[1] - s.a[1]) * f;
        const sigma = Math.max(0.05, widthAt(s.arm, r)) * ARM_SPREAD;
        let rr;
        do { rr = r + gauss(rand) * sigma; } while (rr < 0.3 || rr > R_OUT + 0.5);
        const bb = beta + (gauss(rand) * sigma / rr) / DEG;
        [X, Y] = polarToXYZ(rr, bb);
        Z = laplace(rand, DISC.scaleHeight * 0.6);
        part[i] = 2;
      } else if (i < nArm + nDisc) {
        // Surface density exp(-R/Rd): P(R) is proportional to R exp(-R/Rd).
        let r;
        do { r = -DISC.scaleLength * Math.log(rand() * rand()); } while (r < DISC.rMin || r > R_OUT);
        const a = rand() * 360;
        [X, Y] = polarToXYZ(r, a);
        Z = laplace(rand, DISC.scaleHeight);
        part[i] = 1;
      } else {
        // Two thirds in the bulge (exponential scale lengths), the rest
        // along the long bar.
        let u;
        let v;
        if (i - nArm - nDisc < nBar * 0.66) {
          u = laplace(rand, BAR.bulge[0] * 1.6);
          v = laplace(rand, BAR.bulge[1] * 1.6);
          Z = laplace(rand, BAR.bulge[2] * 1.4);
        } else {
          u = (rand() * 2 - 1) * BAR.halfLength;
          const taper = 1 - Math.pow(Math.abs(u) / BAR.halfLength, 2);
          v = gauss(rand) * BAR.halfWidth * 0.45 * Math.sqrt(Math.max(0.05, taper));
          Z = laplace(rand, BAR.height);
        }
        X = u * barDir[0] + v * barSide[0];
        Y = u * barDir[1] + v * barSide[1];
        part[i] = 0;
      }
      toScene(X, Y, Z, positions, i * 3);
      radii[i] = Math.hypot(X, Y) * S;
    }
    return { positions, radii, part };
  }

  // Where to put each label (scene units): part way along each whole arm,
  // so the names spread round the galaxy instead of all sitting on our side.
  const LABEL_AT = { sctcen: 0.45, perseus: 0.5, sgrcar: 0.4, norma: 0.35, outer: 0.6, local: 0.5, near3: 0.5, far3: 0.5 };
  function labelSpots() {
    const spots = [];
    for (const { arm, pts } of armCurves()) {
      const [b, r] = pts[Math.floor((pts.length - 1) * (LABEL_AT[arm.id] ?? 0.5))];
      const [X, Y] = polarToXYZ(r, b);
      const p = new Float32Array(3);
      toScene(X, Y, 0.35, p, 0);
      spots.push({ id: arm.id, name: arm.name, major: !!arm.major, pos: p });
    }
    const centre = new Float32Array(3);
    toScene(0, 0, 0.9, centre, 0);
    spots.push({ id: 'centre', name: 'Galactic centre', major: true, pos: centre });
    const barEnd = new Float32Array(3);
    const [bx, by] = [-Math.cos(BAR.angle * DEG) * 3.2, Math.sin(BAR.angle * DEG) * 3.2];
    toScene(bx, by, 0.45, barEnd, 0);
    spots.push({ id: 'bar', name: 'Central bar', major: false, pos: barEnd });
    return spots;
  }

  // A random point on an arm's centre line (scene units), for "Surprise me".
  function randomArmPoint(rand = Math.random) {
    const curves = armCurves().filter((c) => c.arm.id !== 'near3' && c.arm.id !== 'far3');
    const c = curves[Math.floor(rand() * curves.length)];
    const [b, r] = c.pts[Math.floor(rand() * c.pts.length)];
    const [X, Y] = polarToXYZ(r, b);
    const p = new Float32Array(3);
    toScene(X, Y, 0, p, 0);
    return p;
  }

  const sun = new Float32Array(3);
  toScene(-R0, 0, Z_SUN, sun, 0);

  root.YouAreHereGalaxy = {
    R0, S, R_OUT, ARMS, BAR, DISC,
    radiusUnits: R_OUT * S,  // the galaxy's drawn radius in scene units
    sunPosition: sun,         // scene units
    armCurves, polarToXYZ, longitudeOf, measuredR,
    sample, labelSpots, randomArmPoint,
  };
})(typeof window !== 'undefined' ? window : globalThis);
