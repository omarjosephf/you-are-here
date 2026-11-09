/*  You Are Here: moons.js
    ------------------------------------------------------------------
    Moons, rings and belts, in the same particle style:
      - Io, Europa, Ganymede and Callisto where Astronomy Engine puts them
        (its JupiterMoons model) on the clock's date
      - Titan, Triton and Charon on simple orbits from JPL's planetary
        satellite mean elements (epoch 2000; the orbits are kept at their
        2000 orientation), so they are labelled "approximate"; Triton goes
        round backwards, as it really does
      - Saturn's rings in Saturn's equatorial plane, with the ring edges
        from NASA's Saturnian Rings Fact Sheet; the colour comes from
        Solar System Scope's ring strip and the relative brightness of each
        ring is a drawing choice
      - the main asteroid belt (2.0 to 3.2 au, JPL's main-belt class, with
        dips at the Kirkwood gaps at 2.5 and 2.8 au) and the Kuiper belt
        (about 30 to 50 au, NASA; with a thin "cold" and a puffed-up "hot"
        population, Gladman & Volk 2021). Each particle goes round the Sun
        at its own Kepler speed; their number and density are illustrative.
    Sources: SOURCES.md and PLAN.md section 6.

    main.js creates this after the planets:
      const moons = window.YouAreHereMoons.create(THREE, env, earth, planets)
*/
window.YouAreHereMoons = {
  create(THREE, env, earth, planets) {
    'use strict';
    const { TAU, clamp, smoothstep } = env;
    const SKY = window.YouAreHereSky;
    const A = SKY.A;
    const scene = earth.scene;
    const DEG = Math.PI / 180;
    const J2000 = Date.UTC(2000, 0, 1, 12);
    let scaleMode = earth.scaleMode;
    const U = { uViewH: { value: 800 }, uMaxSize: { value: 48 } };

    // Planet radii (km) the moon distances are measured against: NASA
    // Planetary Fact Sheet equatorial diameters / 2.
    const PLANET_R_KM = { jupiter: 71492, saturn: 60268, neptune: 24764, pluto: 1188 };

    // ---- the moons -------------------------------------------------------
    // JPL mean elements (epoch 2000-01-01.5): a (km), e, w, M, i, node (deg),
    // P (days); reference plane pole (RA, Dec, J2000) for Titan's Laplace
    // plane, or the planet's own equator.
    const MOONS = [
      { id: 'io', name: 'Io', planet: 'jupiter', radiusKm: 1821.49, model: 'jupiter', key: 'io' },
      { id: 'europa', name: 'Europa', planet: 'jupiter', radiusKm: 1560.80, model: 'jupiter', key: 'europa' },
      { id: 'ganymede', name: 'Ganymede', planet: 'jupiter', radiusKm: 2631.20, model: 'jupiter', key: 'ganymede' },
      { id: 'callisto', name: 'Callisto', planet: 'jupiter', radiusKm: 2410.30, model: 'jupiter', key: 'callisto' },
      { id: 'titan', name: 'Titan', planet: 'saturn', radiusKm: 2574.76, approx: true,
        el: { a: 1221900, e: 0.029, w: 78.3, M: 11.7, i: 0.3, node: 78.6, P: 15.945448 }, pole: { ra: 36.4, dec: 84.0 } },
      { id: 'triton', name: 'Triton', planet: 'neptune', radiusKm: 1352.60, approx: true,
        el: { a: 354800, e: 0, w: 0, M: 63.0, i: 157.3, node: 177.7, P: 5.8792 }, poleOf: 'Neptune' },
      { id: 'charon', name: 'Charon', planet: 'pluto', radiusKm: 606.0, approx: true,
        el: { a: 19600, e: 0, w: 0, M: 304.1, i: 0, node: 0, P: 6.387222 }, poleOf: 'Pluto' },
    ];
    const colorOf = { io: [0.95, 0.85, 0.45], europa: [0.85, 0.8, 0.72], ganymede: [0.62, 0.58, 0.52], callisto: [0.45, 0.42, 0.38], titan: [0.9, 0.68, 0.35], triton: [0.82, 0.78, 0.8], charon: [0.6, 0.57, 0.55] };

    const MOON_VERTEX = /* glsl */ `
      uniform vec3 uLight;
      uniform float uPt;
      uniform float uMaxSize;
      uniform vec3 uColor;
      attribute float aScale;
      varying vec3 vColor;
      void main() {
        vec3 n = normalize(mat3(modelMatrix) * position);
        float day = smoothstep(-0.08, 0.22, dot(n, uLight));
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(uPt * aScale / max(-mv.z, 1e-6), 1.0, uMaxSize);
        vColor = uColor * mix(0.03, 0.8, day) * (0.85 + 0.3 * aScale - 0.3);
      }
    `;
    const POINT_FRAGMENT = /* glsl */ `
      varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        float glow = 1.0 - smoothstep(0.0, 0.5, d);
        glow *= glow;
        if (glow < 0.004) discard;
        gl_FragColor = vec4(vColor, glow * 0.85);
      }
    `;
    function unitSphere(n) {
      const pos = new Float32Array(n * 3);
      const scl = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const u = Math.random() * 2 - 1;
        const a = Math.random() * TAU;
        const s = Math.sqrt(1 - u * u);
        pos[i * 3] = s * Math.cos(a); pos[i * 3 + 1] = u; pos[i * 3 + 2] = s * Math.sin(a);
        scl[i] = 0.8 + Math.random() * 0.4;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aScale', new THREE.BufferAttribute(scl, 1));
      return g;
    }
    const MOON_N = 6000;
    const markerTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const ctx = c.getContext('2d');
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath(); ctx.arc(32, 32, 12, 0, TAU); ctx.fill();
      return env.makeCanvasTexture(c);
    })();
    const moons = MOONS.map((m) => {
      const group = new THREE.Group();
      scene.add(group);
      const mat = new THREE.ShaderMaterial({
        uniforms: { uLight: { value: new THREE.Vector3(1, 0, 0) }, uPt: { value: 1 }, uMaxSize: U.uMaxSize, uColor: { value: new THREE.Vector3(...colorOf[m.id]) } },
        vertexShader: MOON_VERTEX, fragmentShader: POINT_FRAGMENT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const pts = new THREE.Points(unitSphere(MOON_N), mat);
      pts.frustumCulled = false;
      pts.renderOrder = 1;
      const occ = new THREE.Mesh(new THREE.SphereGeometry(0.97, 24, 16), new THREE.MeshBasicMaterial({ color: 0x05030b }));
      occ.renderOrder = -1;
      group.add(pts, occ);
      const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerTex, transparent: true, depthWrite: false, depthTest: false, sizeAttenuation: false, opacity: 0 }));
      marker.scale.set(0.009, 0.009, 1);
      marker.renderOrder = 8;
      const lt = env.textTexture(m.approx ? `${m.name} (approximate)` : m.name, { fill: '#dfe6ff', core: '#ffffff', glow: 'rgba(120, 150, 255, 0.6)' });
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: lt.tex, transparent: true, depthWrite: false, depthTest: false, sizeAttenuation: false, opacity: 0 }));
      label.center.set(0.5, -0.5);
      label.userData = { aspect: lt.aspect, alpha: 0 };
      label.renderOrder = 9;
      const tag = new THREE.Group();
      tag.add(marker, label);
      scene.add(tag);
      return Object.assign({}, m, { group, pts, occ, mat, marker, label, tag, R: 1, px: 0, offset: new THREE.Vector3() });
    });

    // A moon's position relative to its planet (km, J2000 equatorial).
    const poleCache = {};
    function refPlane(m) {
      let ra, dec;
      if (m.pole) { ra = m.pole.ra; dec = m.pole.dec; }
      else {
        if (!poleCache[m.poleOf]) {
          const ax = A.RotationAxis(m.poleOf, A.MakeTime(new Date(J2000)));
          poleCache[m.poleOf] = { ra: ax.ra * 15, dec: ax.dec };
        }
        ({ ra, dec } = poleCache[m.poleOf]);
      }
      const n = [Math.cos(dec * DEG) * Math.cos(ra * DEG), Math.cos(dec * DEG) * Math.sin(ra * DEG), Math.sin(dec * DEG)];
      const q = SKY.norm3([-n[1], n[0], 0]); // the plane's ascending node on the ICRF equator
      const q2 = [n[1] * q[2] - n[2] * q[1], n[2] * q[0] - n[0] * q[2], n[0] * q[1] - n[1] * q[0]];
      return { n, q, q2 };
    }
    function elementsPosition(m, ms) {
      const el = m.el;
      const days = (ms - J2000) / 864e5;
      const M = (el.M + (360 * days) / el.P) * DEG;
      const nu = M + 2 * el.e * Math.sin(M); // true anomaly, to first order in e (e <= 0.029)
      const r = (el.a * (1 - el.e * el.e)) / (1 + el.e * Math.cos(nu));
      const u = el.w * DEG + nu;
      const O = el.node * DEG;
      const i = el.i * DEG;
      const x = r * (Math.cos(O) * Math.cos(u) - Math.sin(O) * Math.sin(u) * Math.cos(i));
      const y = r * (Math.sin(O) * Math.cos(u) + Math.cos(O) * Math.sin(u) * Math.cos(i));
      const z = r * Math.sin(u) * Math.sin(i);
      const f = refPlane(m);
      return [0, 1, 2].map((k) => x * f.q[k] + y * f.q2[k] + z * f.n[k]);
    }
    let jupCache = { ms: NaN, info: null };
    function moonOffsetKm(m, ms) {
      if (m.model === 'jupiter') {
        if (jupCache.ms !== ms) jupCache = { ms, info: A.JupiterMoons(A.MakeTime(new Date(ms))) };
        const s = jupCache.info[m.key];
        return [s.x * SKY.AU_KM, s.y * SKY.AU_KM, s.z * SKY.AU_KM];
      }
      return elementsPosition(m, ms);
    }

    // ---- Saturn's rings --------------------------------------------------
    // Edges (km from Saturn's centre), NASA Saturnian Rings Fact Sheet;
    // relative brightness: drawing choice. Saturn's radius: 60,268 km.
    const SAT_R = 60268;
    const RINGS = [
      { from: 66900, to: 74510, w: 0.05 },   // D
      { from: 74658, to: 91975, w: 0.3 },    // C
      { from: 91975, to: 117507, w: 1.0 },   // B
      { from: 117507, to: 122340, w: 0.05 }, // Cassini Division
      { from: 122340, to: 136780, w: 0.65 }, // A
      { from: 139626, to: 140026, w: 0.35 }, // F (a narrow ring at 139,826 km)
    ];
    const ringStrip = (() => {
      const M = window.YOU_ARE_HERE_PLANET_MAPS;
      if (!M || !M.saturnRing) return null;
      return Uint8Array.from(atob(M.saturnRing), (c) => c.charCodeAt(0));
    })();
    const ringN = 60000;
    const ringGeo = (() => {
      const pos = new Float32Array(ringN * 3);
      const col = new Float32Array(ringN * 3);
      const total = RINGS.reduce((a, r) => a + (r.to - r.from) * r.w, 0);
      const inner = RINGS[0].from;
      const outer = RINGS[RINGS.length - 1].to;
      for (let k = 0; k < ringN; k++) {
        let t = Math.random() * total;
        let ring = RINGS[0];
        for (const r of RINGS) { const s = (r.to - r.from) * r.w; if (t <= s) { ring = r; break; } t -= s; }
        const rk = ring.from + Math.random() * (ring.to - ring.from);
        const a = Math.random() * TAU;
        const r = rk / SAT_R;
        pos[k * 3] = Math.cos(a) * r; pos[k * 3 + 1] = (Math.random() - 0.5) * 0.002; pos[k * 3 + 2] = Math.sin(a) * r;
        let c = [0.85, 0.78, 0.65];
        if (ringStrip) {
          const idx = clamp(Math.floor(((rk - inner) / (outer - inner)) * 255), 0, 255) * 4;
          c = [ringStrip[idx] / 255, ringStrip[idx + 1] / 255, ringStrip[idx + 2] / 255];
        }
        const v = 0.28 + 0.16 * Math.random();
        col[k * 3] = c[0] * v; col[k * 3 + 1] = c[1] * v; col[k * 3 + 2] = c[2] * v;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
      return g;
    })();
    const RING_VERTEX = /* glsl */ `
      uniform float uPt;
      uniform float uMaxSize;
      uniform float uLit;
      attribute vec3 aColor;
      varying vec3 vColor;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(uPt / max(-mv.z, 1e-6), 1.0, uMaxSize);
        vColor = aColor * uLit;
      }
    `;
    const RING_FRAGMENT = /* glsl */ `
      varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        float glow = 1.0 - smoothstep(0.0, 0.5, d);
        if (glow < 0.004) discard;
        gl_FragColor = vec4(vColor, glow * glow * 0.45);
      }
    `;
    const ringMat = new THREE.ShaderMaterial({
      uniforms: { uPt: { value: 1 }, uMaxSize: U.uMaxSize, uLit: { value: 1 } },
      vertexShader: RING_VERTEX, fragmentShader: RING_FRAGMENT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const rings = new THREE.Points(ringGeo, ringMat);
    rings.frustumCulled = false;
    rings.renderOrder = 2;
    const saturn = planets.byId.saturn;
    // In Saturn's equatorial plane: Saturn's spinning frame has y along its
    // north pole, so the rings (in local x-z) lie in the equator.
    saturn.spinner.add(rings);

    // ---- belts -------------------------------------------------------------
    // Each particle: semi-major axis a (au), inclination, node, starting
    // angle. The shader moves it round the Sun at the Kepler rate (one turn
    // in a^1.5 years) and maps its distance with the scale mode.
    const BELT_VERTEX = /* glsl */ `
      uniform float uYears;
      uniform float uAU;
      uniform float uPow;
      uniform float uSize;
      uniform vec3 uTint;
      attribute vec4 aOrbit; // a (au), inclination, node, starting angle (radians)
      attribute float aBright;
      varying vec3 vColor;
      void main() {
        float a = aOrbit.x;
        float ang = aOrbit.w + 6.2831853 * uYears / pow(a, 1.5);
        float ci = cos(aOrbit.y), si = sin(aOrbit.y), cn = cos(aOrbit.z), sn = sin(aOrbit.z);
        float cu = cos(ang - aOrbit.z), su = sin(ang - aOrbit.z);
        // position on its orbit (ecliptic frame), then the scale mapping
        vec3 e = vec3(cn * cu - sn * su * ci, sn * cu + cn * su * ci, su * si);
        float d = uAU * pow(a, uPow);
        vec3 p = vec3(e.x, e.z, -e.y) * d;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uSize;
        vColor = uTint * aBright;
      }
    `;
    function makeBelt(n, sample, tint, size) {
      const orbit = new Float32Array(n * 4);
      const bright = new Float32Array(n);
      for (let k = 0; k < n; k++) {
        const s = sample();
        orbit[k * 4] = s.a; orbit[k * 4 + 1] = s.i; orbit[k * 4 + 2] = Math.random() * TAU; orbit[k * 4 + 3] = Math.random() * TAU;
        bright[k] = 0.35 + Math.random() * 0.65;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); // unused, but Three.js needs it
      g.setAttribute('aOrbit', new THREE.BufferAttribute(orbit, 4));
      g.setAttribute('aBright', new THREE.BufferAttribute(bright, 1));
      const m = new THREE.ShaderMaterial({
        uniforms: { uYears: { value: 0 }, uAU: { value: 70 }, uPow: { value: 0.5 }, uSize: { value: size }, uTint: { value: new THREE.Vector3(...tint) } },
        vertexShader: BELT_VERTEX, fragmentShader: RING_FRAGMENT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const p = new THREE.Points(g, m);
      p.frustumCulled = false;
      p.renderOrder = 0;
      scene.add(p);
      return p;
    }
    const gauss = () => Math.sqrt(-2 * Math.log(Math.random() + 1e-12)) * Math.cos(TAU * Math.random());
    // Main belt: 2.0-3.2 au, thinner near the Kirkwood gaps at 2.5 and 2.8
    // au; inclinations spread about 8 degrees (a drawing choice).
    const asteroidBelt = makeBelt(14000, () => {
      let a;
      for (;;) {
        a = 2.0 + Math.random() * 1.2;
        const gap = Math.min(Math.abs(a - 2.5), Math.abs(a - 2.82));
        if (gap > 0.03 || Math.random() < 0.15) break;
      }
      return { a, i: Math.abs(gauss()) * 8 * DEG };
    }, [0.85, 0.75, 0.6], 1.6);
    // Kuiper belt: inner from Neptune (30 au) to the main belt's end near 50
    // au; a cold population (42.5-47.5 au, inclinations about 2 degrees
    // wide) and a hot one (about 18 degrees wide), Gladman & Volk 2021.
    const kuiperBelt = makeBelt(22000, () => {
      if (Math.random() < 0.35) return { a: 42.5 + Math.random() * 5, i: Math.abs(gauss()) * 2 * DEG };
      return { a: 30 + Math.random() * 20, i: Math.abs(gauss()) * 18 * DEG };
    }, [0.6, 0.72, 0.95], 1.6);

    // ---- per-frame update --------------------------------------------------
    const camPos = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    const lightV = new THREE.Vector3();
    let pxPerUnit = 600;
    const opts = { labels: true, belts: true };
    function update(dt, camera, ms) {
      pxPerUnit = U.uViewH.value / (2 * Math.tan((camera.fov * Math.PI) / 360));
      camera.getWorldPosition(camPos);
      const sun = earth.sunPos;
      const fit = clamp(camera.aspect * 1.4, 0.62, 1);
      for (const m of moons) {
        const p = planets.byId[m.planet];
        const off = moonOffsetKm(m, ms);
        const v = SKY.eqjToScene(new A.Vector(off[0], off[1], off[2], A.MakeTime(new Date(ms))));
        const km = Math.hypot(off[0], off[1], off[2]);
        const dist = SKY.moonDistanceUnits(km, PLANET_R_KM[m.planet], p.R, scaleMode);
        tmp.set(v[0], v[1], v[2]).normalize().multiplyScalar(dist);
        m.group.position.copy(p.group.position).add(tmp);
        m.tag.position.copy(m.group.position);
        m.R = SKY.radiusUnits(m.radiusKm * 2, scaleMode);
        m.group.scale.setScalar(m.R);
        const d = Math.max(1e-6, camPos.distanceTo(m.group.position));
        m.px = (m.R * pxPerUnit) / d;
        const n = m.px < 0.6 ? 0 : clamp(Math.round(3 * m.px * m.px), 30, MOON_N);
        m.pts.geometry.setDrawRange(0, n);
        m.pts.visible = n > 0;
        m.occ.visible = m.px > 1.5;
        m.mat.uniforms.uPt.value = 1.6 * m.R * Math.sqrt((4 * Math.PI) / Math.max(1, n)) * pxPerUnit;
        m.mat.uniforms.uLight.value.copy(sun).sub(m.group.position).normalize();
        // Markers and names show once you are near the planet (its disc is
        // over about 25 pixels), so the moons don't clutter the far view.
        const near = smoothstep(18, 40, p.px);
        const mk = near * smoothstep(7, 2.5, m.px);
        m.marker.material.opacity = 0.7 * mk;
        m.marker.visible = mk > 0.01;
        const lg = opts.labels ? near * (1 - smoothstep(50, 120, m.px)) : 0;
        m.label.userData.alpha += (lg - m.label.userData.alpha) * (1 - Math.exp(-dt * 5));
        m.label.material.opacity = m.label.userData.alpha * 0.85;
        m.label.visible = m.label.material.opacity > 0.01;
        const h = 0.036 * fit;
        m.label.scale.set(h * m.label.userData.aspect, h, 1);
      }
      // Rings: point size from their area and how many points there are.
      const ringPx = saturn.px * 2.27;
      const rn = ringPx < 1 ? 0 : clamp(Math.round(2.5 * ringPx * ringPx), 200, ringN);
      rings.geometry.setDrawRange(0, rn);
      rings.visible = rn > 0;
      ringMat.uniforms.uPt.value = 1.7 * saturn.R * 2.27 * Math.sqrt(Math.PI / Math.max(1, rn)) * pxPerUnit;
      // Lit side: how squarely the Sun shines on the ring plane (a drawing simplification).
      tmp.set(0, 1, 0).applyQuaternion(saturn.spinner.quaternion);
      const L = lightV.copy(sun).sub(saturn.group.position).normalize();
      ringMat.uniforms.uLit.value = 0.35 + 0.65 * Math.sqrt(Math.abs(tmp.dot(L)));
      // Belts: years since 2000 and the scale mapping.
      const years = (ms - J2000) / (365.25 * 864e5);
      const mode = SKY.SCALE_MODES[scaleMode];
      for (const b of [asteroidBelt, kuiperBelt]) {
        b.position.copy(sun);
        b.material.uniforms.uYears.value = years;
        b.material.uniforms.uAU.value = mode.au;
        b.material.uniforms.uPow.value = mode.power;
        b.material.uniforms.uSize.value = Math.max(1, 1.6 * U.uViewH.value / 900);
        b.visible = opts.belts;
      }
    }
    function setScale(mode) { scaleMode = mode; }
    function setViewport(viewH, maxPoint) { U.uViewH.value = viewH; U.uMaxSize.value = maxPoint; }
    return {
      moons, rings, asteroidBelt, kuiperBelt, opts, update, setScale, setViewport,
      byId: Object.fromEntries(moons.map((m) => [m.id, m])),
      offsetKm: (id, ms) => moonOffsetKm(moons.find((m) => m.id === id), ms),
      ringEdges: () => { const p = rings.geometry.getAttribute('position'); let lo = Infinity, hi = 0; for (let i = 0; i < p.count; i++) { const r = Math.hypot(p.getX(i), p.getZ(i)); lo = Math.min(lo, r); hi = Math.max(hi, r); } return [lo * SAT_R, hi * SAT_R]; },
    };
  },
};
