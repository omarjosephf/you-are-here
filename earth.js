/*  You Are Here: earth.js
    ------------------------------------------------------------------
    The Earth world, in the same glowing-particle style as the galaxy:
      - oceans that shimmer with slow waves and catch the Sun's glint,
        continents in Earth's real colours (forests, deserts, mountains,
        ice) with the mountains raised a little, glowing coastlines (the
        beaches), and real city lights on the night side
      - real day and night on the simulated clock's date: Earth's spin and
        tilt, the Sun's direction and the Moon's position all come from
        Astronomy Engine (sky.js), with a pink sunset line between day and
        night
      - Luna where it really is on that date (so its phase is the real one),
        Sol lighting it, Earth's shadow on it during a lunar eclipse, and
        the Milky Way across the sky along the real galactic plane
      - real solar eclipses: the next one Astronomy Engine predicts, seen
        from the place where it is greatest, with the corona and the
        "diamond ring" flash when it is total

    main.js creates this the first time you visit Earth:
      const earth = window.YouAreHereEarth.create(THREE, env)
    and calls earth.update(dt, camera, { phase, ms }) every frame with the
    clock's time.

    Frame: the scene's J2000 ecliptic frame (sky.js): y towards the north
    ecliptic pole. Earth's centre is the origin.
*/
window.YouAreHereEarth = {
  create(THREE, env) {
    'use strict';
    const { TAU, clamp, smoothstep } = env;
    const SKY = window.YouAreHereSky;
    const DEG = Math.PI / 180;

    // ---- sizes and distances come from the scale system (sky.js). In the
    //      illustrative mode the layout is squeezed (real distances would put
    //      the Moon and Sun far off screen) but every direction is real.
    const R = SKY.EARTH_R;    // Earth (2 units in every mode)
    let scaleMode = env.scaleMode || 'illustrative';
    const moonR = () => SKY.radiusUnits(3474.8, scaleMode);   // Moon's mean diameter, NASA Moon Fact Sheet
    const MOON_R = 0.75;      // the Moon's drawn radius before scaling (its points are made at this size)
    const moonOrbit = () => SKY.SCALE_MODES[scaleMode].moonDist || SKY.EARTH_R * 384400 / SKY.EARTH_R_KM;
    let MOON_ORBIT = moonOrbit(); // the Moon's distance from Earth in this mode
    const SUN_R0 = 3.5;       // the Sun's sprites are made at this radius, then scaled
    const sunR = () => SKY.radiusUnits(1391400, scaleMode, true); // Sun's diameter (2 x 695,700 km, IAU 2015)
    const UP = new THREE.Vector3(0, 1, 0);

    const scene = new THREE.Scene();

    // ---- the land map (1 bit per half-degree pixel) ------------------
    const LAND = window.YOU_ARE_HERE_EARTH_LAND;
    const landW = LAND.width;
    const landH = LAND.height;
    const landBits = Uint8Array.from(atob(LAND.data), (c) => c.charCodeAt(0));
    function landAtPixel(x, y) {
      x = ((x % landW) + landW) % landW;
      y = clamp(y, 0, landH - 1);
      const i = y * landW + x;
      return (landBits[i >> 3] >> (i & 7)) & 1;
    }
    function pixelOf(lat, lon) {
      return [Math.floor(((lon + 180) / 360) * landW), Math.floor(((90 - lat) / 180) * landH)];
    }
    function isLand(lat, lon) {
      const [x, y] = pixelOf(lat, lon);
      return landAtPixel(x, y) === 1;
    }
    // Per land pixel, stored row by row (see earth-map.js): the real colour
    // (a 256-colour palette and one index each), and one "detail" byte with
    // the city lights at night (high 4 bits) and the height (low 4 bits).
    const decode = (b64) => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    const landSlot = new Int32Array(landW * landH).fill(-1); // pixel → its place in the lists
    {
      let k = 0;
      for (let i = 0; i < landW * landH; i++) if ((landBits[i >> 3] >> (i & 7)) & 1) landSlot[i] = k++;
    }
    const landPalette = [];
    let landColorIdx = null;
    if (LAND.colors) {
      const pal = decode(LAND.colors.palette);
      for (let i = 0; i + 2 < pal.length; i += 3) landPalette.push([pal[i] / 255, pal[i + 1] / 255, pal[i + 2] / 255]);
      landColorIdx = decode(LAND.colors.data);
    }
    const landDetail = LAND.detail ? decode(LAND.detail) : null;
    function slotOf(lat, lon) {
      const [x, y] = pixelOf(lat, lon);
      return landSlot[clamp(y, 0, landH - 1) * landW + (((x % landW) + landW) % landW)];
    }
    // The land's real colour at a latitude/longitude (0..1 sRGB values).
    const FALLBACK_LAND = [0.47, 0.45, 0.35];
    function landColor(lat, lon) {
      const k = slotOf(lat, lon);
      const c = k >= 0 && landColorIdx && k < landColorIdx.length ? landPalette[landColorIdx[k]] : null;
      return c || FALLBACK_LAND;
    }
    // City lights (0..1) and height (0..1) at a latitude/longitude.
    function landLights(lat, lon) {
      const k = slotOf(lat, lon);
      return k >= 0 && landDetail && k < landDetail.length ? (landDetail[k] >> 4) / 15 : 0;
    }
    function landHeight(lat, lon) {
      const k = slotOf(lat, lon);
      return k >= 0 && landDetail && k < landDetail.length ? (landDetail[k] & 15) / 15 : 0;
    }
    function isCoast(lat, lon) {
      const [x, y] = pixelOf(lat, lon);
      if (!landAtPixel(x, y)) return false;
      return !landAtPixel(x + 1, y) || !landAtPixel(x - 1, y) || !landAtPixel(x, y + 1) || !landAtPixel(x, y - 1);
    }

    // Local position on Earth (before tilt and spin) for a latitude/longitude.
    function localDir(lat, lon, out) {
      const la = lat * DEG;
      const lo = lon * DEG;
      return (out || new THREE.Vector3()).set(Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo));
    }

    // ---- shared uniforms ----------------------------------------------
    const U = {
      uPhase: { value: 0 },
      uViewH: { value: 800 },
      uMaxSize: { value: 48 },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uDim: { value: 0 },      // darkening during the eclipse
      uUmbra: { value: 0 },    // how much of the Moon is in Earth's umbra (lunar eclipse)
      uPenumbra: { value: 0 }, // ... and in the penumbra
    };

    // ---- Earth's orientation and the Sun, from the clock -----------------
    // spin holds Earth's real orientation (tilt, precession, nutation and
    // the day's turn), set as a matrix from Astronomy Engine every update.
    const sunDir = new THREE.Vector3(1, 0, 0);  // from Earth's centre towards the Sun (apparent)
    const sunPos = new THREE.Vector3(70, 0, 0); // the Sun's position in scene units
    let sunDist = 70;
    let sunAU = 1;
    const tilt = new THREE.Group(); // kept as a plain parent (no rotation of its own)
    const spin = new THREE.Group();
    spin.matrixAutoUpdate = false;
    tilt.add(spin);
    scene.add(tilt);

    let timeMs = Date.now();
    let earthDrawn = 0;
    let placedAt = NaN;
    // Places everything for the time ms (milliseconds since 1970, UTC).
    function setTime(ms, force) {
      timeMs = ms;
      if (!force && Math.abs(ms - placedAt) < 1000) return; // under a simulated second: nothing visible moves
      placedAt = ms;
      const m = SKY.earthMatrix(ms);
      spin.matrix.set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1);
      spin.matrixWorldNeedsUpdate = true;
      const s = SKY.geoVector('Sun', ms);
      sunAU = SKY.len3(s);
      sunDir.set(s[0], s[1], s[2]).normalize();
      sunDist = SKY.distanceUnits(sunAU, scaleMode);
      sunPos.copy(sunDir).multiplyScalar(sunDist);
      U.uSunDir.value.copy(sunDir);
      if (sol) sol.position.copy(sunPos);
      if (earthOrbitRing) placeEarthOrbit();
      placeMoon(ms);
      const sh = SKY.lunarShadow(ms);
      U.uUmbra.value = sh.umbra;
      U.uPenumbra.value = sh.penumbra;
    }

    // ---- shaders --------------------------------------------------------
    const EARTH_VERTEX = /* glsl */ `
      uniform float uPhase;
      uniform float uViewH;
      uniform float uMaxSize;
      uniform float uSize;
      uniform vec3 uSunDir;
      uniform float uDim;
      uniform float uLod;      // bigger points when fewer are drawn (far away)
      attribute vec3 aColor;
      attribute float aType;   // 0 ocean, 1 land, 2 coast
      attribute float aCity;   // real city lights, 0..1
      attribute float aRand;
      attribute float aScale;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec3 p = position;
        float wave = 0.0;
        if (aType < 0.5) {
          // slow waves rolling across the oceans
          wave = sin(dot(normalize(position), vec3(5.0, 3.0, 4.0)) * 6.0 - uPhase * 40.0 + aRand * 0.8);
          p *= 1.0 + 0.006 * wave;
        }
        vec4 world = modelMatrix * vec4(p, 1.0);
        vec3 n = normalize(world.xyz);
        float sunAmt = dot(n, uSunDir);
        float day = smoothstep(-0.12, 0.25, sunAmt);
        float dusk = exp(-pow(sunAmt / 0.16, 2.0));
        vec4 mv = viewMatrix * world;
        gl_Position = projectionMatrix * mv;
        float dist = max(-mv.z, 0.001);
        gl_PointSize = clamp(uSize * uLod * uViewH * aScale / dist, 1.0, uMaxSize);

        vec3 col = mix(aColor, vec3(1.0, 0.42, 0.68), dusk * 0.55);   // sunset pink
        float shimmer = aType < 0.5 ? 0.78 + 0.32 * wave : 1.0;
        // Brightest where the Sun is overhead, softer towards the evening.
        float shade = 0.64 + 0.36 * sqrt(clamp(sunAmt, 0.0, 1.0));
        float light = mix(0.13, 1.0, day) * shade + dusk * 0.3;
        // The Sun's glint on the sea.
        float glint = 0.0;
        if (aType < 0.5) {
          vec3 toCam = normalize(cameraPosition - world.xyz);
          glint = pow(max(dot(reflect(-uSunDir, n), toCam), 0.0), 36.0) * day;
        }
        // City lights where people really live, on the night side.
        float city = aCity * (1.0 - day) * (0.72 + 0.28 * sin(uPhase * 50.0 + aRand * 40.0));
        vColor = col * light * shimmer + vec3(1.0, 0.94, 0.82) * glint * 2.2 + vec3(1.0, 0.76, 0.42) * city * 1.15;
        vAlpha = (aType > 1.5 ? 0.95 : aType > 0.5 ? 0.72 : 0.8) * (1.0 - 0.45 * uDim);
      }
    `;
    const POINT_FRAGMENT = /* glsl */ `
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
    const MOON_VERTEX = /* glsl */ `
      uniform float uViewH;
      uniform float uMaxSize;
      uniform float uSize;
      uniform vec3 uSunDir;
      uniform float uUmbra;
      uniform float uPenumbra;
      attribute vec3 aColor;
      attribute float aScale;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec3 n = normalize((modelMatrix * vec4(position, 0.0)).xyz);
        float day = smoothstep(-0.05, 0.25, dot(n, uSunDir));
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        // the scale of the Moon's group changes its size in the eclipse view
        float s = length((modelMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
        gl_PointSize = min(uSize * s * uViewH * aScale / max(-mv.z, 0.001), uMaxSize);
        // Earth's shadow: the penumbra dims it a little, the umbra turns it
        // a dark copper red (sunlight bent through Earth's atmosphere).
        vec3 lit = aColor * (1.0 - 0.3 * uPenumbra);
        lit = mix(lit, aColor * vec3(0.5, 0.17, 0.1), uUmbra);
        vColor = lit * mix(0.05, 1.0, day);
        vAlpha = 0.85;
      }
    `;

    // ---- a little noise for natural-looking colour patches -------------
    function patch(x, y, z, f) {
      return 0.5 + 0.5 * Math.sin(x * 7.1 * f + Math.sin(y * 5.3 * f) * 2.0) * Math.cos(z * 6.7 * f + Math.sin(x * 3.1 * f));
    }

    // ---- Earth -----------------------------------------------------------
    const occluder = new THREE.Mesh(
      new THREE.SphereGeometry(R * 0.985, 64, 48),
      new THREE.MeshBasicMaterial({ color: 0x05030b })
    );
    occluder.renderOrder = -1;
    spin.add(occluder);

    // How bright the land glows compared with the real colours (1 = exact),
    // and how much richer the colours are made (1 = exact). Small glowing
    // dots look paler than a flat picture, so a little extra colour keeps
    // the greens and sands reading like the real Earth.
    const LAND_GAIN = 1.0;
    const LAND_SATURATION = 1.3;
    function vivid(lc) {
      const l = 0.2126 * lc[0] + 0.7152 * lc[1] + 0.0722 * lc[2];
      return [0, 1, 2].map((i) => clamp(l + (lc[i] - l) * LAND_SATURATION, 0, 1));
    }

    const earthMaterial = new THREE.ShaderMaterial({
      uniforms: Object.assign({ uSize: { value: 0.021 }, uLod: { value: 1 } }, U),
      vertexShader: EARTH_VERTEX,
      fragmentShader: POINT_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    let earthPoints = null;
    let EARTH_N = 1;
    (function buildEarth() {
      // Points spread evenly over the sphere (a "Fibonacci" spiral, nudged
      // a little at random), so there are no clumps or bald patches. Every
      // point on land is kept; about 45% of those at sea.
      const LATTICE = 220000;
      const GOLDEN = Math.PI * (3 - Math.sqrt(5));
      const JITTER = 0.45 * Math.sqrt((4 * Math.PI) / LATTICE);
      const MOUNTAINS = 0.014; // how far the highest land rises (a fraction of Earth's radius)
      const pos = [];
      const col = [];
      const city = [];
      const type = [];
      const rnd = [];
      const scl = [];
      const c = new THREE.Color();
      const ocean1 = new THREE.Color('#2348b0');
      const ocean2 = new THREE.Color('#5a36c4');
      const oceanHi = new THREE.Color('#6f9cff');
      // Land and beach colours are plain sRGB values (the shader draws them
      // as they are), so they match the real Earth.
      const sand = [0.95, 0.88, 0.72];
      const p = new THREE.Vector3();
      const tangent = new THREE.Vector3();
      for (let i = 0; i < LATTICE; i++) {
        const yy = 1 - (2 * (i + 0.5)) / LATTICE;
        const rr0 = Math.sqrt(Math.max(0, 1 - yy * yy));
        const ang = i * GOLDEN;
        p.set(Math.cos(ang) * rr0, yy, Math.sin(ang) * rr0);
        tangent.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
        tangent.addScaledVector(p, -tangent.dot(p));
        if (tangent.lengthSq() > 1e-12) p.addScaledVector(tangent.normalize(), JITTER * Math.random()).normalize();
        const x = p.x;
        const y = p.y;
        const z = p.z;
        const lat = Math.asin(clamp(y, -1, 1)) / DEG;
        const lon = Math.atan2(-z, x) / DEG;
        const land = isLand(lat, lon);
        if (!land && Math.random() > 0.45) continue;
        const coast = land && isCoast(lat, lon);
        const t = coast ? 2 : land ? 1 : 0;
        const r = R * (t === 2 ? 1.006 : t === 1 ? 1.004 + MOUNTAINS * landHeight(lat, lon) : 1.0);
        pos.push(x * r, y * r, z * r);
        city.push(land ? landLights(lat, lon) : 0);
        const n = patch(x, y, z, 1);
        if (t === 0) {
          c.copy(ocean1).lerp(ocean2, n);
          if (Math.random() < 0.06) c.lerp(oceanHi, 0.7);
        } else {
          const lc = vivid(landColor(lat, lon));
          // a little sparkle so neighbouring stars aren't all identical
          const v = LAND_GAIN * (0.86 + 0.28 * patch(z, x, y, 1.6)) * (0.92 + 0.16 * Math.random());
          if (t === 1) {
            c.setRGB(lc[0] * v, lc[1] * v, lc[2] * v, THREE.NoColorSpace);
          } else {
            // beaches: the land's own colour, lit up towards sand
            c.setRGB(
              (lc[0] + (sand[0] - lc[0]) * 0.45) * v * 1.1,
              (lc[1] + (sand[1] - lc[1]) * 0.45) * v * 1.1,
              (lc[2] + (sand[2] - lc[2]) * 0.45) * v * 1.1,
              THREE.NoColorSpace
            );
          }
        }
        col.push(c.r, c.g, c.b);
        type.push(t);
        rnd.push(Math.random());
        scl.push(t === 2 ? 1.05 + Math.random() * 0.25 : t === 1 ? 0.74 + Math.random() * 0.36 : 0.68 + Math.random() * 0.38);
      }
      // Shuffle, so the first n points are always spread evenly: far away,
      // Earth draws only a prefix (particles budgeted by on-screen size).
      const n = type.length;
      const order = new Uint32Array(n);
      for (let i = 0; i < n; i++) order[i] = i;
      for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = order[i]; order[i] = order[j]; order[j] = t; }
      const pick = (src, k) => { const out = new Float32Array(n * k); for (let i = 0; i < n; i++) for (let c = 0; c < k; c++) out[i * k + c] = src[order[i] * k + c]; return out; };
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pick(pos, 3), 3));
      g.setAttribute('aColor', new THREE.BufferAttribute(pick(col, 3), 3));
      g.setAttribute('aType', new THREE.BufferAttribute(pick(type, 1), 1));
      g.setAttribute('aCity', new THREE.BufferAttribute(pick(city, 1), 1));
      g.setAttribute('aRand', new THREE.BufferAttribute(pick(rnd, 1), 1));
      g.setAttribute('aScale', new THREE.BufferAttribute(pick(scl, 1), 1));
      earthPoints = new THREE.Points(g, earthMaterial);
      earthPoints.renderOrder = 1;
      earthPoints.frustumCulled = false;
      EARTH_N = n;
      spin.add(earthPoints);
    })();

    // ---- atmosphere: sky blue on the day side, pink at sunset, a faint
    //      purple on the night side ------------------------------------------
    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.13, 64, 48),
      new THREE.ShaderMaterial({
        uniforms: { uSunDir: U.uSunDir, uDim: U.uDim },
        vertexShader: /* glsl */ `
          varying vec3 vN;
          varying vec3 vWorldN;
          void main() {
            vN = normalize(normalMatrix * normal);
            vWorldN = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uSunDir;
          uniform float uDim;
          varying vec3 vN;
          varying vec3 vWorldN;
          void main() {
            float glow = smoothstep(0.0, 0.5, -vN.z);
            float s = dot(vWorldN, uSunDir);
            float day = smoothstep(-0.2, 0.4, s);
            float sunset = exp(-pow((s + 0.02) / 0.2, 2.0));
            vec3 col = mix(vec3(0.36, 0.22, 0.85), vec3(0.38, 0.64, 1.0), day);
            col = mix(col, vec3(1.0, 0.46, 0.72), sunset * 0.85);
            float strength = 0.28 + 0.8 * max(day, sunset * 0.9);
            gl_FragColor = vec4(col * glow * strength * (1.0 - 0.4 * uDim), 1.0);
          }
        `,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    atmosphere.renderOrder = 3;
    scene.add(atmosphere);

    // ---- Luna --------------------------------------------------------------
    const moon = new THREE.Group();
    scene.add(moon);
    (function buildMoon() {
      // Colours from the Moon map in planet-maps.js (Solar System Scope,
      // CC BY 4.0), in Luna's own frame; a soft pattern if it is missing.
      const MAPS = window.YOU_ARE_HERE_PLANET_MAPS;
      let moonMap = null;
      if (MAPS && MAPS.moon) {
        const pal = decode(MAPS.moon.palette);
        const idx = decode(MAPS.moon.data);
        moonMap = (lat, lon) => {
          const x = clamp(Math.floor(((lon + 180) / 360) * MAPS.width), 0, MAPS.width - 1);
          const y = clamp(Math.floor(((90 - lat) / 180) * MAPS.height), 0, MAPS.height - 1);
          const k = idx[y * MAPS.width + x] * 3;
          return [pal[k] / 255, pal[k + 1] / 255, pal[k + 2] / 255];
        };
      }
      const n = 16000;
      const pos = new Float32Array(n * 3);
      const col = new Float32Array(n * 3);
      const scl = new Float32Array(n);
      const light = new THREE.Color('#ecebfa');
      const mare = new THREE.Color('#8f8bb2');
      const c = new THREE.Color();
      for (let i = 0; i < n; i++) {
        const u = Math.random() * 2 - 1;
        const a = Math.random() * TAU;
        const s = Math.sqrt(1 - u * u);
        const x = s * Math.cos(a);
        const y = u;
        const z = s * Math.sin(a);
        pos[i * 3] = x * MOON_R;
        pos[i * 3 + 1] = y * MOON_R;
        pos[i * 3 + 2] = z * MOON_R;
        if (moonMap) {
          const mc = moonMap(Math.asin(clamp(y, -1, 1)) / DEG, Math.atan2(-z, x) / DEG);
          c.setRGB(mc[0] * 1.05, mc[1] * 1.05, mc[2] * 1.12, THREE.NoColorSpace);
        } else {
          c.copy(light).lerp(mare, smoothstep(0.55, 0.8, patch(x * 1.3, y * 1.3, z * 1.3, 0.9)));
        }
        col[i * 3] = c.r;
        col[i * 3 + 1] = c.g;
        col[i * 3 + 2] = c.b;
        scl[i] = 0.7 + Math.random() * 0.5;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
      g.setAttribute('aScale', new THREE.BufferAttribute(scl, 1));
      const pts = new THREE.Points(g, new THREE.ShaderMaterial({
        uniforms: Object.assign({ uSize: { value: 0.013 } }, U),
        vertexShader: MOON_VERTEX,
        fragmentShader: POINT_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }));
      pts.renderOrder = 1;
      moon.add(pts);
      const core = new THREE.Mesh(new THREE.SphereGeometry(MOON_R * 0.97, 48, 32), new THREE.MeshBasicMaterial({ color: 0x040208 }));
      core.renderOrder = -1;
      moon.add(core);
    })();

    // ---- Sol --------------------------------------------------------------
    function canvasTex(size, draw) {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      draw(c.getContext('2d'), size);
      return env.makeCanvasTexture(c);
    }
    const diskTex = canvasTex(256, (ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, 'rgba(255, 253, 246, 1)');
      g.addColorStop(0.7, 'rgba(255, 238, 205, 1)');
      g.addColorStop(0.92, 'rgba(255, 196, 140, 1)');
      g.addColorStop(0.985, 'rgba(255, 170, 120, 0.9)');
      g.addColorStop(1, 'rgba(255, 170, 120, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    });
    const coronaTex = canvasTex(512, (ctx, s) => {
      const h = s / 2;
      const g = ctx.createRadialGradient(h, h, h * 0.14, h, h, h);
      g.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
      g.addColorStop(0.2, 'rgba(240, 225, 255, 0.55)');
      g.addColorStop(0.5, 'rgba(210, 170, 255, 0.12)');
      g.addColorStop(1, 'rgba(200, 160, 255, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
      ctx.globalCompositeOperation = 'lighter';
      ctx.translate(h, h);
      for (let i = 0; i < 70; i++) {
        ctx.rotate(TAU / 70 + (Math.random() - 0.5) * 0.06);
        const len = h * (0.35 + Math.random() * 0.6);
        const ray = ctx.createLinearGradient(h * 0.14, 0, len, 0);
        ray.addColorStop(0, 'rgba(255, 245, 255, 0.35)');
        ray.addColorStop(1, 'rgba(255, 210, 240, 0)');
        ctx.fillStyle = ray;
        ctx.beginPath();
        ctx.moveTo(h * 0.14, -2.5);
        ctx.lineTo(len, 0);
        ctx.lineTo(h * 0.14, 2.5);
        ctx.fill();
      }
    });
    const flareTex = canvasTex(256, (ctx, s) => {
      const h = s / 2;
      const g = ctx.createRadialGradient(h, h, 0, h, h, h);
      g.addColorStop(0, 'rgba(255, 255, 255, 1)');
      g.addColorStop(0.08, 'rgba(255, 250, 240, 0.9)');
      g.addColorStop(0.3, 'rgba(255, 210, 230, 0.25)');
      g.addColorStop(1, 'rgba(255, 210, 230, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.fillRect(0, h - 1.5, s, 3);
      ctx.fillRect(h - 1.5, 0, 3, s);
    });
    function sunSprite(tex, size, order) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
      }));
      sp.scale.set(size, size, 1);
      sp.renderOrder = order;
      return sp;
    }
    const sol = new THREE.Group();
    const solGlow = sunSprite(env.sunTexture, SUN_R0 * 9, 4);
    const solDisk = sunSprite(diskTex, SUN_R0 * 2, 5);
    const solCorona = sunSprite(coronaTex, SUN_R0 * 8, 6);
    const solFlare = sunSprite(flareTex, SUN_R0 * 2.6, 7);
    solCorona.material.opacity = 0;
    solFlare.material.opacity = 0;
    sol.add(solGlow, solDisk, solCorona);
    scene.add(sol, solFlare);
    let SUN_R = sunR();
    function applySizes() {
      SUN_R = sunR();
      sol.scale.setScalar(SUN_R / SUN_R0);
      solFlare.scale.setScalar(SUN_R / SUN_R0);
      MOON_ORBIT = moonOrbit();
      moonScale = moonR() / MOON_R;
      moon.scale.setScalar(moonScale);
    }
    let moonScale = 1;

    // ---- orbit lines (shown when you're far out) --------------------------
    function ringLine(radius, color) {
      const pts = [];
      for (let i = 0; i <= 256; i++) {
        const a = (i / 256) * TAU;
        pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
      }
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })
      );
      line.renderOrder = 0;
      scene.add(line);
      return line;
    }
    // Earth's orbit: drawn round the Sun in the ecliptic plane (y = 0 in this
    // frame), at Earth's current distance. Luna's orbit: the plane through
    // where it is now and where it will be in six hours.
    const earthOrbitRing = ringLine(1, 0xff8cc0);
    const moonOrbitRing = ringLine(1, 0xbfc8ff);
    function placeEarthOrbit() {
      earthOrbitRing.position.copy(sunPos);
      earthOrbitRing.scale.setScalar(sunDist);
    }

    // ---- the sky: stars, and the Milky Way you came from ------------------
    let skyPoints = null;
    function buildSky(inside, outside) {
      if (skyPoints) { scene.remove(skyPoints); skyPoints.geometry.dispose(); skyPoints.material.dispose(); }
      const stars = 4000;
      const band = 18000;
      const n = stars + band;
      const pos = new Float32Array(n * 3);
      const col = new Float32Array(n * 3);
      const cIn = new THREE.Color(inside);
      const cOut = new THREE.Color(outside);
      const white = new THREE.Color('#fff0f6');
      const c = new THREE.Color();
      // The band runs along the real galactic plane: galactic coordinates
      // turned into this ecliptic frame with Astronomy Engine's rotation
      // matrices (the plane meets the ecliptic at about 60 degrees), with
      // its brightest, widest part towards the galactic centre in Sagittarius.
      const gx = SKY.galacticToScene(0, 0);
      const gy = SKY.galacticToScene(90, 0);
      const gz = SKY.galacticToScene(0, 90);
      const galToScene = (x, y, z, out) => out.set(
        x * gx[0] + y * gy[0] + z * gz[0], x * gx[1] + y * gy[1] + z * gz[1], x * gx[2] + y * gy[2] + z * gz[2]);
      const v = new THREE.Vector3();
      for (let i = 0; i < n; i++) {
        if (i < stars) {
          const u = Math.random() * 2 - 1;
          const a = Math.random() * TAU;
          const s = Math.sqrt(1 - u * u);
          v.set(s * Math.cos(a), u, s * Math.sin(a));
          c.copy(white);
        } else {
          // more stars towards the galaxy's centre, like the real sky
          const a = (Math.random() < 0.35 ? (Math.random() - 0.5) * 1.4 : Math.random() * TAU);
          const g = Math.sqrt(-2 * Math.log(Math.random() + 1e-9)) * Math.cos(TAU * Math.random());
          // a: galactic longitude (0 = the centre); lat: galactic latitude
          const centre = Math.cos(a) * 0.5 + 0.5;
          const lat = g * (0.06 + 0.07 * centre);
          galToScene(Math.cos(a) * Math.cos(lat), Math.sin(a) * Math.cos(lat), Math.sin(lat), v);
          c.copy(cOut).lerp(cIn, centre * centre);
        }
        const r = 380;
        pos[i * 3] = v.x * r;
        pos[i * 3 + 1] = v.y * r;
        pos[i * 3 + 2] = v.z * r;
        const b = i < stars ? 0.5 + Math.random() * 0.5 : 0.35 + Math.random() * 0.45;
        col[i * 3] = c.r * b;
        col[i * 3 + 1] = c.g * b;
        col[i * 3 + 2] = c.b * b;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      skyPoints = new THREE.Points(g, new THREE.PointsMaterial({
        size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.85,
        depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      skyPoints.renderOrder = -2;
      scene.add(skyPoints);
    }
    buildSky(env.galaxyColors.inside, env.galaxyColors.outside);

    // ---- where things are --------------------------------------------------
    const v1 = new THREE.Vector3();
    const v2 = new THREE.Vector3();
    const camDir = new THREE.Vector3();

    function latLonToWorld(lat, lon, radius, out) {
      localDir(lat, lon, out || (out = new THREE.Vector3())).multiplyScalar(radius || R);
      spin.updateWorldMatrix(true, false);
      return out.applyMatrix4(spin.matrixWorld);
    }
    function worldToLatLon(v) {
      spin.updateWorldMatrix(true, false);
      const local = v.clone().applyMatrix4(new THREE.Matrix4().copy(spin.matrixWorld).invert()).normalize();
      return { lat: Math.asin(clamp(local.y, -1, 1)) / DEG, lon: Math.atan2(-local.z, local.x) / DEG };
    }

    // ---- Luna, where it really is ------------------------------------------
    // Its direction from Earth comes from Astronomy Engine for the clock's
    // date, so the side Sol lights is the real phase seen from Earth. Its
    // distance follows the scale mode (squeezed in the illustrative view).
    const moonOrbitPos = new THREE.Vector3();
    const moonAhead = new THREE.Vector3();
    const ringUp = new THREE.Vector3(0, 1, 0);
    const moonMatrix = new THREE.Matrix4();
    const moonQuat = new THREE.Quaternion();
    function placeMoon(ms) {
      const m = SKY.geoVector('Moon', ms);
      const trueDist = SKY.len3(m) * SKY.AU_KM * R / SKY.EARTH_R_KM;
      const dist = SKY.SCALE_MODES[scaleMode].moonDist || trueDist;
      MOON_ORBIT = dist;
      moonOrbitPos.set(m[0], m[1], m[2]).normalize().multiplyScalar(dist);
      const later = SKY.geoVector('Moon', ms + 6 * 3600e3);
      moonAhead.set(later[0], later[1], later[2]).normalize();
      const normal = moonOrbitPos.clone().normalize().cross(moonAhead).normalize();
      if (normal.lengthSq() > 0.5) moonOrbitRing.quaternion.setFromUnitVectors(ringUp, normal);
      moonOrbitRing.scale.setScalar(dist);
      // Luna's own orientation (it keeps one face towards Earth), from the IAU model.
      const b = SKY.bodyMatrix('Moon', ms);
      moonMatrix.set(b[0], b[1], b[2], 0, b[3], b[4], b[5], 0, b[6], b[7], b[8], 0, 0, 0, 0, 1);
      moonQuat.setFromRotationMatrix(moonMatrix);
    }

    // The Moon on the clock's date: its phase, how much is lit, and the next
    // full moon (Astronomy Engine). Worked out again when the date moves on.
    let moonInfoCache = null;
    let moonInfoAt = -Infinity;
    function moonInfo() {
      const now = performance.now();
      const stale = !moonInfoCache || Math.abs(timeMs - moonInfoCache.ms) > 10 * 60e3
        || (moonInfoCache.nextFull && timeMs > moonInfoCache.nextFull);
      if (stale && now - moonInfoAt > 200) {
        moonInfoAt = now;
        const p = SKY.moonPhase(timeMs, true);
        p.ms = timeMs;
        const changed = !moonInfoCache || p.name !== moonInfoCache.name || p.lit !== moonInfoCache.lit;
        moonInfoCache = p;
        if (changed) refreshMoonLabel();
      }
      return moonInfoCache;
    }

    // A small label by Luna: its phase on the clock's date
    const moonLabelCanvas = document.createElement('canvas');
    moonLabelCanvas.width = 640;
    moonLabelCanvas.height = 170;
    const moonLabelTex = env.makeCanvasTexture(moonLabelCanvas);
    const moonLabel = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonLabelTex, transparent: true, depthWrite: false, depthTest: false, opacity: 0 }));
    moonLabel.center.set(0.5, -2.1); // above its disc
    const MOON_LABEL_W = 1.5;
    moonLabel.scale.set(MOON_LABEL_W, MOON_LABEL_W * (170 / 640), 1);
    moonLabel.renderOrder = 9;
    moon.add(moonLabel);
    function refreshMoonLabel() {
      const info = moonInfoCache;
      const ctx = moonLabelCanvas.getContext('2d');
      const W = moonLabelCanvas.width;
      ctx.clearRect(0, 0, W, moonLabelCanvas.height);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(10, 2, 10, 0.9)';
      ctx.shadowBlur = 18;
      ctx.font = 'italic 600 66px "Cormorant Garamond", Georgia, serif';
      ctx.fillStyle = '#f4f2ff';
      ctx.fillText('Luna', W / 2, 52);
      if (info) {
        ctx.font = '500 32px "Jost", "Segoe UI", sans-serif';
        ctx.fillStyle = 'rgba(225, 222, 255, 0.92)';
        ctx.fillText(`${info.name} · ${info.lit}% lit`, W / 2, 124);
      }
      moonLabelTex.needsUpdate = true;
    }

    // How directly you're looking at Luna, close up (0..1).
    const toMoonTmp = new THREE.Vector3();
    const fwdTmp = new THREE.Vector3();
    function moonFocus(camera) {
      toMoonTmp.copy(moon.position).sub(camera.position);
      const d = toMoonTmp.length() / Math.max(0.2, moonScale);
      camera.getWorldDirection(fwdTmp);
      const facing = fwdTmp.dot(toMoonTmp.normalize());
      return smoothstep(0.97, 0.995, facing) * (1 - smoothstep(4.5, 7, d));
    }

    // ---- real solar eclipses ------------------------------------------------
    // The next solar eclipse Astronomy Engine predicts after the clock's
    // date, seen from the place where it is greatest. The clock plays it
    // through, slowing down around the peak. Seen from that place, the Sun
    // and the Moon are drawn larger than real by the same factor (so their
    // sizes, their separation and how much of the Sun is covered all stay
    // true); the Moon is placed between the camera and the Sun accordingly.
    const eclipse = {
      active: false, info: null, t: 0, seconds: 17, keys: null, blend: 0,
      coverage: 0, total: false, lastTotal: false, flash: 0, magnify: 1,
    };
    const ECLIPSE_SECONDS = 17;
    const obsPoint = new THREE.Vector3();
    const eclMoonPos = new THREE.Vector3();
    const perp = new THREE.Vector3();
    const toSunV = new THREE.Vector3();

    // Where the camera should be: a little above the place where the eclipse
    // is greatest, looking at the Sun.
    function eclipseView() {
      const info = eclipse.info;
      if (info && Number.isFinite(info.lat)) latLonToWorld(info.lat, info.lon, R * 1.22, obsPoint);
      else obsPoint.copy(sunDir).multiplyScalar(R * 1.22);
      const L = v1.copy(sunPos).sub(obsPoint).normalize();
      const radius = 10;
      const T = obsPoint.clone().addScaledVector(L, radius);
      return { target: T, radius, phi: Math.acos(clamp(-L.y, -1, 1)), theta: Math.atan2(-L.x, -L.z) };
    }
    // Finds the next solar eclipse after fromMs and starts playing it over
    // `seconds`. Returns { info, view } or null if none could be found.
    function startEclipse(seconds, fromMs) {
      const info = SKY.nextSolarEclipse(Number.isFinite(fromMs) ? fromMs : timeMs);
      const L = info && info.local;
      if (!L || L.partialBegin == null || L.partialEnd == null || L.peak == null) return null;
      const core = Math.max(L.totalBegin != null && L.totalEnd != null ? (L.totalEnd - L.totalBegin) / 2 : 0, 5 * 60e3) * 1.5;
      eclipse.keys = [[0, L.partialBegin - 8 * 60e3], [0.36, L.peak - core], [0.64, L.peak + core], [1, L.partialEnd + 8 * 60e3]];
      eclipse.info = info;
      eclipse.seconds = clamp(+seconds || ECLIPSE_SECONDS, 4, 120);
      eclipse.t = 0;
      eclipse.active = true;
      eclipse.lastTotal = false;
      setTime(eclipse.keys[0][1], true);
      return { info, view: eclipseView() };
    }
    // The clock's time for this moment of the eclipse (main.js sets the clock).
    function eclipseTimeAt(u) {
      const k = eclipse.keys;
      for (let i = 1; i < k.length; i++) {
        if (u <= k[i][0]) {
          const f = (u - k[i - 1][0]) / (k[i][0] - k[i - 1][0]);
          return k[i - 1][1] + (k[i][1] - k[i - 1][1]) * clamp(f, 0, 1);
        }
      }
      return k[k.length - 1][1];
    }
    function advanceEclipse(dt) {
      if (!eclipse.active) return null;
      eclipse.t += dt;
      const u = eclipse.t / eclipse.seconds;
      const ms = eclipseTimeAt(clamp(u, 0, 1));
      if (u >= 1) eclipse.active = false;
      return ms;
    }
    function stopEclipse() { eclipse.active = false; }

    // Places Luna for the eclipse view and returns how much of the Sun it
    // covers (by diameter, like an eclipse's magnitude: 1 = all of it).
    function placeEclipseMoon(camera) {
      const info = eclipse.info;
      const topo = SKY.topocentric(timeMs, info.lat, info.lon);
      const C = camera.position;
      toSunV.copy(sunPos).sub(C);
      const distS = toSunV.length();
      toSunV.normalize();
      const k = (SUN_R / distS) / topo.sun.radius; // how much larger than real
      eclipse.magnify = k;
      const sd = topo.sun.dir;
      const md = topo.moon.dir;
      const c = clamp(sd[0] * md[0] + sd[1] * md[1] + sd[2] * md[2], -1, 1);
      const sep = Math.acos(c);
      perp.set(md[0] - sd[0] * c, md[1] - sd[1] * c, md[2] - sd[2] * c);
      perp.addScaledVector(toSunV, -perp.dot(toSunV));
      if (perp.lengthSq() < 1e-14) perp.copy(UP).addScaledVector(toSunV, -toSunV.y);
      perp.normalize();
      const u = clamp(eclipse.t / eclipse.seconds, 0, 1);
      const w = smoothstep(0, 0.07, u) * (1 - smoothstep(0.93, 1, u));
      eclipse.blend = w;
      const ang = Math.min(k * sep, 1.3);
      const dM = 14;
      eclMoonPos.copy(C).addScaledVector(toSunV, Math.cos(ang) * dM).addScaledVector(perp, Math.sin(ang) * dM);
      const s = (k * topo.moon.radius * dM) / MOON_R;
      moon.position.lerp(eclMoonPos, w);
      moon.scale.setScalar(moonScale + (s - moonScale) * w);
      const aS = topo.sun.radius;
      const aM = topo.moon.radius;
      eclipse.total = sep <= aM - aS;
      const cov = sep >= aS + aM ? 0 : eclipse.total ? 1 : clamp((aS + aM - sep) / (2 * aS), 0, 1);
      return cov * w;
    }

    const camFwd = new THREE.Vector3();

    // ---- per-frame update ----------------------------------------------------
    // o.phase: the shared animation phase; o.ms: the clock's time.
    function update(dt, camera, o) {
      U.uPhase.value = o.phase;
      setTime(Number.isFinite(o.ms) ? o.ms : Date.now(), eclipse.active);

      moon.position.copy(moonOrbitPos);
      moon.quaternion.copy(moonQuat);
      moon.scale.setScalar(moonScale);
      let cov = 0;
      if (eclipse.active && eclipse.info) cov = placeEclipseMoon(camera);
      else { eclipse.total = false; eclipse.blend = 0; }

      // Eclipse effects only when Sol is in view.
      camera.getWorldDirection(camFwd);
      const sunAhead = camFwd.dot(v1.copy(sunPos).sub(camera.position).normalize());
      cov *= smoothstep(0.35, 0.6, sunAhead);
      eclipse.coverage = cov;
      const totalNow = eclipse.total && cov > 0.9;
      if (totalNow !== eclipse.lastTotal) eclipse.flash = 1; // the "diamond ring" at second and third contact
      eclipse.lastTotal = totalNow;
      eclipse.flash = Math.max(0, eclipse.flash - dt * 1.6);
      U.uDim.value = smoothstep(0.55, 1, cov);
      solGlow.material.opacity = 1 - 0.9 * smoothstep(0.55, 1, cov);
      solCorona.material.opacity = totalNow ? smoothstep(0.93, 1, cov) : 0;
      if (eclipse.flash > 0 && eclipse.blend > 0) {
        const vs = v2.copy(sunPos).sub(camera.position).normalize();
        const vm = camDir.copy(moon.position).sub(camera.position).normalize();
        const d = vs.clone().sub(vm);
        d.sub(vs.clone().multiplyScalar(d.dot(vs)));
        if (d.lengthSq() < 1e-8) d.copy(UP);
        solFlare.position.copy(sunPos).addScaledVector(d.normalize(), SUN_R * 0.97);
        solFlare.material.opacity = eclipse.flash;
      } else {
        solFlare.material.opacity = 0;
      }
      if (skyPoints) {
        skyPoints.material.opacity = 0.85 * (1 - 0.35 * U.uDim.value);
        skyPoints.position.copy(camera.position); // the stars stay at "infinity" at every scale
      }
      // Earth's particles by on-screen size.
      const pxPerUnit = U.uViewH.value / (2 * Math.tan((camera.fov * Math.PI) / 360));
      const earthPx = (R * pxPerUnit) / Math.max(1e-6, camera.position.length());
      const want = clamp(Math.round(3 * earthPx * earthPx), 60, EARTH_N);
      earthPoints.geometry.setDrawRange(0, want);
      earthMaterial.uniforms.uLod.value = Math.sqrt(EARTH_N / want);
      earthDrawn = want;
      occluder.visible = earthPx > 1.5;

      // Luna's orbit line appears as you pull back (Earth's orbit is drawn
      // with the planets' orbits in planets.js).
      const camDist = camera.position.length();
      earthOrbitRing.visible = false;
      moonOrbitRing.material.opacity = 0.28 * smoothstep(MOON_ORBIT * 0.9, MOON_ORBIT * 1.8, camDist);
      moonInfo();
      const ms = moon.scale.x;
      moonLabel.scale.set(MOON_LABEL_W / ms, (MOON_LABEL_W * (170 / 640)) / ms, 1);
      const toMoon = camera.position.distanceTo(moon.position);
      moonLabel.material.opacity = eclipse.active ? 0 : (1 - smoothstep(16, 30, toMoon)) * smoothstep(1.6, 2.4, toMoon) * (1 - U.uDim.value);
      moonLabel.visible = moonLabel.material.opacity > 0.01;
      return { coverage: cov, eclipseActive: eclipse.active, total: totalNow };
    }

    // Changes the scale mode (sizes and distances), keeping the clock's date.
    function setScale(mode) {
      if (!SKY.SCALE_MODES[mode]) return;
      scaleMode = mode;
      applySizes();
      setTime(timeMs, true);
    }

    // ---- the little world map for the top-left corner ----------------------
    const MAP_W = 352;
    const MAP_H = 176;
    const mapImage = document.createElement('canvas');
    mapImage.width = MAP_W;
    mapImage.height = MAP_H;
    (function drawWorldMap() {
      const ctx = mapImage.getContext('2d');
      ctx.fillStyle = '#0e1240';
      ctx.fillRect(0, 0, MAP_W, MAP_H);
      const img = ctx.getImageData(0, 0, MAP_W, MAP_H);
      for (let y = 0; y < MAP_H; y++) {
        for (let x = 0; x < MAP_W; x++) {
          const lat = 90 - ((y + 0.5) / MAP_H) * 180;
          const lon = ((x + 0.5) / MAP_W) * 360 - 180;
          if (!isLand(lat, lon)) continue;
          const i = (y * MAP_W + x) * 4;
          const lc = landColor(lat, lon);
          const lift = isCoast(lat, lon) ? 1.15 : 1;
          img.data[i] = Math.min(255, Math.round(lc[0] * 255 * lift));
          img.data[i + 1] = Math.min(255, Math.round(lc[1] * 255 * lift));
          img.data[i + 2] = Math.min(255, Math.round(lc[2] * 255 * lift));
          img.data[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    })();

    applySizes();
    setTime(env.startMs || Date.now(), true);
    moonInfo();

    return {
      scene, R, MOON_R, sunDir, sunPos, moon, sol, spin,
      get sunDist() { return sunDist; },
      get sunAU() { return sunAU; },
      get sunR() { return SUN_R; },
      get moonOrbit() { return MOON_ORBIT; },
      get scaleMode() { return scaleMode; },
      get timeMs() { return timeMs; },
      get drawn() { return earthDrawn; },
      mapImage, eclipse, ECLIPSE_SECONDS,
      update, setTime, setScale, startEclipse, advanceEclipse, stopEclipse, eclipseView, moonFocus, moonInfo,
      latLonToWorld, worldToLatLon, isLand,
      setSkyColors: buildSky,
      subsolar() { return worldToLatLon(sunDir.clone()); },
      sublunar() { return worldToLatLon(moonOrbitPos.clone()); },
      setViewport(viewH, maxPoint) { U.uViewH.value = viewH; U.uMaxSize.value = maxPoint; },
    };
  },
};
