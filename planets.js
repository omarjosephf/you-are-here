/*  You Are Here: planets.js
    ------------------------------------------------------------------
    The Sun's family in the same glowing-particle style as Earth: Mercury,
    Venus, Mars, Jupiter, Saturn, Uranus, Neptune and the dwarf planet
    Pluto (Earth and the Moon are in earth.js).
      - where each one really is on the clock's date (Astronomy Engine,
        heliocentric, placed by the scale system in sky.js)
      - tilted and spinning by the IAU rotation model (Astronomy Engine's
        RotationAxis), so Venus, Uranus and Pluto spin backwards
      - coloured from small surface maps (planet-maps.js) and lit by the Sun,
        with a day side and a night side
      - particles budgeted by on-screen size: a body drawn 300 pixels wide
        gets tens of thousands of points, a distant one a handful, and a
        marker keeps every body findable at any scale
      - orbit lines (one real orbit each, sampled from Astronomy Engine) and
        name labels, each with its own switch

    Frame and units: the scene's J2000 ecliptic frame with Earth's centre at
    the origin (sky.js). main.js creates this after Earth:
      const planets = window.YouAreHerePlanets.create(THREE, env, earth)
*/
window.YouAreHerePlanets = {
  // Diameters (km) from the NASA Planetary Fact Sheet (PLAN.md, section 6).
  // Orbit colours and point budgets are drawing choices.
  BODIES: [
    { id: 'mercury', name: 'Mercury', body: 'Mercury', diameter: 4879, orbit: 0xb9a99a, nMax: 30000 },
    { id: 'venus', name: 'Venus', body: 'Venus', diameter: 12104, orbit: 0xe8c58a, nMax: 40000 },
    { id: 'mars', name: 'Mars', body: 'Mars', diameter: 6792, orbit: 0xe07a5a, nMax: 40000 },
    { id: 'jupiter', name: 'Jupiter', body: 'Jupiter', diameter: 142984, orbit: 0xd9b48a, nMax: 70000 },
    { id: 'saturn', name: 'Saturn', body: 'Saturn', diameter: 120536, orbit: 0xe6d29a, nMax: 70000 },
    { id: 'uranus', name: 'Uranus', body: 'Uranus', diameter: 51118, orbit: 0x9fe0e6, nMax: 45000 },
    { id: 'neptune', name: 'Neptune', body: 'Neptune', diameter: 49528, orbit: 0x7f9cff, nMax: 45000 },
    { id: 'pluto', name: 'Pluto', sub: 'dwarf planet', body: 'Pluto', diameter: 2376, orbit: 0xc9a98f, nMax: 25000, tint: [1.0, 0.86, 0.72] },
  ],

  create(THREE, env, earth) {
    'use strict';
    const { TAU, clamp, smoothstep } = env;
    const SKY = window.YouAreHereSky;
    const MAPS = window.YOU_ARE_HERE_PLANET_MAPS || null;
    const BODIES = window.YouAreHerePlanets.BODIES;
    const scene = earth.scene;
    let scaleMode = earth.scaleMode;
    const root = new THREE.Group();
    scene.add(root);

    const U = { uViewH: { value: 800 }, uMaxSize: { value: 48 } };

    // ---- colour maps ---------------------------------------------------
    const decode = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    function mapSampler(id) {
      const m = MAPS && MAPS[id];
      if (!m) return null;
      const pal = decode(m.palette);
      const idx = decode(m.data);
      const W = MAPS.width;
      const H = MAPS.height;
      return (lat, lon) => {
        const x = clamp(Math.floor(((lon + 180) / 360) * W), 0, W - 1);
        const y = clamp(Math.floor(((90 - lat) / 180) * H), 0, H - 1);
        const k = idx[y * W + x] * 3;
        return [pal[k] / 255, pal[k + 1] / 255, pal[k + 2] / 255];
      };
    }

    // ---- shaders -------------------------------------------------------
    // Points on a unit sphere; the group's scale makes the body's size.
    // uLight: the direction from the body to the Sun (world frame).
    // uPt: point size in pixels at a distance of 1 unit.
    const VERTEX = /* glsl */ `
      uniform vec3 uLight;
      uniform float uPt;
      uniform float uMaxSize;
      attribute vec3 aColor;
      attribute float aScale;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec3 n = normalize(mat3(modelMatrix) * position);
        float s = dot(n, uLight);
        float day = smoothstep(-0.08, 0.22, s);
        float shade = 0.6 + 0.4 * sqrt(clamp(s, 0.0, 1.0));
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(uPt * aScale / max(-mv.z, 1e-6), 1.0, uMaxSize);
        vColor = aColor * mix(0.035, 0.8, day) * shade;
        vAlpha = 0.85;
      }
    `;
    const FRAGMENT = /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        float glow = 1.0 - smoothstep(0.0, 0.5, d);
        glow *= glow;
        float a = glow * vAlpha;
        if (a < 0.003) discard;
        gl_FragColor = vec4(vColor, a);
      }
    `;

    // Evenly spread points on a unit sphere (a Fibonacci spiral, nudged),
    // then shuffled, so the first n of them are always spread evenly too:
    // drawing fewer points (far away) just draws a shorter prefix.
    function spherePoints(n, colorAt, tint) {
      const GOLDEN = Math.PI * (3 - Math.sqrt(5));
      const jitter = 0.45 * Math.sqrt((4 * Math.PI) / n);
      const pos = new Float32Array(n * 3);
      const col = new Float32Array(n * 3);
      const scl = new Float32Array(n);
      const p = new THREE.Vector3();
      const t = new THREE.Vector3();
      const order = new Uint32Array(n);
      for (let i = 0; i < n; i++) order[i] = i;
      for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const s = order[i]; order[i] = order[j]; order[j] = s; }
      for (let k = 0; k < n; k++) {
        const i = order[k];
        const y = 1 - (2 * (i + 0.5)) / n;
        const r = Math.sqrt(Math.max(0, 1 - y * y));
        const a = i * GOLDEN;
        p.set(Math.cos(a) * r, y, Math.sin(a) * r);
        t.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
        t.addScaledVector(p, -t.dot(p));
        if (t.lengthSq() > 1e-12) p.addScaledVector(t.normalize(), jitter * Math.random()).normalize();
        pos[k * 3] = p.x; pos[k * 3 + 1] = p.y; pos[k * 3 + 2] = p.z;
        const lat = Math.asin(clamp(p.y, -1, 1)) * 180 / Math.PI;
        const lon = Math.atan2(-p.z, p.x) * 180 / Math.PI;
        const c = colorAt(lat, lon);
        const v = 0.92 + 0.16 * Math.random();
        col[k * 3] = c[0] * v * tint[0]; col[k * 3 + 1] = c[1] * v * tint[1]; col[k * 3 + 2] = c[2] * v * tint[2];
        scl[k] = 0.8 + Math.random() * 0.4;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
      g.setAttribute('aScale', new THREE.BufferAttribute(scl, 1));
      return g;
    }

    // ---- markers and labels --------------------------------------------
    // A small ring that stays the same size on screen, so a body too small
    // to see is still findable; and its name.
    const markerTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const ctx = c.getContext('2d');
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(32, 32, 22, 0, TAU); ctx.stroke();
      return env.makeCanvasTexture(c);
    })();

    // ---- the bodies ------------------------------------------------------
    const tmp = new THREE.Vector3();
    const mtx = new THREE.Matrix4();
    const bodies = BODIES.map((b) => {
      const group = new THREE.Group();
      const spinner = new THREE.Group();
      group.add(spinner);
      root.add(group);
      const occluder = new THREE.Mesh(new THREE.SphereGeometry(0.985, 40, 28), new THREE.MeshBasicMaterial({ color: 0x05030b }));
      occluder.renderOrder = -1;
      spinner.add(occluder);
      const material = new THREE.ShaderMaterial({
        uniforms: { uLight: { value: new THREE.Vector3(1, 0, 0) }, uPt: { value: 1 }, uMaxSize: U.uMaxSize },
        vertexShader: VERTEX, fragmentShader: FRAGMENT,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerTex, color: b.orbit, transparent: true, depthWrite: false, depthTest: false, sizeAttenuation: false, opacity: 0 }));
      marker.scale.set(0.022, 0.022, 1);
      marker.renderOrder = 8;
      group.add(marker);
      const lt = env.textTexture(b.name, { fill: '#e8eeff', core: '#ffffff', glow: 'rgba(120, 150, 255, 0.75)' });
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: lt.tex, transparent: true, depthWrite: false, depthTest: false, sizeAttenuation: false, opacity: 0 }));
      label.userData = { aspect: lt.aspect, alpha: 0 };
      label.center.set(0.5, -0.45);
      label.renderOrder = 9;
      group.add(label);
      return Object.assign({}, b, {
        group, spinner, occluder, material, marker, label, points: null,
        R: 1, px: 0, drawn: 0, helio: [0, 0, 0], au: 0, sampler: null,
      });
    });
    const byId = Object.fromEntries(bodies.map((b) => [b.id, b]));
    // Earth (drawn in earth.js) gets a marker and a name here too, so it can
    // be found from far out like the others.
    const earthTag = (() => {
      const group = new THREE.Group();
      root.add(group);
      const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerTex, color: 0x6f9cff, transparent: true, depthWrite: false, depthTest: false, sizeAttenuation: false, opacity: 0 }));
      marker.scale.set(0.022, 0.022, 1);
      marker.renderOrder = 8;
      group.add(marker);
      const lt = env.textTexture('Earth', { fill: '#e8eeff', core: '#ffffff', glow: 'rgba(120, 150, 255, 0.75)' });
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: lt.tex, transparent: true, depthWrite: false, depthTest: false, sizeAttenuation: false, opacity: 0 }));
      label.userData = { aspect: lt.aspect, alpha: 0 };
      label.center.set(0.5, -0.45);
      label.renderOrder = 9;
      group.add(label);
      return { id: 'earth', group, marker, label, R: SKY.EARTH_R, px: 0, tagOnly: true };
    })();

    function build(b) {
      if (b.points) return;
      const sampler = mapSampler(b.id) || (() => [0.7, 0.68, 0.62]);
      const g = spherePoints(b.nMax, sampler, b.tint || [1, 1, 1]);
      g.setDrawRange(0, 0);
      b.points = new THREE.Points(g, b.material);
      b.points.frustumCulled = false;
      b.points.renderOrder = 1;
      b.spinner.add(b.points);
    }

    // ---- orbit lines -----------------------------------------------------
    // One full orbit each, sampled from Astronomy Engine around the clock's
    // date, placed through the same scale mapping as the bodies. Earth's
    // orbit is drawn here too.
    const orbitRoot = new THREE.Group();
    scene.add(orbitRoot);
    const ORBITS = [...BODIES.map((b) => ({ id: b.id, body: b.body, color: b.orbit })), { id: 'earth', body: 'Earth', color: 0xff8cc0 }];
    const orbitLines = ORBITS.map((o) => {
      const line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: o.color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      line.renderOrder = 0;
      line.frustumCulled = false;
      orbitRoot.add(line);
      return Object.assign({ line, builtAt: NaN, mode: '' }, o);
    });
    const SAMPLES = 360;
    function buildOrbit(o, ms) {
      const days = SKY.A.PlanetOrbitalPeriod(o.body);
      const pts = new Float32Array((SAMPLES + 1) * 3);
      for (let i = 0; i <= SAMPLES; i++) {
        const t = ms + ((i / SAMPLES) - 0.5) * days * 864e5;
        const v = SKY.placeHelio(SKY.helioVector(o.body, t), scaleMode);
        pts[i * 3] = v[0]; pts[i * 3 + 1] = v[1]; pts[i * 3 + 2] = v[2];
      }
      o.line.geometry.setAttribute('position', new THREE.BufferAttribute(pts, 3));
      o.line.geometry.attributes.position.needsUpdate = true;
      o.builtAt = ms;
      o.mode = scaleMode;
      o.period = days;
    }

    // ---- per-frame update ------------------------------------------------
    let placedAt = NaN;
    let pxPerUnit = 600;
    const opts = { orbits: true, labels: true };
    const camPos = new THREE.Vector3();
    const P = { proj: new THREE.Vector3() };

    function place(ms, force) {
      if (!force && Math.abs(ms - placedAt) < 1000) return;
      placedAt = ms;
      const sun = earth.sunPos;
      for (const b of bodies) {
        const h = SKY.helioVector(b.body, ms);
        b.helio = h;
        b.au = SKY.len3(h);
        const v = SKY.placeHelio(h, scaleMode);
        b.group.position.set(sun.x + v[0], sun.y + v[1], sun.z + v[2]);
        b.R = SKY.radiusUnits(b.diameter, scaleMode);
        b.spinner.scale.setScalar(b.R);
        const m = SKY.bodyMatrix(b.body, ms);
        mtx.set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1);
        b.spinner.quaternion.setFromRotationMatrix(mtx);
        tmp.copy(sun).sub(b.group.position).normalize();
        b.material.uniforms.uLight.value.copy(tmp);
      }
      orbitRoot.position.copy(sun);
      for (const o of orbitLines) {
        if (o.mode !== scaleMode || !(Math.abs(ms - o.builtAt) < (o.period || 1) * 864e5 * 0.2)) buildOrbit(o, ms);
      }
    }

    function update(dt, camera, ms) {
      place(ms, false);
      pxPerUnit = U.uViewH.value / (2 * Math.tan((camera.fov * Math.PI) / 360));
      camera.getWorldPosition(camPos);
      const fit = clamp(camera.aspect * 1.4, 0.62, 1);
      const placed = [];
      // Bigger on screen wins when two names overlap (Earth first: you are here).
      earthTag.px = (earthTag.R * pxPerUnit) / Math.max(1e-6, camPos.length());
      const emk = smoothstep(9, 3, earthTag.px);
      earthTag.marker.material.opacity = 0.75 * emk;
      earthTag.marker.visible = emk > 0.01;
      const order = [earthTag, ...bodies.slice().sort((a, b) => b.px - a.px)];
      for (const b of bodies) {
        const d = Math.max(1e-6, camPos.distanceTo(b.group.position));
        b.px = (b.R * pxPerUnit) / d; // radius on screen, pixels
        // Points: about 3 per square pixel of radius, up to the budget.
        const want = b.px < 0.6 ? 0 : clamp(Math.round(3 * b.px * b.px), 40, b.nMax);
        if (want > 0) build(b);
        if (b.points) {
          b.points.geometry.setDrawRange(0, want);
          b.points.visible = want > 0;
          const n = Math.max(1, want);
          // Point size: about 1.6 times the spacing between points.
          b.material.uniforms.uPt.value = 1.6 * b.R * Math.sqrt((4 * Math.PI) / n) * pxPerUnit;
        }
        b.drawn = want;
        b.occluder.visible = b.px > 1.5;
        // Marker: shown while the body is small on screen.
        const mk = smoothstep(9, 3, b.px);
        b.marker.material.opacity = 0.75 * mk;
        b.marker.visible = mk > 0.01;
      }
      for (const b of order) {
        const s = b.label;
        let goal = opts.labels ? 1 - smoothstep(25, 60, b.px) : 0;
        const h = 0.05 * fit;
        s.scale.set(h * s.userData.aspect, h, 1);
        if (goal > 0) {
          P.proj.copy(b.group.position).project(camera);
          const w = s.scale.x * camera.projectionMatrix.elements[0];
          const hh = s.scale.y * camera.projectionMatrix.elements[5];
          const box = [P.proj.x - w / 2, P.proj.y, P.proj.x + w / 2, P.proj.y + hh * 1.4];
          const hit = P.proj.z > 1 || placed.some((o) => box[0] < o[2] && box[2] > o[0] && box[1] < o[3] && box[3] > o[1]);
          if (hit) goal = 0; else placed.push(box);
        }
        s.userData.alpha += (goal - s.userData.alpha) * (1 - Math.exp(-dt * 5));
        if (s.userData.alpha < 0.004) s.userData.alpha = 0;
        s.material.opacity = s.userData.alpha * 0.9;
        s.visible = s.userData.alpha > 0;
      }
      const camFromSun = camPos.distanceTo(earth.sunPos);
      for (const o of orbitLines) {
        const near = o.id === 'earth' ? 1 : smoothstep(0, SKY.distanceUnits(0.2, scaleMode), camFromSun);
        o.line.material.opacity = opts.orbits ? 0.3 * near : 0;
        o.line.visible = o.line.material.opacity > 0.005;
      }
    }

    function setScale(mode) {
      scaleMode = mode;
      place(earth.timeMs, true);
    }
    function setViewport(viewH, maxPoint) { U.uViewH.value = viewH; U.uMaxSize.value = maxPoint; }
    function totalPoints() { return bodies.reduce((a, b) => a + b.drawn, 0); }

    place(earth.timeMs, true);
    return {
      root, bodies, byId, opts, orbits: orbitLines, update, setScale, setViewport, totalPoints,
      get scaleMode() { return scaleMode; },
    };
  },
};
