/*  You Are Here: main.js
    ------------------------------------------------------------------
    A spiral galaxy of glowing particles (after the Three.js "galaxy
    generator") that you can fly through, all the way down to Earth:
      - smooth zoom, rotate and slide from any angle (mouse, touch, keys)
      - the Milky Way's real shape (galaxy-model.js): a central bar and the
        measured spiral arms, with their names
      - Sol, our Sun, as a "you are here" star; fly into it to reach Earth
        (earth.js): real day and night, city lights, Luna with its real
        phase, and an eclipse
      - shooting stars around Earth, and optional ocean waves in the galaxy
      - a timed tour, which can also be saved as a video file
      - a map, arrow pads and a Go to menu for getting around
      - a small editor for the galaxy's look and the tour (saved in the browser)
      - safeguards so it can run for as long as you like

    Sections
      1. Boot: loads Three.js, then calls start()
      2. Settings: config.js defaults + anything saved in the browser
      3. Renderer, scene, camera
      4. Shaders
      5. Galaxy particles and the arms' names
      6. Text labels and small shared helpers
      7. Sol: our Sun, a "you are here" star in an arm
      8. Shooting stars
      9. Captions
     10. Camera controls
     11. Tour
     12. Interface (zoom rail, toolbar, editor, keyboard)
     12b. Getting around: arrow pads, the map, and Go to
     12c. Worlds: the journey between the galaxy and Earth
     12d. Save the tour as a video file
     13. Animation loop and long-running safeguards

    This is a normal (non-module) script, so the project also works when
    you just double-click the .html file. Three.js is loaded with import().
*/
(() => {
  'use strict';

  // ===================================================================
  // 1. Boot
  // ===================================================================
  const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';
  const STORE_KEY = 'you-are-here-settings:v1';
  const TAU = Math.PI * 2;
  // Every animation repeats exactly once per loop, so time can be wrapped
  // without a visible jump. This keeps numbers small forever.
  const LOOP_SECONDS = 120;

  const $ = (sel) => document.querySelector(sel);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (e0, e1, x) => {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };

  function showFatal(message) {
    const el = $('#fatal');
    el.querySelector('p').textContent = message;
    el.hidden = false;
  }

  // The single-file copy (made for phones) carries Three.js inside the page,
  // so it works offline. Otherwise it comes from the web.
  function packedThree() {
    const packed = document.getElementById('three-module');
    if (!packed || packed.textContent.length < 1000) return null;
    try {
      return URL.createObjectURL(new Blob([packed.textContent], { type: 'text/javascript' }));
    } catch (err) {
      return null;
    }
  }
  const packedUrl = packedThree();
  // The live site serves its own pinned copy (vendor/); the double-click
  // copy (file://) can't import local modules, so it uses the CDN.
  const LOCAL_THREE = 'vendor/three.module.min.js';
  const loadThree = packedUrl
    ? import(packedUrl).catch(() => import(THREE_URL))
    : location.protocol === 'file:' ? import(THREE_URL) : import(new URL(LOCAL_THREE, location.href).href).catch(() => import(THREE_URL));

  loadThree.then(
    (THREE) => {
      try {
        start(THREE);
      } catch (err) {
        console.error(err);
        showFatal('Something went wrong while starting: ' + (err && err.message ? err.message : err));
      }
    },
    (err) => {
      console.error(err);
      showFatal("Couldn't load Three.js, the 3D engine this page uses. Check your internet connection and reload. It comes from cdn.jsdelivr.net.");
    }
  );

  // Text helpers (no Three.js needed)
  const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

  // Splits text into what people see as single characters, so accented
  // letters and emoji stay whole.
  function graphemes(text) {
    if (!text) return [];
    return segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : Array.from(text);
  }

  // ===================================================================
  function start(THREE) {
    // Colours are used exactly as written (like the original tutorial).
    THREE.ColorManagement.enabled = false;
    if (!window.YouAreHereGalaxy) {
      showFatal("The galaxy's shape couldn't load. Check that galaxy-model.js is in the folder.");
      return;
    }
    const SKY = window.YouAreHereSky;
    if (!SKY) {
      showFatal("The astronomy couldn't load. Check that astronomy.browser.min.js and sky.js are in the folder.");
      return;
    }
    // One clock for everything that depends on time (sky.js): live, or
    // simulated between 1900 and 2100.
    const clock = SKY.createClock();

    // =================================================================
    // 2. Settings
    // =================================================================
    const CONFIG = window.YOU_ARE_HERE_CONFIG || {};
    // The galaxy's shape comes from galaxy-model.js (measured, not adjustable).
    // These are only its look: how many stars, the colours and the spin.
    const MODEL = window.YouAreHereGalaxy;
    const GALAXY_R = MODEL.radiusUnits; // the drawn radius, scene units
    const GALAXY_DEFAULTS = { count: 100000, insideColor: '#ff6030', outsideColor: '#1b3984', spinSpeed: 0.04 };
    const EXTRAS_DEFAULTS = { waves: false, shootingStars: true, navControls: true, earthInTour: true, labels: true, orbits: true, cards: true, belts: true };
    // The tour (play button): how long one run takes, and whether it repeats.
    const TOUR_DEFAULTS = { seconds: 150, repeat: true };
    const TOUR_MIN_SECONDS = 30;
    const TOUR_MAX_SECONDS = 600;
    const Z = Object.assign({ start: 9, closest: 0.3, farthest: 30 }, CONFIG.zoom || {});
    // Close up, the galaxy slows its spin: from closeBegin, fully by closeFull.
    Z.closeBegin = 3.4;
    Z.closeFull = 1.4;
    Z.closest = clamp(+Z.closest || 0.3, 0.05, 5);
    Z.farthest = clamp(+Z.farthest || 30, Z.closest * 4, 200);
    // Reduce motion: follows the system setting unless changed in About (M).
    const MOTION_KEY = 'you-are-here-motion';
    function storedMotion() { try { return localStorage.getItem(MOTION_KEY); } catch (e) { return null; } }
    let reducedMotion = storedMotion() === 'reduce' || (storedMotion() !== 'full' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    const coarsePointer = matchMedia('(pointer: coarse)').matches;

    function sanitizeGalaxy(g) {
      const color = (c, fallback) => (/^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : fallback);
      const num = (v, lo, hi, fallback) => (Number.isFinite(+v) ? clamp(+v, lo, hi) : fallback);
      return {
        count: Math.round(num(g.count, 5000, 300000, 100000)),
        insideColor: color(g.insideColor, '#ff6030'),
        outsideColor: color(g.outsideColor, '#1b3984'),
        spinSpeed: num(g.spinSpeed, 0, 1, 0.04),
      };
    }

    function sanitizeExtras(e) {
      const out = {};
      for (const k of Object.keys(EXTRAS_DEFAULTS)) out[k] = typeof e[k] === 'boolean' ? e[k] : EXTRAS_DEFAULTS[k];
      return out;
    }

    function sanitizeTour(t) {
      const sec = Number.isFinite(+t.seconds) ? Math.round(+t.seconds) : TOUR_DEFAULTS.seconds;
      return {
        seconds: clamp(sec, TOUR_MIN_SECONDS, TOUR_MAX_SECONDS),
        repeat: typeof t.repeat === 'boolean' ? t.repeat : TOUR_DEFAULTS.repeat,
      };
    }

    function configDefaults() {
      return {
        galaxy: sanitizeGalaxy(Object.assign({}, GALAXY_DEFAULTS, CONFIG.galaxy || {})),
        extras: sanitizeExtras(Object.assign({}, EXTRAS_DEFAULTS, CONFIG.extras || {})),
        tour: sanitizeTour(Object.assign({}, TOUR_DEFAULTS, CONFIG.tour || {})),
      };
    }

    // Each part (the look, the extras, the tour) is checked setting by
    // setting: if you edit a setting in config.js after changing it in the
    // app, config.js wins for that setting. Everything else you changed in
    // the app is kept.
    const FIELDS = ['galaxy', 'extras', 'tour'];
    const CONFIG_BASE = configDefaults();
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    let configChangedNotice = false;

    function sanitizeField(field, value, fallback) {
      switch (field) {
        case 'galaxy': return value && typeof value === 'object' ? sanitizeGalaxy(Object.assign({}, fallback, value)) : fallback;
        case 'extras': return value && typeof value === 'object' ? sanitizeExtras(Object.assign({}, fallback, value)) : fallback;
        case 'tour': return value && typeof value === 'object' ? sanitizeTour(Object.assign({}, fallback, value)) : fallback;
        default: return fallback;
      }
    }

    function loadSettings() {
      const base = configDefaults();
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { saved = null; }
      if (!saved || typeof saved !== 'object') return base;
      // What config.js said when those edits were saved (older saves kept it as text).
      let savedBase = saved.base;
      if (!savedBase && typeof saved.configStamp === 'string') {
        try { savedBase = JSON.parse(saved.configStamp); } catch (e) { savedBase = null; }
      }
      if (!savedBase || typeof savedBase !== 'object') savedBase = {};
      const out = Object.assign({}, base);
      for (const f of FIELDS) {
        if (!(f in saved)) continue;
        // Galaxy look, extras and the tour are checked setting by setting.
        if ((f === 'galaxy' || f === 'extras' || f === 'tour') && saved[f] && typeof saved[f] === 'object') {
          const from = savedBase[f] && typeof savedBase[f] === 'object' ? savedBase[f] : null;
          const merged = Object.assign({}, base[f]);
          for (const key of Object.keys(saved[f])) {
            if (!from || !(key in from) || same(from[key], base[f][key])) merged[key] = saved[f][key];
            else configChangedNotice = true;
          }
          out[f] = sanitizeField(f, merged, base[f]);
          continue;
        }
        if (f in savedBase && !same(savedBase[f], base[f])) { configChangedNotice = true; continue; }
        out[f] = sanitizeField(f, saved[f], base[f]);
      }
      return out;
    }

    let settings = loadSettings();

    function saveSettings() {
      try {
        const data = { version: 2, base: CONFIG_BASE };
        for (const f of FIELDS) data[f] = settings[f];
        localStorage.setItem(STORE_KEY, JSON.stringify(data));
        setStatus('Saved in this browser.');
      } catch (e) {
        setStatus('This browser blocked saving. Use Save backup to keep a copy.');
      }
    }

    // =================================================================
    // 3. Renderer, scene, camera
    // =================================================================
    const canvas = $('#scene');
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    } catch (err) {
      showFatal("This browser couldn't start WebGL, which the galaxy needs. Try an up-to-date Chrome, Edge, Firefox or Safari, and check that hardware acceleration is turned on.");
      return;
    }
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.setClearColor(0x07040d, 1);

    const gl = renderer.getContext();
    const pointRange = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
    const MAX_POINT = pointRange && pointRange[1] ? pointRange[1] : 64;
    const MAX_ANISO = renderer.capabilities.getMaxAnisotropy();
    let pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 900);
    const galaxy = new THREE.Group(); // everything that spins with the galaxy
    scene.add(galaxy);

    // Uniforms shared by the star shaders.
    const shared = {
      uPhase: { value: 0 },   // 0..2π, loops every LOOP_SECONDS
      uViewH: { value: 800 }, // canvas height in device pixels
      uWave: { value: 0 },    // 0 = flat, 1 = ocean waves
    };

    // Faint distant stars so every angle has a backdrop.
    (function addBackgroundStars() {
      const n = 3500;
      const p = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const r = 70 + Math.random() * 90;
        const u = Math.random() * 2 - 1;
        const a = Math.random() * TAU;
        const s = Math.sqrt(1 - u * u);
        p[i * 3] = r * s * Math.cos(a);
        p[i * 3 + 1] = r * u;
        p[i * 3 + 2] = r * s * Math.sin(a);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
      const mat = new THREE.PointsMaterial({
        color: 0xffe6ef, size: 1.4, sizeAttenuation: false,
        transparent: true, opacity: 0.45, depthWrite: false,
      });
      scene.add(new THREE.Points(geo, mat));
    })();

    // =================================================================
    // 4. Shaders
    // =================================================================
    const STAR_VERTEX = /* glsl */ `
      uniform float uPhase;
      uniform float uWave;
      uniform float uSize;
      uniform float uMaxSize;
      uniform float uViewH;
      attribute vec3 aColor;
      attribute float aScale;
      attribute float aRand;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec3 p = position;
        p.y += uWave * 0.16 * sin(length(p.xz) * 2.6 - uPhase * 30.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float dist = max(-mv.z, 0.001);
        float twinkle = 0.78 + 0.22 * sin(uPhase * 40.0 + aRand * 6.2831853);
        gl_PointSize = min(uSize * uViewH * aScale * twinkle / dist, uMaxSize);
        vAlpha = smoothstep(0.03, 0.3, dist); // fade stars right at the camera
        vColor = aColor;
      }
    `;

    const STAR_FRAGMENT = /* glsl */ `
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

    const starMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uPhase: shared.uPhase, uWave: shared.uWave, uViewH: shared.uViewH,
        uSize: { value: 0.028 },
        uMaxSize: { value: 48 },
      },
      vertexShader: STAR_VERTEX,
      fragmentShader: STAR_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    // =================================================================
    // 5. Galaxy particles and the arms' names
    // =================================================================
    let stars = null;
    let G = null; // { count, radii } for the current galaxy

    function disposeGalaxy() {
      if (stars) { galaxy.remove(stars); stars.geometry.dispose(); stars = null; }
    }

    function buildGalaxy() {
      disposeGalaxy();
      const count = settings.galaxy.count;
      // Where the stars are: the bar, the disc and the measured spiral arms.
      const model = MODEL.sample(count);
      const scales = new Float32Array(count);
      const rands = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        // Arm stars are a little bigger on average, so the arms stand out.
        scales[i] = (model.part[i] === 2 ? 0.4 : 0.3) + Math.random() * 0.7;
        rands[i] = Math.random();
      }

      const starGeo = new THREE.BufferGeometry();
      starGeo.setAttribute('position', new THREE.BufferAttribute(model.positions, 3));
      starGeo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
      starGeo.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));
      starGeo.setAttribute('aRand', new THREE.BufferAttribute(rands, 1));
      stars = new THREE.Points(starGeo, starMaterial);
      stars.renderOrder = 0;
      stars.frustumCulled = false; // the waves move stars away from their stored positions
      galaxy.add(stars);

      G = { count, radii: model.radii };
      recolorGalaxy();
    }

    // Colours only: no need to rebuild the stars.
    function recolorGalaxy() {
      if (!stars || !G) return;
      const g = settings.galaxy;
      const inside = new THREE.Color(g.insideColor);
      const outside = new THREE.Color(g.outsideColor);
      const mixed = new THREE.Color();
      const attr = stars.geometry.getAttribute('aColor');
      const col = attr.array;
      for (let i = 0; i < G.count; i++) {
        mixed.copy(inside).lerp(outside, Math.min(1, G.radii[i] / GALAXY_R));
        col[i * 3] = mixed.r;
        col[i * 3 + 1] = mixed.g;
        col[i * 3 + 2] = mixed.b;
      }
      attr.needsUpdate = true;
      buildMapBackground();
      if (earth) earth.setSkyColors(g.insideColor, g.outsideColor);
    }

    // The names of the arms, the bar and the centre. They fade in when you
    // are far enough out to see the arm they name, and out again close up.
    let armLabels = [];
    function buildArmLabels() {
      for (const s of armLabels) { galaxy.remove(s); s.material.map.dispose(); s.material.dispose(); }
      armLabels = [];
      for (const spot of MODEL.labelSpots()) {
        const t = textTexture(spot.name, { fill: spot.major ? '#e8eeff' : '#c9d3f2', core: '#ffffff', glow: 'rgba(120, 150, 255, 0.75)' });
        // The same size on screen however far away (a share of the screen height).
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t.tex, transparent: true, depthWrite: false, depthTest: false, opacity: 0, sizeAttenuation: false }));
        const h = spot.major ? 0.066 : 0.056;
        s.scale.set(h * t.aspect, h, 1);
        s.center.set(0.5, 0);
        s.position.set(spot.pos[0], spot.pos[1], spot.pos[2]);
        s.renderOrder = 3;
        s.visible = false;
        // The names in the middle (centre, bar, 3 kpc and Norma arms) only
        // show from closer in, so they don't pile up over the bar.
        const inner = ['centre', 'bar', 'near3', 'far3', 'norma'].includes(spot.id);
        // rank: who wins when two names overlap on screen (lower wins).
        const rank = spot.id === 'centre' ? 0 : inner ? 3 : spot.major ? 1 : 2;
        s.userData = { id: spot.id, alpha: 0, far: inner ? 6.5 : spot.major ? 21 : 15, h, aspect: t.aspect, rank };
        galaxy.add(s);
        armLabels.push(s);
      }
    }
    const labelPos = new THREE.Vector3();
    const labelProj = new THREE.Vector3();
    function updateArmLabels(dt) {
      const on = settings.extras.labels && world === 'galaxy' && !journey ? 1 : 0;
      const k = 1 - Math.exp(-dt * 4);
      // Smaller on narrow (portrait) screens, so long names still fit.
      const fit = clamp(camera.aspect * 1.4, 0.62, 1);
      const P = camera.projectionMatrix.elements;
      const placed = []; // screen boxes (NDC) of names already shown this frame
      const order = armLabels.slice().sort((a, b) => a.userData.rank - b.userData.rank);
      for (const s of order) {
        s.scale.set(s.userData.h * fit * s.userData.aspect, s.userData.h * fit, 1);
        s.getWorldPosition(labelPos);
        const d = labelPos.distanceTo(camera.position);
        // Shown from about 2.4 units away out to its own limit.
        const far = s.userData.far;
        let goal = on * smoothstep(1.4, 2.4, d) * (1 - smoothstep(far * 0.8, far, d));
        s.center.x = 0.5;
        if (goal > 0) {
          // The name's box on screen, in NDC (-1..1). It hangs above its
          // point (center.y = 0), and is centred on it unless that would
          // push it off the side, in which case it slides inwards.
          labelProj.copy(labelPos).project(camera);
          const w = s.scale.x * P[0], h = s.scale.y * P[5];
          const M = 0.02;
          let x0 = labelProj.x - w / 2;
          if (x0 + w > 1 - M) x0 = 1 - M - w;
          if (x0 < -1 + M) x0 = -1 + M;
          // Keep the box touching its point, so the name never drifts off it.
          x0 = clamp(x0, labelProj.x - w, labelProj.x);
          s.center.x = w > 0 ? (labelProj.x - x0) / w : 0.5;
          const box = [x0, labelProj.y, x0 + w, labelProj.y + h];
          const pad = h * 0.15;
          const hit = labelProj.z > 1 || placed.some((o) =>
            box[0] < o[2] + pad && box[2] > o[0] - pad && box[1] < o[3] + pad && box[3] > o[1] - pad);
          if (hit) goal = 0; // a more important name is already there
          else placed.push(box);
        }
        s.userData.alpha += (goal - s.userData.alpha) * k;
        if (s.userData.alpha < 0.004) s.userData.alpha = 0;
        s.material.opacity = s.userData.alpha * 0.9;
        s.visible = s.userData.alpha > 0;
      }
    }

    // =================================================================
    // 6. Text labels and small shared helpers
    // =================================================================
    const LABEL_FONT = 'italic 600 88px "Cormorant Garamond", Georgia, "Times New Roman", serif';
    const tmpV = new THREE.Vector3();
    const WORLD_UP = new THREE.Vector3(0, 1, 0);

    // Long text is split over two or three lines (wrap: letters per line),
    // so it fits on a phone screen.
    function wrapLines(text, measure, perLine) {
      const words = text.split(/\s+/).filter(Boolean);
      const n = Math.min(3, Math.ceil(graphemes(text).length / perLine));
      if (n <= 1 || words.length < 2) return [text];
      const total = measure.measureText(text).width;
      const lines = [];
      let line = '';
      for (const w of words) {
        const next = line ? line + ' ' + w : w;
        // Start a new line once this one has its share of the width.
        if (line && lines.length < n - 1 && measure.measureText(next).width > total / n + measure.measureText(w).width / 2) {
          lines.push(line);
          line = w;
        } else {
          line = next;
        }
      }
      lines.push(line);
      return lines;
    }

    function textTexture(text, opts) {
      const o = Object.assign({ font: LABEL_FONT, px: 88, fill: '#ffc9da', core: '#fff7fa', glow: 'rgba(255, 92, 138, 0.95)', wrap: 0 }, opts || {});
      const measure = document.createElement('canvas').getContext('2d');
      measure.font = o.font;
      const lines = o.wrap ? wrapLines(text, measure, o.wrap) : [text];
      const width = Math.ceil(Math.max(...lines.map((l) => measure.measureText(l).width)));
      const pad = 48;
      const lineH = o.px * 1.12;
      const oneLine = Math.ceil(o.px * 1.5 + pad);
      const c = document.createElement('canvas');
      c.width = Math.min(4096, width + pad * 2);
      c.height = Math.ceil(oneLine + lineH * (lines.length - 1));
      const ctx = c.getContext('2d');
      ctx.font = o.font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const x = c.width / 2;
      const y0 = c.height / 2 - (lineH * (lines.length - 1)) / 2;
      const each = (fn) => lines.forEach((l, i) => fn(l, y0 + i * lineH));
      // A soft dark halo first keeps the text readable over bright stars.
      ctx.shadowColor = 'rgba(12, 2, 10, 0.9)';
      ctx.shadowBlur = 26;
      ctx.fillStyle = 'rgba(12, 2, 10, 0.55)';
      each((l, y) => { ctx.fillText(l, x, y); ctx.fillText(l, x, y); });
      ctx.shadowColor = o.glow;
      ctx.shadowBlur = 30;
      ctx.fillStyle = o.fill;
      each((l, y) => ctx.fillText(l, x, y));
      ctx.shadowColor = 'rgba(255, 255, 255, 0.7)';
      ctx.shadowBlur = 8;
      ctx.fillStyle = o.core;
      each((l, y) => ctx.fillText(l, x, y));
      const tex = new THREE.CanvasTexture(c);
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.anisotropy = MAX_ANISO;
      // tall: how much taller than one line (keeps the letters the same size)
      tex.userData.tall = c.height / oneLine;
      return { tex, aspect: c.width / c.height, tall: tex.userData.tall };
    }

    function makeCanvasTexture(c) {
      const tex = new THREE.CanvasTexture(c);
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.anisotropy = MAX_ANISO;
      return tex;
    }


    // Times and sizes for the video controls.
    function fmtTime(sec) {
      const s = Math.max(0, Math.round(sec));
      return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }
    const fmtSize = (bytes) => (bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`);

    // =================================================================
    // 7. Sol: our Sun, one small star in an arm ("you are here")
    // =================================================================
    // The Sun is an ordinary star 8.15 kpc (about 26,600 light-years) from
    // the centre, near the inner edge of the Orion Arm (galaxy-model.js).
    // Fly into it (or click it) to travel to Earth.
    function glowCanvas(draw) {
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      draw(c.getContext('2d'));
      return makeCanvasTexture(c);
    }
    const sunTexture = glowCanvas((ctx) => {
      const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
      g.addColorStop(0, 'rgba(255, 253, 244, 1)');
      g.addColorStop(0.1, 'rgba(255, 240, 200, 1)');
      g.addColorStop(0.2, 'rgba(255, 196, 120, 0.9)');
      g.addColorStop(0.38, 'rgba(255, 120, 150, 0.32)');
      g.addColorStop(0.7, 'rgba(190, 90, 255, 0.07)');
      g.addColorStop(1, 'rgba(190, 90, 255, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 256);
      ctx.globalCompositeOperation = 'lighter';
      ctx.translate(128, 128);
      for (let i = 0; i < 12; i++) {
        ctx.rotate(TAU / 12);
        const len = i % 2 ? 92 : 118;
        const ray = ctx.createLinearGradient(0, 0, len, 0);
        ray.addColorStop(0, 'rgba(255, 220, 170, 0.35)');
        ray.addColorStop(1, 'rgba(255, 220, 170, 0)');
        ctx.fillStyle = ray;
        ctx.beginPath();
        ctx.moveTo(18, -3);
        ctx.lineTo(len, 0);
        ctx.lineTo(18, 3);
        ctx.fill();
      }
    });
    const solMarker = new THREE.Group();
    galaxy.add(solMarker);
    const solStar = new THREE.Sprite(new THREE.SpriteMaterial({
      map: sunTexture, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    }));
    solStar.scale.set(0.42, 0.42, 1);
    solStar.renderOrder = 2;
    solMarker.add(solStar);
    let solLabels = [];

    // The plane of the solar system (Earth's orbit, enlarged), tilted as it
    // really is inside the galaxy: Astronomy Engine's rotation from the
    // ecliptic to the galactic frame puts it at about 60 degrees to the disc.
    const eclipticRing = (() => {
      const pts = [];
      for (let i = 0; i <= 128; i++) {
        const a = (i / 128) * TAU;
        pts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
      }
      const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0xffc98a, transparent: true, opacity: 0, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
      const pole = SKY.eclipticSceneToGalacticScene([0, 1, 0]);
      ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(pole[0], pole[1], pole[2]).normalize());
      ring.scale.setScalar(0.07);
      ring.renderOrder = 2;
      ring.visible = false;
      solMarker.add(ring);
      return ring;
    })();

    function placeSolMarker() {
      const p = MODEL.sunPosition;
      solMarker.position.set(p[0], p[1], p[2]);
    }
    placeSolMarker();

    function makeSolLabels() {
      for (const s of solLabels) { solMarker.remove(s); s.material.map.dispose(); s.material.dispose(); }
      const top = textTexture('Sol', { fill: '#ffd9a8', core: '#ffffff', glow: 'rgba(255, 170, 90, 0.9)' });
      const sub = textTexture('you are here', { fill: '#ffe4ef', core: '#ffffff', glow: 'rgba(255, 92, 138, 0.85)' });
      const label = (t, h, cy) => {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t.tex, transparent: true, depthWrite: false, depthTest: false, opacity: 0 }));
        s.scale.set(h * t.aspect, h, 1);
        s.center.set(0.5, cy);
        s.renderOrder = 3;
        solMarker.add(s);
        return s;
      };
      solLabels = [label(top, 0.17, -0.75), label(sub, 0.1, 1.9)];
    }

    function updateSolMarker() {
      const show = 1;
      solStar.material.opacity = show;
      solStar.scale.setScalar(0.42 * (1 + 0.1 * Math.sin(shared.uPhase.value * 30)));
      solMarker.getWorldPosition(tmpV);
      const d = tmpV.distanceTo(camera.position);
      const o = show * (1 - smoothstep(5, 8, d)) * smoothstep(0.3, 0.6, d);
      for (const s of solLabels) { s.material.opacity = o; s.visible = o > 0.01; }
      const ro = 0.5 * (1 - smoothstep(1.2, 2.2, d)) * smoothstep(0.3, 0.5, d);
      eclipticRing.material.opacity = ro;
      eclipticRing.visible = ro > 0.01;
      return d;
    }

    // =================================================================
    // 8. Shooting stars: they fall around Earth (the solar system), not
    //     in the galaxy.
    // =================================================================
    const METEOR_VERTEX = /* glsl */ `
      attribute float aU;
      attribute float aSide;
      varying float vU;
      varying float vSide;
      void main() {
        vU = aU;
        vSide = aSide;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;
    const METEOR_FRAGMENT = /* glsl */ `
      uniform float uAlpha;
      uniform vec3 uColor;
      varying float vU;
      varying float vSide;
      void main() {
        float a = pow(vU, 2.2) * (1.0 - abs(vSide)) * uAlpha;
        vec3 col = mix(uColor, vec3(1.0), smoothstep(0.75, 1.0, vU));
        gl_FragColor = vec4(col, a);
      }
    `;
    const meteors = [];
    for (let i = 0; i < 3; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
      geo.setAttribute('aU', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 1]), 1));
      geo.setAttribute('aSide', new THREE.BufferAttribute(new Float32Array([-1, 1, -1, 1]), 1));
      geo.setIndex([0, 2, 1, 1, 2, 3]);
      const mat = new THREE.ShaderMaterial({
        uniforms: { uAlpha: { value: 0 }, uColor: { value: new THREE.Color(i % 2 ? '#bcd3ff' : '#ffc2dc') } },
        vertexShader: METEOR_VERTEX,
        fragmentShader: METEOR_FRAGMENT,
        transparent: true,
        depthWrite: false,
        depthTest: true, // Earth hides the ones that pass behind it
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = 1;
      scene.add(mesh);
      meteors.push({ mesh, active: false, t: 0, life: 1, head0: new THREE.Vector3(), headNow: new THREE.Vector3(), tailNow: new THREE.Vector3(), dir: new THREE.Vector3(), speed: 0, len: 0, width: 0 });
    }
    let nextMeteor = 4 + Math.random() * 5;
    const mRight = new THREE.Vector3();
    const mUp = new THREE.Vector3();
    const mFwd = new THREE.Vector3();
    const mHead = new THREE.Vector3();
    const mTail = new THREE.Vector3();
    const mSide = new THREE.Vector3();

    function spawnMeteor() {
      if (world !== 'earth') return false;
      const m = meteors.find((x) => !x.active);
      if (!m) return false;
      camera.updateMatrixWorld();
      mRight.setFromMatrixColumn(camera.matrixWorld, 0);
      mUp.setFromMatrixColumn(camera.matrixWorld, 1);
      mFwd.setFromMatrixColumn(camera.matrixWorld, 2).negate();
      const dist = 16 + Math.random() * 14;
      const halfH = dist * Math.tan((camera.fov * Math.PI) / 360);
      const halfW = halfH * camera.aspect;
      const sx = (Math.random() * 1.4 - 0.7) * halfW;
      const sy = (0.15 + Math.random() * 0.6) * halfH;
      m.head0.copy(camera.position).addScaledVector(mFwd, dist).addScaledVector(mRight, sx).addScaledVector(mUp, sy);
      const ang = ((20 + Math.random() * 30) * Math.PI) / 180;
      const towardsMiddle = sx > 0 ? -1 : 1;
      m.dir.set(0, 0, 0)
        .addScaledVector(mRight, Math.cos(ang) * towardsMiddle)
        .addScaledVector(mUp, -Math.sin(ang))
        .addScaledVector(mFwd, (Math.random() - 0.5) * 0.3)
        .normalize();
      m.speed = dist * (0.9 + Math.random() * 0.5);
      m.len = dist * (0.18 + Math.random() * 0.12);
      m.width = dist * 0.008;
      m.life = 0.9 + Math.random() * 0.6;
      m.t = 0;
      m.active = true;
      m.mesh.visible = true;
      return true;
    }
    function clearMeteors() {
      for (const m of meteors) { m.active = false; m.mesh.visible = false; }
    }

    function updateMeteors(dt) {
      if (settings.extras.shootingStars && !reducedMotion && world === 'earth' && !journey && camera.position.length() < 40) {
        nextMeteor -= dt;
        if (nextMeteor <= 0) { spawnMeteor(); nextMeteor = 5 + Math.random() * 9; }
      }
      for (const m of meteors) {
        if (!m.active) continue;
        m.t += dt;
        const p = m.t / m.life;
        if (p >= 1) { m.active = false; m.mesh.visible = false; continue; }
        mHead.copy(m.head0).addScaledVector(m.dir, m.speed * m.t);
        m.headNow.copy(mHead);
        mTail.copy(mHead).addScaledVector(m.dir, -Math.min(m.len, m.speed * m.t + 0.01));
        m.tailNow.copy(mTail);
        mSide.subVectors(camera.position, mHead).cross(m.dir).normalize().multiplyScalar(m.width);
        const pos = m.mesh.geometry.getAttribute('position');
        const a = pos.array;
        a[0] = mTail.x - mSide.x * 0.15; a[1] = mTail.y - mSide.y * 0.15; a[2] = mTail.z - mSide.z * 0.15;
        a[3] = mTail.x + mSide.x * 0.15; a[4] = mTail.y + mSide.y * 0.15; a[5] = mTail.z + mSide.z * 0.15;
        a[6] = mHead.x - mSide.x; a[7] = mHead.y - mSide.y; a[8] = mHead.z - mSide.z;
        a[9] = mHead.x + mSide.x; a[10] = mHead.y + mSide.y; a[11] = mHead.z + mSide.z;
        pos.needsUpdate = true;
        m.mesh.material.uniforms.uAlpha.value = smoothstep(0, 0.12, p) * (1 - smoothstep(0.6, 1, p));
      }
    }

    // =================================================================
    // 9. Captions: short facts that type themselves out
    // =================================================================
    // When you look at something with a caption (for now, just Luna's name:
    // the label beside it already shows its real phase), the caption types
    // itself out, with an optional smaller line under it. Saving a video
    // draws the same caption into the frame.
    const captionEl = $('#caption');
    const captionTextEl = $('#captionText');
    const caption = { on: false, source: '', sub: '', typed: 0, delay: 0, chars: [], shown: -1, alpha: 0, shownAlpha: -1 };
    const captionSubEl = $('#captionSub');
    const MOON_CAPTION = 'Luna, the Moon';
    // Captions for the tour's stops and for Go to. Every number comes from a
    // cited source (PLAN.md section 6, and SOURCES.md): NASA's Planetary
    // Fact Sheet, NASA's Mercury facts, Reid et al. 2019, the Orion Arm
    // figures, and the worked figures from the fact sheet. Moon counts are
    // dated. Luna's line is worked out live (Astronomy Engine).
    const MOONS_AS_OF = '9 November 2026';
    const STOP_CAPTIONS = {
      galaxy: ['The Milky Way', 'A model built from measured distances to young star-forming regions (Reid et al. 2019). Nobody can see our galaxy from outside.'],
      orion: ['The Orion Arm', 'Our home arm: about 3,500 light-years wide and 20,000 light-years long.'],
      sol: ['Sol, our Sun', 'About 26,600 light-years from the centre. One trip around the galaxy takes about 200 million years.'],
      sun: ['The Sun', 'Its light takes about 8 minutes 19 seconds to reach Earth.'],
      mercury: ['Mercury', 'Up to about 430°C by day, down to about −180°C at night.'],
      venus: ['Venus', 'It spins backwards: one turn takes about 243 Earth days.'],
      earth: ['Earth', 'You are here. It turns once in 23.9 hours, tilted 23.4°, which gives us the seasons.'],
      luna: [MOON_CAPTION, null],
      mars: ['Mars', 'Its gravity is 3.7 m/s², about 38% of Earth’s.'],
      jupiter: ['Jupiter', `142,984 km across, with 115 known moons (as of ${MOONS_AS_OF}).`],
      saturn: ['Saturn', `It has 293 known moons (as of ${MOONS_AS_OF}).`],
      uranus: ['Uranus', 'Tilted 97.8°, it rolls around the Sun on its side, and spins backwards.'],
      neptune: ['Neptune', 'About 4,515 million km from the Sun. One orbit takes about 164 years.'],
      pluto: ['Pluto, a dwarf planet', 'One year on Pluto lasts about 248 Earth years.'],
      system: ['The solar system', 'Squeezed to fit. At true scale, if Earth were 1 pixel wide, Neptune would be about 354,000 pixels from the Sun.'],
      finale: ['You are here', 'One star in one arm of the Milky Way.'],
    };
    function stopCaption(id) {
      const c = STOP_CAPTIONS[id];
      if (!c) return null;
      let sub = c[1];
      if (id === 'system' && earth && SKY.SCALE_MODES[earth.scaleMode].distances === 'true') {
        sub = 'Distances to scale here. If Earth were 1 pixel wide, Neptune would be about 354,000 pixels from the Sun.';
      }
      if (id === 'luna' && earth) {
        const m = earth.moonInfo();
        if (m) sub = `${m.name}, ${m.lit}% lit on this date. Next full moon: ${m.nextFull ? fmtDay(m.nextFull) : 'unknown'}.`;
      }
      return { source: `stop:${id}`, text: c[0], sub: sub || '' };
    }

    function wantedCaption() {
      // On the tour: each stop's caption, once the camera is nearly there.
      if (tourOn && tourPlan.length) {
        const st = tourPlan[tourIndex];
        if (st && STOP_CAPTIONS[st.id] && tourClock > st.dur * Math.min(0.5, st.move * 0.7) && tourClock < st.dur - 0.25) return stopCaption(st.id);
        if (!st || st.id !== 'eclipse') return null;
      }
      // Go to a planet: its caption while you are close.
      if (!tourOn && follow && follow.planet && follow.planet.px > 40 && !(cards && cards.open)) return stopCaption(follow.planet.id);
      if (world !== 'earth' || !earth) return null;
      const ec = earth.eclipse;
      if (ec.active && ec.info && ec.blend > 0.5) {
        return {
          source: 'eclipse',
          text: eclipseName(ec.info),
          sub: `${fmtDay(ec.info.peak)}, seen from ${fmtLatLon(ec.info.lat, ec.info.lon)}, where it is greatest.\nThe Sun and the Moon are drawn about ${Math.round(ec.magnify)} times larger than they look, both by the same amount.`,
        };
      }
      const mf = earth.moonFocus(camera);
      if (caption.source === 'moon' && caption.on ? mf > 0.3 : mf > 0.8) {
        return { source: 'moon', text: MOON_CAPTION };
      }
      return null;
    }

    function updateCaption(dt) {
      const want = wantedCaption();
      if (want && (!caption.on || caption.source !== want.source)) {
        caption.on = true;
        caption.source = want.source;
        caption.typed = 0;
        caption.delay = 0.4;
        caption.chars = graphemes(want.text);
        caption.shown = -1;
        caption.sub = want.sub || '';
        captionEl.setAttribute('aria-label', caption.sub ? `${want.text}. ${caption.sub}` : want.text);
        captionEl.classList.toggle('at-moon', want.source === 'moon' || want.source.startsWith('stop:'));
        captionEl.classList.toggle('at-top', want.source === 'eclipse');
        captionEl.classList.toggle('has-sub', !!caption.sub);
        if (captionSubEl) captionSubEl.textContent = caption.sub;
      } else if (!want && caption.on) {
        caption.on = false;
      }
      caption.alpha += ((caption.on ? 1 : 0) - caption.alpha) * (1 - Math.exp(-dt * (caption.on ? 4 : 3)));
      if (!caption.on && caption.alpha < 0.01) { caption.alpha = 0; caption.typed = 0; }
      if (caption.on) {
        if (caption.delay > 0) caption.delay -= dt;
        else caption.typed = Math.min(caption.chars.length, caption.typed + dt * captionSpeed);
      }
      const n = Math.floor(caption.typed);
      if (n !== caption.shown) {
        caption.shown = n;
        captionTextEl.textContent = caption.chars.slice(0, n).join('');
        captionEl.classList.toggle('done', n > 0 && n >= caption.chars.length);
      }
      if (Math.abs(caption.alpha - caption.shownAlpha) > 0.004) {
        caption.shownAlpha = caption.alpha;
        captionEl.style.opacity = caption.alpha.toFixed(3);
        captionEl.classList.toggle('off', caption.alpha === 0);
      }
    }

    // =================================================================
    // 10. Camera controls: smooth orbit around a target point
    // =================================================================
    // "goal" values are where input wants the camera to be; the real
    // values glide towards them every frame, which is what makes zooming
    // and turning smooth.
    const PHI_MIN = 0.02;
    const PHI_MAX = Math.PI - 0.02;

    // Two worlds share one camera: the galaxy, and Earth (built the first
    // time you visit). Each has its own zoom range; on Earth you can't go
    // inside the planet.
    let world = 'galaxy';
    let earth = null;
    let planets = null; // the other planets and Pluto (planets.js), made with Earth
    let moons = null;   // moons, Saturn's rings and the belts (moons.js)
    // In the solar system the zoom range follows the scale mode (sky.js) and
    // whatever you are looking at: you can't go inside a planet or the Sun.
    const ZE = { start: 8, closest: 2.45, farthest: 1400, closeBegin: 3.6, closeFull: 2.75 };
    const curZ = () => (world === 'earth' ? ZE : Z);
    const systemSize = () => SKY.distanceUnits(50, earth ? earth.scaleMode : 'illustrative');
    const targetLimit = () => (world === 'earth' ? systemSize() * 1.6 : 14);
    // The radius of what the camera follows, in scene units (Earth: 2).
    function focusRadius() {
      if (!earth || !follow || !follow.obj) return earth ? earth.R : 2;
      if (follow.obj === earth.moon) return earth.moon.scale.x * earth.MOON_R;
      if (follow.obj === earth.sol) return earth.sunR;
      if (follow.planet) return follow.planet.R;
      return earth.R;
    }
    function updateEarthZoom() {
      ZE.farthest = systemSize() * 2.8;
      ZE.closest = focusRadius() * 1.22;
    }

    function startRadius() {
      const aspect = camera.aspect;
      const z = curZ();
      return clamp(Math.max(z.start, (world === 'earth' ? 4.6 : 6.2) / aspect), z.closest, z.farthest);
    }

    const EASE = 5.5;        // how quickly the camera catches up with input
    const ZOOM_EASE = 4.5;
    const view = {
      target: new THREE.Vector3(), goalTarget: new THREE.Vector3(),
      radius: startRadius() * 1.6, goalRadius: startRadius(),
      theta: 0.9, goalTheta: 0.6,
      phi: 0.3, goalPhi: 0.5,
      ease: EASE, zoomEase: ZOOM_EASE, easeTimer: 0,
    };

    // Long trips (map clicks, Go to, double-click) glide more slowly, so you
    // can see where you're going instead of jumping.
    function glide(seconds, ease, zoomEase) {
      view.ease = ease || 2.2;
      view.zoomEase = zoomEase || 2.0;
      view.easeTimer = seconds || 4;
    }

    function clampGoals() {
      const z = curZ();
      view.goalPhi = clamp(view.goalPhi, PHI_MIN, PHI_MAX);
      view.goalRadius = clamp(view.goalRadius, z.closest, z.farthest);
      if (view.goalTarget.length() > targetLimit()) view.goalTarget.setLength(targetLimit());
    }

    // Safety net: if any camera value ever becomes invalid, go back to the
    // starting view instead of showing a blank screen.
    const finite = (...vals) => vals.every(Number.isFinite);
    function checkCamera() {
      const ok = finite(view.theta, view.phi, view.radius, view.goalTheta, view.goalPhi, view.goalRadius,
        view.target.x, view.target.y, view.target.z, view.goalTarget.x, view.goalTarget.y, view.goalTarget.z);
      if (ok) return;
      console.warn('Camera reset after an invalid value');
      view.target.set(0, 0, 0);
      view.goalTarget.set(0, 0, 0);
      view.radius = view.goalRadius = startRadius();
      view.theta = view.goalTheta = 0.6;
      view.phi = view.goalPhi = 0.5;
      follow = null;
    }

    function updateCamera(dt) {
      checkCamera();
      if (view.easeTimer > 0) {
        view.easeTimer -= dt;
        if (view.easeTimer <= 0) { view.ease = EASE; view.zoomEase = ZOOM_EASE; }
      }
      const k = 1 - Math.exp(-dt * view.ease);
      const kz = 1 - Math.exp(-dt * view.zoomEase);
      view.theta += (view.goalTheta - view.theta) * k;
      view.phi += (view.goalPhi - view.phi) * k;
      view.radius = Math.exp(lerp(Math.log(view.radius), Math.log(view.goalRadius), kz));
      view.target.lerp(view.goalTarget, k);

      // Keep the angle small however long the galaxy turns.
      if (Math.abs(view.goalTheta) > TAU * 4) {
        const shift = Math.round(view.goalTheta / TAU) * TAU;
        view.goalTheta -= shift;
        view.theta -= shift;
        const stop = tourOn && tourPlan[tourIndex];
        if (stop && stop.from) stop.from.theta -= shift;
      }

      const sinPhi = Math.sin(view.phi);
      camera.position.set(
        view.target.x + view.radius * sinPhi * Math.sin(view.theta),
        view.target.y + view.radius * Math.cos(view.phi),
        view.target.z + view.radius * sinPhi * Math.cos(view.theta)
      );
      camera.lookAt(view.target);
    }

    // 0 when zoomed out, 1 when close up.
    function zoomAmount(r) {
      const z = curZ();
      return smoothstep(z.closeBegin, z.closeFull, r);
    }

    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const forward = new THREE.Vector3();
    const cursorPoint = new THREE.Vector3();
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    const galaxyPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hitPoint = new THREE.Vector3();

    function setRayFromClient(x, y) {
      const rect = canvas.getBoundingClientRect();
      ndc.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
    }

    function rotateBy(dx, dy) {
      const s = (Math.PI / Math.max(200, canvas.clientHeight)) * 1.1;
      view.goalTheta -= dx * s;
      view.goalPhi -= dy * s;
      clampGoals();
    }

    function panBy(dx, dy) {
      const worldPerPx = (2 * view.radius * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(200, canvas.clientHeight);
      camera.updateMatrix();
      right.setFromMatrixColumn(camera.matrix, 0);
      up.setFromMatrixColumn(camera.matrix, 1);
      view.goalTarget.addScaledVector(right, -dx * worldPerPx).addScaledVector(up, dy * worldPerPx);
      clampGoals();
    }

    // factor < 1 zooms in. With a screen position, it zooms towards
    // whatever is under the cursor or between your fingers.
    function zoomBy(factor, clientX, clientY) {
      const before = view.goalRadius;
      view.goalRadius = clamp(before * factor, curZ().closest, curZ().farthest);
      const applied = view.goalRadius / before;
      // (On Earth you always zoom towards the planet itself.)
      if (clientX !== undefined && applied !== 1 && world === 'galaxy') {
        setRayFromClient(clientX, clientY);
        forward.subVectors(view.target, camera.position).normalize();
        const facing = raycaster.ray.direction.dot(forward);
        if (facing > 0.2) {
          cursorPoint.copy(raycaster.ray.direction).multiplyScalar(view.radius / facing).add(camera.position);
          view.goalTarget.addScaledVector(cursorPoint.sub(view.goalTarget), 1 - applied);
        }
      }
      clampGoals();
    }

    // Turns the camera to look straight down at a direction from Earth's centre.
    function faceDirection(dir) {
      const d = dir.clone().normalize();
      view.goalPhi = Math.acos(clamp(d.y, -1, 1));
      let th = Math.atan2(d.x, d.z);
      // take the short way round
      th += Math.round((view.goalTheta - th) / TAU) * TAU;
      view.goalTheta = th;
    }

    const earthSphere = new THREE.Sphere(new THREE.Vector3(), 2);
    function flyTo(clientX, clientY) {
      setRayFromClient(clientX, clientY);
      if (world === 'earth') {
        if (raycaster.ray.intersectSphere(earthSphere, hitPoint)) {
          view.goalTarget.set(0, 0, 0);
          faceDirection(hitPoint);
          view.goalRadius = Math.min(view.goalRadius, 4.2);
          clampGoals();
          glide(3);
        }
        return;
      }
      if (raycaster.ray.intersectPlane(galaxyPlane, hitPoint) && hitPoint.length() < GALAXY_R * 1.3) {
        view.goalTarget.copy(hitPoint);
        view.goalRadius = Math.min(view.goalRadius, Z.closeFull);
        clampGoals();
        glide(3);
      }
    }

    function resetView() {
      view.goalTarget.set(0, 0, 0);
      view.goalRadius = startRadius();
      view.goalPhi = world === 'earth' ? 1.2 : 0.5;
    }

    // ---- input ----
    // Any input takes over from the tour. Zooming keeps following whatever
    // you flew to (Sol, Luna); everything else stops following.
    let lastInput = -Infinity;
    let follow = null; // { obj } to keep the camera on while it moves
    function userInput(kind) {
      lastInput = performance.now();
      if (tourOn) setTour(false);
      if (kind !== 'zoom') follow = null;
      view.ease = EASE;
      view.zoomEase = ZOOM_EASE;
      view.easeTimer = 0;
      hideHint(2500);
    }

    const pointers = new Map();
    let dragMode = 'rotate';
    let pinch = null;
    let lastTap = { time: 0, x: 0, y: 0 };
    let tapStart = null;

    function pinchInfo() {
      const [a, b] = Array.from(pointers.values());
      return { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    }

    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* keeps working without capture */ }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      userInput();
      if (pointers.size === 1) {
        dragMode = (e.button === 2 || e.shiftKey || e.ctrlKey || e.metaKey) ? 'pan' : 'rotate';
        tapStart = { x: e.clientX, y: e.clientY, time: performance.now(), mode: dragMode };
        canvas.classList.add('dragging');
      } else if (pointers.size === 2) {
        pinch = pinchInfo();
        tapStart = null;
      }
    });

    canvas.addEventListener('pointermove', (e) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (pointers.size === 1) {
        if (dragMode === 'pan' && world === 'galaxy') panBy(dx, dy); else rotateBy(dx, dy);
      } else if (pointers.size === 2) {
        const now = pinchInfo();
        if (pinch && now.dist > 10 && pinch.dist > 10) {
          zoomBy(pinch.dist / now.dist, now.mx, now.my);
          if (world === 'galaxy') panBy(now.mx - pinch.mx, now.my - pinch.my);
        }
        pinch = now;
      }
    });

    function endPointer(e) {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 0) canvas.classList.remove('dragging');
      if (pointers.size === 1) dragMode = 'rotate';

      if (e.type === 'pointerup' && tapStart && pointers.size === 0) {
        const now = performance.now();
        const still = Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y) < 8 && now - tapStart.time < 450;
        if (still && tapStart.mode === 'rotate') {
          if (world === 'galaxy' && !journey && solStar.visible && solStar.material.opacity > 0.5) {
            setRayFromClient(e.clientX, e.clientY);
            if (raycaster.intersectObject(solStar, false).length) {
              startJourney('earth', true);
              tapStart = null;
              return;
            }
          }
          // In the solar system, a click or tap on (or near) a body flies there.
          if (world === 'earth' && earth && planets && !journey) {
            const picked = pickBody(e.clientX, e.clientY);
            if (picked) {
              // Already there: just show its card. Otherwise fly to it.
              const here = follow && follow.planet ? follow.planet.id : follow && follow.obj === earth.moon ? 'luna' : follow && follow.obj === earth.sol ? 'sol' : (!follow && view.target.lengthSq() < 1 ? 'earth' : null);
              if (picked === here) showCard({ earth: 'earth', luna: 'moon', sol: 'sun' }[picked] || picked);
              else { userInput(); goToOnEarth(picked); }
              tapStart = null;
              return;
            }
          }
          // Double-tap on touch screens flies to that spot.
          if (e.pointerType !== 'mouse') {
            if (now - lastTap.time < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) {
              flyTo(e.clientX, e.clientY);
              lastTap.time = 0;
            } else {
              lastTap = { time: now, x: e.clientX, y: e.clientY };
            }
          }
        }
        tapStart = null;
      }
    }
    // The body nearest a screen point (within about 26 pixels of its centre
    // or its edge), for picking planets with a click or tap.
    const pickV = new THREE.Vector3();
    function pickBody(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const cands = [['sol', earth.sol, earth.sunR], ['earth', null, earth.R], ['luna', earth.moon, earth.moon.scale.x * earth.MOON_R],
        ...planets.bodies.map((b) => [b.id, b.group, b.R])];
      const pxPerUnit = rect.height / (2 * Math.tan((camera.fov * Math.PI) / 360));
      let best = null;
      let bestD = Infinity;
      for (const [id, obj, R] of cands) {
        if (obj) obj.getWorldPosition(pickV); else pickV.set(0, 0, 0);
        const dist = pickV.distanceTo(camera.position);
        pickV.project(camera);
        if (pickV.z > 1) continue;
        const x = rect.left + ((pickV.x + 1) / 2) * rect.width;
        const y = rect.top + ((1 - pickV.y) / 2) * rect.height;
        const rPx = (R * pxPerUnit) / Math.max(1e-6, dist);
        const d = Math.hypot(x - clientX, y - clientY) - rPx;
        if (d < 26 && d < bestD) { bestD = d; best = id; }
      }
      return best;
    }
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
    canvas.addEventListener('lostpointercapture', endPointer);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('dblclick', (e) => {
      userInput();
      flyTo(e.clientX, e.clientY);
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? window.innerHeight : 1;
      // A two-finger swipe sideways on a touchpad goes around the galaxy.
      if (!e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.2) {
        userInput();
        rotateBy(-clamp(e.deltaX * unit, -120, 120) * 0.9, 0);
        return;
      }
      userInput('zoom');
      const dy = e.deltaY * unit;
      // Trackpad pinch arrives as a wheel event with ctrlKey and small steps.
      const speed = e.ctrlKey ? 0.01 : 0.0015;
      zoomBy(Math.exp(clamp(dy, -240, 240) * speed), e.clientX, e.clientY);
    }, { passive: false });

    // =================================================================
    // 11. Tour (the play button): one smooth flight through everything,
    //     timed to the length set in the editor (Tour). Each stop gets a
    //     share of the time and the two trips between the galaxy and Earth
    //     take a fixed few seconds, so a run lasts exactly as long as you
    //     set. Every camera move eases in and out over its stop.
    // =================================================================
    const JOURNEY_SECONDS = 1.7 + 0.45 + 1.1; // the trip's approach, flash and reveal (see updateJourney)
    let tourOn = CONFIG.startWithTour !== false && !reducedMotion;
    let tourOnce = false;   // play once, then stop (Play for a video)
    let tourPlan = [];      // this run's stops, each with its duration
    let tourIndex = 0;
    let tourClock = 0;      // seconds into the current stop
    let captionSpeed = 13;  // letters per second for typed captions (faster on short tours)
    const tourTo = { target: new THREE.Vector3(), radius: 1, theta: 0, phi: 1 };
    // The eclipse stop moves the clock; it goes back to how it was afterwards.
    let tourClockSnap = null;
    function restoreTourClock() {
      if (earth) earth.stopEclipse();
      if (tourClockSnap) clock.restore(tourClockSnap);
      tourClockSnap = null;
    }
    const smoother = (x) => x * x * x * (x * (x * 6 - 15) + 10);
    const nearAngle = (a, ref) => a + Math.round((ref - a) / TAU) * TAU;

    // The stops, in order. weight = its share of the time; fixed = seconds.
    function buildTourPlan() {
      const ex = settings.extras;
      // Tour, version 1: the galaxy, our arm and Sol; then the Sun, every
      // planet and Pluto, the whole solar system, and back out.
      const stops = [{ id: 'galaxy', weight: 1.2 }, { id: 'orion', weight: 1.1 }];
      if (ex.earthInTour && window.YouAreHereEarth && window.YOU_ARE_HERE_EARTH_LAND) {
        stops.push({ id: 'sol', weight: 0.9 }, { id: 'toEarth', fixed: JOURNEY_SECONDS, earth: true }, { id: 'sun', weight: 1.0, earth: true });
        for (const id of ['mercury', 'venus', 'earth', 'luna', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto']) {
          stops.push({ id, weight: id === 'earth' ? 1.2 : 1.0, earth: true, planet: !['earth', 'luna'].includes(id) });
        }
        stops.push({ id: 'system', weight: 1.4, earth: true }, { id: 'toGalaxy', fixed: JOURNEY_SECONDS, earth: true });
      }
      stops.push({ id: 'finale', weight: 1.0 });
      const fixed = stops.reduce((a, st) => a + (st.fixed || 0), 0);
      const weights = stops.reduce((a, st) => a + (st.weight || 0), 0);
      const unit = Math.max(0.6, (settings.tour.seconds - fixed) / weights);
      for (const st of stops) st.dur = st.fixed || st.weight * unit;
      return stops;
    }

    // Letters per second so a caption is typed out within `seconds`.
    function typingSpeed(text, seconds) {
      return clamp(graphemes(text || '').length / Math.max(0.5, seconds), 13, 80);
    }

    // Starts a stop: the camera move begins from wherever the camera is now.
    function startStop(stop) {
      stop.started = true;
      if (STOP_CAPTIONS[stop.id]) captionSpeed = typingSpeed(STOP_CAPTIONS[stop.id][0], stop.dur * 0.2);
      stop.from = { target: view.target.clone(), radius: view.radius, theta: view.theta, phi: view.phi };
      stop.move = 1;   // share of the stop spent moving; the rest holds, drifting gently
      stop.drift = 0;  // radians per second around, while holding
      stop.pose = null;
      view.ease = EASE;
      view.zoomEase = ZOOM_EASE;
      view.easeTimer = 0;
      follow = null;
      const f = stop.from;
      const to = tourTo;
      switch (stop.id) {
        case 'galaxy':
          stop.pose = () => { to.target.set(0, 0, 0); to.radius = startRadius(); to.theta = f.theta - 0.9; to.phi = 0.78; };
          break;
        case 'centre':
          stop.pose = () => { to.target.set(0, 0, 0); to.radius = 0.72; to.theta = f.theta - 0.5; to.phi = 0.95; };
          stop.move = 0.45;
          stop.drift = -0.06;
          break;
        case 'orion': {
          // Beside the Sun, looking along our arm (as Go to: the Orion Arm).
          const p = MODEL.sunPosition;
          anchor.position.set(p[0] * 0.98, 0, p[2] - 0.35);
          stop.pose = () => { anchor.getWorldPosition(to.target); to.radius = 2.2; to.theta = f.theta - 0.4; to.phi = 0.9; };
          stop.move = 0.7;
          break;
        }
        case 'sun': {
          if (world !== 'earth' || !earth) { stop.dur = 0; break; }
          const st0 = f.theta;
          stop.pose = () => { to.target.copy(earth.sunPos); to.radius = earth.sunR * 5; to.theta = st0 + 0.3; to.phi = 1.25; };
          stop.move = 0.6;
          stop.drift = -0.05;
          break;
        }
        case 'mercury': case 'venus': case 'mars': case 'jupiter': case 'saturn': case 'uranus': case 'neptune': case 'pluto': {
          const b = planets && planets.byId[stop.id];
          if (world !== 'earth' || !b) { stop.dur = 0; break; }
          // Seen from the Sun's side, a little off, so it is mostly lit.
          const tmpL = new THREE.Vector3();
          stop.pose = () => {
            to.target.copy(b.group.position);
            to.radius = b.R * 4.2;
            tmpL.copy(earth.sunPos).sub(b.group.position).normalize();
            to.theta = nearAngle(Math.atan2(tmpL.x, tmpL.z) + 0.75, f.theta);
            to.phi = 1.22;
          };
          stop.move = 0.6;
          stop.drift = -0.05;
          break;
        }
        case 'sol':
          stop.pose = () => { solMarker.getWorldPosition(to.target); to.radius = 1.1; to.theta = f.theta - 0.35; to.phi = 1.05; };
          break;
        case 'toEarth':
        case 'toGalaxy':
          // The trip moves the camera by itself.
          startJourney(stop.id === 'toEarth' ? 'earth' : 'galaxy', false);
          if (!journey && stop.id === 'toEarth') {
            // Earth couldn't be shown: skip its part of the tour.
            for (const st of tourPlan) if (st.earth) st.dur = 0;
          }
          break;
        case 'earth': {
          if (world !== 'earth' || !earth) { stop.dur = 0; break; }
          const sunAngle = Math.atan2(earth.sunDir.x, earth.sunDir.z);
          stop.pose = () => { to.target.set(0, 0, 0); to.radius = startRadius(); to.theta = nearAngle(sunAngle + 1.25, f.theta); to.phi = 1.22; };
          stop.move = 0.6;
          stop.drift = -0.1;
          break;
        }
        case 'luna': {
          if (world !== 'earth' || !earth) { stop.dur = 0; break; }
          captionSpeed = typingSpeed(MOON_CAPTION, stop.dur * 0.25);
          const at = new THREE.Vector3();
          stop.pose = () => {
            earth.moon.getWorldPosition(at);
            to.target.copy(at);
            to.radius = 2.8;
            const d = at.clone().negate().normalize(); // from Luna towards Earth
            to.phi = Math.acos(clamp(d.y, -1, 1));
            to.theta = nearAngle(Math.atan2(d.x, d.z), f.theta);
          };
          stop.move = 0.4;
          break;
        }
        case 'eclipse': {
          if (world !== 'earth' || !earth) { stop.dur = 0; break; }
          if (!tourClockSnap) tourClockSnap = clock.snapshot();
          const res = earth.startEclipse(stop.dur, clock.now());
          if (!res) { stop.dur = 0; break; }
          clock.setDate(earth.timeMs);
          captionSpeed = typingSpeed(eclipseName(res.info), stop.dur * 0.2);
          stop.pose = () => { const v = earth.eclipseView(); to.target.copy(v.target); to.radius = v.radius; to.theta = nearAngle(v.theta, f.theta); to.phi = v.phi; };
          stop.move = 0.12;
          stop.restoreClock = true;
          break;
        }
        case 'system':
          if (world !== 'earth' || !earth) { stop.dur = 0; break; }
          stop.pose = () => { to.target.copy(earth.sunPos); to.radius = SKY.distanceUnits(32, earth.scaleMode) * 1.9; to.theta = f.theta + 0.25; to.phi = 0.8; };
          stop.move = 0.6;
          break;
        case 'finale':
          stop.pose = () => { to.target.set(0, 0, 0); to.radius = startRadius() * 1.04; to.theta = f.theta - 0.7; to.phi = 0.55; };
          break;
        default:
          stop.dur = 0;
      }
    }

    // Each frame: ease the camera from where the stop began to its pose.
    function runStop(stop) {
      if (!stop.pose || journey) return;
      stop.pose();
      const f = stop.from;
      const moveTime = Math.max(0.001, stop.dur * stop.move);
      const k = smoother(clamp(tourClock / moveTime, 0, 1));
      view.goalTarget.lerpVectors(f.target, tourTo.target, k);
      view.goalRadius = Math.exp(lerp(Math.log(f.radius), Math.log(tourTo.radius), k));
      view.goalTheta = lerp(f.theta, tourTo.theta, k) + stop.drift * Math.max(0, tourClock - moveTime);
      view.goalPhi = lerp(f.phi, tourTo.phi, k);
      clampGoals();
    }

    function updateTour(dt) {
      if (!tourPlan.length) return;
      let stop = tourPlan[tourIndex];
      if (!stop.started) startStop(stop);
      tourClock += dt;
      while (tourClock >= stop.dur) {
        tourClock -= stop.dur;
        if (stop.restoreClock) restoreTourClock();
        tourIndex++;
        if (tourIndex >= tourPlan.length) {
          if (tourOnce || !settings.tour.repeat) { finishTour(); return; }
          tourPlan = buildTourPlan();
          tourIndex = 0;
        }
        stop = tourPlan[tourIndex];
        startStop(stop);
      }
      runStop(stop);
    }

    // Seconds into this run, and the run's total (for the editor and tests).
    function tourProgress() {
      let elapsed = tourClock;
      for (let i = 0; i < tourIndex && i < tourPlan.length; i++) elapsed += tourPlan[i].dur;
      return { elapsed, total: tourPlan.reduce((a, st) => a + st.dur, 0) };
    }

    // =================================================================
    // 12. Interface
    // =================================================================
    const hintEl = $('#hint');
    const toastEl = $('#toast');
    const toastText = $('#toastText');
    const toastAction = $('#toastAction');
    const tourBtn = $('#tourBtn');
    const editBtn = $('#editBtn');
    const helpBtn = $('#helpBtn');
    const helpEl = $('#help');
    const editorEl = $('#editor');
    const statusEl = $('#saveStatus');

    let toastTimer = 0;
    function hideToast() {
      toastEl.classList.remove('show', 'has-action');
    }
    // An optional action shows a button, like Undo.
    function toast(message, action) {
      if (document.body.classList.contains('recording')) return; // keep the video clean
      toastText.textContent = message;
      toastAction.hidden = !action;
      toastEl.classList.toggle('has-action', !!action);
      if (action) {
        toastAction.textContent = action.label;
        toastAction.onclick = () => { hideToast(); action.run(); };
      }
      toastEl.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(hideToast, action ? 6500 : 2800);
    }

    function setStatus(message) { statusEl.textContent = message; }

    // ---- hint ----
    let hintTimer = 0;
    function setHintText() {
      if (world === 'earth') {
        hintEl.textContent = coarsePointer
          ? 'Drag to turn Earth. Tap the map to face any place. Pinch to zoom.'
          : 'Drag to turn Earth. Click the map to face any place. Press L for the next solar eclipse.';
        return;
      }
      if (coarsePointer) {
        hintEl.textContent = 'Tap the map to fly somewhere. Drag to look around. Pinch to zoom.';
      } else {
        hintEl.textContent = settings.extras.navControls
          ? 'Click the map to fly anywhere. Hold the arrow pads (or W A S D) to move. Scroll to zoom.'
          : 'Drag to look around. Scroll to zoom. Double-click a spot to fly there.';
      }
    }
    function hideHint(delay) {
      clearTimeout(hintTimer);
      hintTimer = setTimeout(() => hintEl.classList.add('gone'), delay);
    }
    setHintText();
    hideHint(14000);

    // ---- tour ----
    const fadeEl = $('#fade');
    const countdownEl = $('#countdown');
    let fadeTimer = 0;
    // A fade in from black (the start of the tour).
    function fadeIn(seconds) {
      clearTimeout(fadeTimer);
      fadeEl.style.transition = 'none';
      fadeEl.style.opacity = '1';
      fadeEl.classList.add('on');
      void fadeEl.offsetWidth; // apply before the transition starts
      fadeEl.style.transition = `opacity ${seconds}s ease`;
      fadeEl.style.opacity = '0';
      fadeTimer = setTimeout(() => fadeEl.classList.remove('on'), seconds * 1000 + 60);
    }

    // Puts everything back at the very start: the whole galaxy, from above.
    function tourBegin(fade) {
      if (journey) {
        journey = null;
        warpEl.style.opacity = '0';
        warpEl.classList.remove('on');
      }
      if (world !== 'galaxy') switchWorld('galaxy');
      follow = null;
      caption.on = false;
      caption.alpha = 0;
      view.target.set(0, 0, 0);
      view.goalTarget.set(0, 0, 0);
      view.radius = view.goalRadius = startRadius() * 1.3;
      view.phi = view.goalPhi = 0.32;
      view.goalTheta = view.theta;
      tourPlan = buildTourPlan();
      tourIndex = 0;
      tourClock = 0;
      startStop(tourPlan[0]);
      if (fade) fadeIn(0.9);
    }

    // Keep the screen awake while the tour plays or a video records (phones
    // dim and lock otherwise). Browsers drop the lock when the page is
    // hidden, so it's asked for again when the page comes back.
    let wakeLock = null;
    let wakeWanted = false;
    async function keepAwake(on) {
      wakeWanted = !!on;
      try {
        if (on && !wakeLock && navigator.wakeLock && document.visibilityState === 'visible') {
          const lock = await navigator.wakeLock.request('screen');
          if (!wakeWanted) { lock.release(); return; }
          wakeLock = lock;
          lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; });
        } else if (!on && wakeLock) {
          const lock = wakeLock;
          wakeLock = null;
          await lock.release();
        }
      } catch (err) {
        wakeLock = null; // not supported, or not allowed right now
      }
    }
    document.addEventListener('visibilitychange', () => {
      if (wakeWanted && document.visibilityState === 'visible') keepAwake(true);
    });

    // Play always starts from the beginning. { once } plays one run and stops.
    function setTour(on, opts = {}) {
      tourOn = on;
      tourBtn.setAttribute('aria-pressed', String(on));
      tourBtn.setAttribute('aria-label', on ? 'Stop tour' : 'Play the tour');
      keepAwake(on || !!capture);
      if (on) {
        if (cards) { cards.hide(); cards.closeCompare(); }
        tourOnce = !!opts.once;
        tourBegin(opts.fade !== false);
      } else {
        tourOnce = false;
        tourPlan = [];
        captionSpeed = 13;
        if (tourClockSnap) restoreTourClock();
        if (recording && recording.playing) endRecording(!opts.finished);
        if (capture && !capture.ending) {
          if (opts.finished) capture.ending = performance.now(); // fade out, then save
          else cancelVideo();
        }
      }
    }
    function finishTour() {
      setTour(false, { finished: true });
    }
    function tourToast() {
      toast(tourOn ? `Playing the tour from the start (${formatDuration(settings.tour.seconds)})` : 'Tour stopped');
    }
    tourBtn.addEventListener('click', () => {
      setTour(!tourOn);
      tourToast();
    });

    // ---- Play for a video ----
    // Full screen, no controls or pointer, a 3-2-1 countdown on black, then
    // the tour plays once from the start. Start your screen recording before
    // the countdown ends; trim the countdown afterwards.
    let recording = null;
    function playForVideo() {
      if (recording) return;
      closeEditor();
      closeHelp();
      closeGoMenu();
      hideToast();
      if (tourOn) setTour(false);
      toggleUI(true, true);
      hideHint(0);
      document.body.classList.add('recording');
      const root = document.documentElement;
      if (!document.fullscreenElement && root.requestFullscreen) root.requestFullscreen().catch(() => {});
      clearTimeout(fadeTimer);
      fadeEl.style.transition = 'none';
      fadeEl.style.opacity = '1';
      fadeEl.classList.add('on');
      recording = { playing: false, timers: [] };
      [3, 2, 1].forEach((n, i) => recording.timers.push(setTimeout(() => { countdownEl.textContent = String(n); }, i * 1000)));
      recording.timers.push(setTimeout(() => {
        countdownEl.textContent = '';
        recording.playing = true;
        setTour(true, { once: true, fade: true });
      }, 3000));
    }
    // Stopped early (a click or key): the controls come back. Finished: they
    // stay hidden so the video ends cleanly; the pointer returns when you move it.
    function endRecording(stoppedEarly) {
      if (!recording) return;
      const counting = !recording.playing;
      recording.timers.forEach(clearTimeout);
      recording = null;
      countdownEl.textContent = '';
      if (counting) {
        fadeEl.classList.remove('on');
        fadeEl.style.opacity = '0';
      }
      if (stoppedEarly) {
        document.body.classList.remove('recording');
        toggleUI(false, true);
      } else {
        window.addEventListener('pointermove', () => document.body.classList.remove('recording'), { once: true });
      }
    }
    // A click or Escape during the countdown cancels it. Other keys are
    // ignored, so a screen recorder's shortcut (like Win + Alt + R) is safe.
    const cancelCountdown = (e) => {
      if (!recording || recording.playing) return;
      if (e.type === 'keydown' && e.key !== 'Escape') {
        e.stopPropagation(); // other keys do nothing until it starts
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      endRecording(true);
      toast('Video play cancelled');
    };
    window.addEventListener('keydown', cancelCountdown, true);
    window.addEventListener('pointerdown', cancelCountdown, true);

    function formatDuration(sec) {
      const m = Math.floor(sec / 60);
      const r = Math.round(sec % 60);
      if (!m) return `${r} seconds`;
      return r ? `${m} min ${r} s` : `${m} min`;
    }

    // ---- zoom rail ----
    const rail = $('#zoomTrack');
    function radiusToRail(r) {
      const far = Math.log(curZ().farthest);
      const near = Math.log(curZ().closest);
      return clamp((far - Math.log(r)) / (far - near), 0, 1);
    }
    function railToRadius(v) {
      const far = Math.log(curZ().farthest);
      const near = Math.log(curZ().closest);
      return Math.exp(far - v * (far - near));
    }
    let railShown = -1;
    function updateRail() {
      const v = radiusToRail(view.radius);
      if (Math.abs(v - railShown) > 0.002) {
        railShown = v;
        rail.style.setProperty('--v', v.toFixed(4));
        rail.setAttribute('aria-valuenow', String(Math.round(v * 100)));
      }
    }

    function railFromPointer(e) {
      const rect = rail.getBoundingClientRect();
      const v = clamp(1 - (e.clientY - rect.top) / rect.height, 0, 1);
      view.goalRadius = railToRadius(v);
      clampGoals();
    }
    let railPointer = null;
    rail.addEventListener('pointerdown', (e) => {
      railPointer = e.pointerId;
      try { rail.setPointerCapture(e.pointerId); } catch (err) { /* keeps working without capture */ }
      userInput('zoom');
      railFromPointer(e);
    });
    rail.addEventListener('pointermove', (e) => {
      if (e.pointerId === railPointer) railFromPointer(e);
    });
    const releaseRail = (e) => { if (e.pointerId === railPointer) railPointer = null; };
    rail.addEventListener('pointerup', releaseRail);
    rail.addEventListener('pointercancel', releaseRail);
    rail.addEventListener('lostpointercapture', releaseRail);
    rail.addEventListener('keydown', (e) => {
      const steps = { ArrowUp: 0.85, ArrowRight: 0.85, ArrowDown: 1 / 0.85, ArrowLeft: 1 / 0.85, PageUp: 0.5, PageDown: 2 };
      if (steps[e.key]) { zoomBy(steps[e.key]); }
      else if (e.key === 'Home') { view.goalRadius = curZ().closest; }
      else if (e.key === 'End') { view.goalRadius = curZ().farthest; }
      else return;
      e.preventDefault();
      e.stopPropagation();
      userInput('zoom');
    });
    $('#zoomIn').addEventListener('click', () => { userInput('zoom'); zoomBy(0.7); });
    $('#zoomOut').addEventListener('click', () => { userInput('zoom'); zoomBy(1 / 0.7); });

    // ---- time (the simulated clock) ----
    // The date is always on screen. Live = real time; otherwise the clock is
    // simulated: « and » step through the speeds (and backwards), the middle
    // button pauses, and Now goes back to live time.
    const timeDateEl = $('#timeDate');
    const timeRateEl = $('#timeRate');
    const timePlayBtn = $('#timePlay');
    const timeNowBtn = $('#timeNow');
    const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
    const dayFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    function fmtDate(ms) { try { return dateFmt.format(new Date(ms)); } catch (err) { return new Date(ms).toUTCString(); } }
    function fmtDay(ms) { return dayFmt.format(new Date(ms)); }
    let timebarShown = '';
    let timebarAt = 0;
    // Honest scale, always on screen: what is and isn't to scale here, and
    // how wide the view is when distances are to scale.
    const scaleNoteEl = $('#scaleNote');
    const LY_PER_KPC = 3261.56;
    function roundNice(v) {
      if (v >= 100) return Math.round(v / 10 ** (Math.floor(Math.log10(v)) - 1)) * 10 ** (Math.floor(Math.log10(v)) - 1);
      return v >= 10 ? Math.round(v) : +v.toPrecision(2);
    }
    function scaleNoteText() {
      const across = 2 * view.radius * Math.tan((camera.fov * Math.PI) / 360) * camera.aspect; // scene units at the target
      if (world !== 'earth' || !earth) {
        const ly = (across / MODEL.S) * LY_PER_KPC;
        return `Galaxy model, distances to scale: this view is about ${roundNice(ly).toLocaleString()} light-years across. Its spin is sped up.`;
      }
      const m = SKY.SCALE_MODES[earth.scaleMode];
      if (m.distances !== 'true') return `${m.badge}.`;
      const au = across / m.au;
      const what = au >= 0.1 ? `${roundNice(au).toLocaleString()} AU` : `${roundNice(au * SKY.AU_KM).toLocaleString()} km`;
      return `${m.badge}: this view is about ${what} across.`;
    }
    function updateTimebar() {
      const now = performance.now();
      if (now - timebarAt < 200) return;
      timebarAt = now;
      const note = scaleNoteText();
      if (scaleNoteEl.textContent !== note) scaleNoteEl.textContent = note;
      const ms = clock.now();
      const eclipsing = earth && earth.eclipse.active;
      const rate = clock.live ? 'Live' : eclipsing ? 'Playing the eclipse' : clock.paused ? 'Paused' : SKY.rateName(clock.rate);
      const key = `${fmtDate(ms)}|${rate}`;
      if (key === timebarShown) return;
      timebarShown = key;
      timeDateEl.textContent = fmtDate(ms);
      timeDateEl.title = new Date(ms).toUTCString();
      timeRateEl.textContent = rate.charAt(0).toUpperCase() + rate.slice(1);
      document.body.classList.toggle('time-live', clock.live);
      const paused = clock.paused;
      timePlayBtn.setAttribute('aria-pressed', String(paused));
      timePlayBtn.setAttribute('aria-label', paused ? 'Let time run' : 'Pause time');
      timeNowBtn.disabled = clock.live;
    }
    function timeChanged() {
      if (earth && earth.eclipse.active) { earth.stopEclipse(); if (follow && follow.eclipse) follow = null; }
      timebarAt = 0;
      updateTimebar();
    }
    function timeStep(dir) {
      if (earth && earth.eclipse.active) timeChanged();
      const r = clock.stepRate(dir);
      timeChanged();
      toast(`Time: ${SKY.rateName(r)}`);
    }
    function timePause() {
      if (earth && earth.eclipse.active) timeChanged();
      clock.setPaused(!clock.paused);
      timeChanged();
      toast(clock.paused ? 'Time paused' : `Time: ${SKY.rateName(clock.rate)}`);
    }
    function timeNow() {
      clock.setLive();
      timeChanged();
      toast('Back to now (live)');
    }
    $('#timeSlower').addEventListener('click', () => timeStep(-1));
    $('#timeFaster').addEventListener('click', () => timeStep(1));
    timePlayBtn.addEventListener('click', timePause);
    timeNowBtn.addEventListener('click', timeNow);

    // ---- info cards and the compare panels (cards.js, facts.js) ----
    // A body's average colour, from its map (for the size line-up).
    function colorOf(id) {
      const M = window.YOU_ARE_HERE_PLANET_MAPS;
      if (id === 'earth') return '#5a8cff';
      if (!M || !M[id]) return '#cccccc';
      const pal = Uint8Array.from(atob(M[id].palette), (c) => c.charCodeAt(0));
      const idx = Uint8Array.from(atob(M[id].data), (c) => c.charCodeAt(0));
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < idx.length; i++) { r += pal[idx[i] * 3]; g += pal[idx[i] * 3 + 1]; b += pal[idx[i] * 3 + 2]; }
      const n = idx.length;
      const tint = id === 'pluto' ? [1, 0.86, 0.72] : [1, 1, 1];
      return `rgb(${Math.round((r / n) * tint[0])}, ${Math.round((g / n) * tint[1])}, ${Math.round((b / n) * tint[2])})`;
    }
    // Rungs beyond the solar system for the light-time ladder (SOURCES.md):
    // the galactic centre at 8.15 kpc (Reid et al. 2019) and the Orion
    // Nebula at 388 pc (Kounkel et al. 2017); 1 pc = 3.2616 light-years.
    const YEAR_S = 365.25 * 86400;
    function ladderExtras() {
      return [
        { name: 'Orion Nebula', sec: 388 * 3.2616 * YEAR_S, label: 'about 1,270 years' },
        { name: 'Galactic centre', sec: 8150 * 3.2616 * YEAR_S, label: 'about 26,600 years' },
      ];
    }
    const cards = window.YouAreHereCards
      ? window.YouAreHereCards.create({ SKY, $, clock, fmtDay, colorOf, ladderExtras })
      : null;
    function showCard(key, arm) {
      if (!cards) return;
      if (!settings.extras.cards || tourOn) { cards.hide(); return; }
      cards.show(key, arm);
    }

    // ---- scale (solar system): illustrative, true sizes, true distances, both ----
    const scaleSelect = $('#scaleSelect');
    function setScaleMode(mode, quiet) {
      if (!earth || !SKY.SCALE_MODES[mode]) return;
      const before = focusRadius();
      const rel = view.goalRadius / before;
      earth.setScale(mode);
      if (planets) planets.setScale(mode);
      if (moons) moons.setScale(mode);
      updateEarthZoom();
      if (follow && follow.obj) { follow.obj.getWorldPosition(view.target); view.goalTarget.copy(view.target); }
      else if (view.target.lengthSq() > 1) { view.target.copy(earth.sunPos); view.goalTarget.copy(earth.sunPos); }
      const after = focusRadius();
      view.radius = view.goalRadius = clamp(rel * after, ZE.closest, ZE.farthest);
      clampGoals();
      scaleSelect.value = mode;
      if (!quiet) toast(`Scale: ${SKY.SCALE_MODES[mode].badge}`);
    }
    scaleSelect.addEventListener('change', () => setScaleMode(scaleSelect.value));

    // ---- picture ----
    function download(blob, filename, keepMs = 2000) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // a big video needs its link to stay alive while the download starts
      setTimeout(() => URL.revokeObjectURL(url), keepMs);
    }
    function savePicture() {
      renderer.render(activeScene(), camera); // capture straight after drawing
      canvas.toBlob((blob) => {
        if (!blob) { toast("Couldn't capture the picture."); return; }
        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
        download(blob, `you-are-here-${stamp}.png`);
        toast('Picture saved');
      }, 'image/png');
    }
    $('#pictureBtn').addEventListener('click', savePicture);

    // ---- full screen ----
    const fullBtn = $('#fullBtn');
    const root = document.documentElement;
    const canFullscreen = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
    if (!canFullscreen) fullBtn.hidden = true;
    function toggleFullscreen() {
      if (!canFullscreen) return;
      const isFull = document.fullscreenElement || document.webkitFullscreenElement;
      const result = isFull
        ? (document.exitFullscreen || document.webkitExitFullscreen).call(document)
        : (root.requestFullscreen || root.webkitRequestFullscreen).call(root);
      if (result && result.catch) result.catch(() => toast("Full screen isn't available here."));
    }
    fullBtn.addEventListener('click', toggleFullscreen);

    // ---- hide / show controls ----
    const showUiBtn = $('#showUi');
    function toggleUI(force, quiet) {
      const off = force !== undefined ? force : !document.body.classList.contains('ui-off');
      document.body.classList.toggle('ui-off', off);
      showUiBtn.hidden = !off;
      if (!off) document.body.classList.remove('recording');
      if (off) {
        closeEditor();
        closeHelp();
        closeAbout();
        if (!quiet) toast(coarsePointer ? 'Tap the faint eye to bring the controls back' : 'Press H to bring the controls back');
      }
    }
    $('#hideBtn').addEventListener('click', () => toggleUI(true));
    showUiBtn.addEventListener('click', () => toggleUI(false));

    // ---- help ----
    function openHelp() { if (cards) cards.closeCompare(); helpEl.hidden = false; helpBtn.setAttribute('aria-expanded', 'true'); }
    function closeHelp() { helpEl.hidden = true; helpBtn.setAttribute('aria-expanded', 'false'); }
    helpBtn.addEventListener('click', (e) => { e.stopPropagation(); if (helpEl.hidden) openHelp(); else closeHelp(); });
    document.addEventListener('pointerdown', (e) => {
      if (!helpEl.hidden && !helpEl.contains(e.target) && !helpBtn.contains(e.target)) closeHelp();
    });

    // ---- about ----
    const aboutEl = $('#about');
    const aboutBtn = $('#aboutBtn');
    function openAbout() { closeHelp(); if (cards) cards.closeCompare(); aboutEl.hidden = false; aboutBtn.setAttribute('aria-expanded', 'true'); $('#xCalm').checked = reducedMotion; }
    function closeAbout() { aboutEl.hidden = true; aboutBtn.setAttribute('aria-expanded', 'false'); }
    aboutBtn.addEventListener('click', (e) => { e.stopPropagation(); if (aboutEl.hidden) openAbout(); else closeAbout(); });
    document.addEventListener('pointerdown', (e) => {
      if (!aboutEl.hidden && !aboutEl.contains(e.target) && !aboutBtn.contains(e.target)) closeAbout();
    });
    function setReducedMotion(on, quiet) {
      reducedMotion = !!on;
      try { localStorage.setItem(MOTION_KEY, on ? 'reduce' : 'full'); } catch (e) { /* storage blocked */ }
      $('#xCalm').checked = reducedMotion;
      if (reducedMotion) { clearMeteors(); spinning = false; if (tourOn) setTour(false); }
      else spinning = true;
      if (!quiet) toast(reducedMotion ? 'Motion reduced: no automatic tour, drifting, spin or shooting stars' : 'Full motion');
    }
    $('#xCalm').addEventListener('change', (e) => setReducedMotion(e.target.checked));

    // ---- editor ----
    function openEditor() {
      closeHelp();
      if (cards) cards.closeCompare();
      editorEl.classList.add('open');
      editorEl.removeAttribute('inert');
      editorEl.setAttribute('aria-hidden', 'false');
      editBtn.setAttribute('aria-expanded', 'true');
      renderEditor();
      setTimeout(() => $('#editorClose').focus(), 50);
    }
    function closeEditor() {
      if (!editorEl.classList.contains('open')) return;
      editorEl.classList.remove('open');
      editorEl.setAttribute('inert', '');
      editorEl.setAttribute('aria-hidden', 'true');
      editBtn.setAttribute('aria-expanded', 'false');
      editBtn.focus({ preventScroll: true });
    }
    function editorOpen() { return editorEl.classList.contains('open'); }
    editBtn.addEventListener('click', () => (editorOpen() ? closeEditor() : openEditor()));
    $('#editorClose').addEventListener('click', closeEditor);

    const THEMES = [
      { label: 'Original', inside: '#ff6030', outside: '#1b3984' },
      { label: 'Pink and purple', inside: '#ff5fa2', outside: '#7a2cff' },
      { label: 'Pink and blue', inside: '#ff6fae', outside: '#2a5cff' },
      { label: 'White and blue', inside: '#e6ecff', outside: '#1f4fd8' },
    ];

    function renderLook() {
      const g = settings.galaxy;
      $('#gInside').value = g.insideColor;
      $('#gOutside').value = g.outsideColor;
      $('#gSpeed').value = g.spinSpeed;
      const sel = $('#gCount');
      if (![...sel.options].some((o) => +o.value === g.count)) {
        const o = document.createElement('option');
        o.value = g.count;
        o.textContent = g.count.toLocaleString();
        sel.appendChild(o);
      }
      sel.value = String(g.count);
      for (const b of document.querySelectorAll('#themeList .theme')) {
        const on = b.dataset.inside === g.insideColor && b.dataset.outside === g.outsideColor;
        b.setAttribute('aria-pressed', String(on));
      }
      $('#xWaves').checked = settings.extras.waves;
      $('#xShooting').checked = settings.extras.shootingStars;
      $('#xEarthTour').checked = settings.extras.earthInTour;
      $('#xNav').checked = settings.extras.navControls;
      $('#xLabels').checked = settings.extras.labels;
      $('#xOrbits').checked = settings.extras.orbits;
      $('#xCards').checked = settings.extras.cards;
      $('#xBelts').checked = settings.extras.belts;
    }

    function renderEditor() {
      renderLook();
      renderTourSettings();
    }

    // Galaxy look
    const themeList = $('#themeList');
    for (const t of THEMES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'theme';
      b.dataset.inside = t.inside;
      b.dataset.outside = t.outside;
      b.setAttribute('aria-pressed', 'false');
      const sw = document.createElement('span');
      sw.className = 'swatch';
      sw.style.background = `linear-gradient(90deg, ${t.inside}, ${t.outside})`;
      sw.setAttribute('aria-hidden', 'true');
      b.append(sw, document.createTextNode(t.label));
      b.addEventListener('click', () => {
        settings.galaxy.insideColor = t.inside;
        settings.galaxy.outsideColor = t.outside;
        saveSettings();
        recolorGalaxy();
        renderLook();
      });
      themeList.appendChild(b);
    }

    let galaxyTimer = 0;
    function galaxyChanged(how) {
      settings.galaxy = sanitizeGalaxy(settings.galaxy);
      saveSettings();
      if (how === 'colour') { recolorGalaxy(); renderLook(); return; }
      if (how !== 'rebuild') return;
      clearTimeout(galaxyTimer);
      galaxyTimer = setTimeout(() => { buildGalaxy(); placeSolMarker(); }, 220);
    }
    const bindLook = (id, key, parse, how) => {
      $(id).addEventListener('input', (e) => {
        settings.galaxy[key] = parse(e.target.value);
        galaxyChanged(how);
      });
    };
    bindLook('#gInside', 'insideColor', String, 'colour');
    bindLook('#gOutside', 'outsideColor', String, 'colour');
    bindLook('#gSpeed', 'spinSpeed', Number, 'none');
    $('#gCount').addEventListener('change', (e) => {
      settings.galaxy.count = Number(e.target.value);
      galaxyChanged('rebuild');
    });

    function setExtra(key, value) {
      settings.extras[key] = value;
      saveSettings();
      if (key === 'earthInTour') renderTourSettings();
      if (key === 'navControls') applyNavVisibility();
      if (key === 'cards' && !value && cards) cards.hide();
      renderLook();
    }
    const bindExtra = (id, key) => $(id).addEventListener('change', (e) => setExtra(key, e.target.checked));
    bindExtra('#xWaves', 'waves');
    bindExtra('#xShooting', 'shootingStars');
    bindExtra('#xEarthTour', 'earthInTour');
    bindExtra('#xNav', 'navControls');
    bindExtra('#xLabels', 'labels');
    bindExtra('#xOrbits', 'orbits');
    bindExtra('#xCards', 'cards');
    bindExtra('#xBelts', 'belts');

    // Tour: how long it takes, whether it repeats, and the play buttons.
    const tourSecondsEl = $('#tourSeconds');
    function renderTourSettings() {
      const t = settings.tour;
      if (document.activeElement !== tourSecondsEl) tourSecondsEl.value = String(t.seconds);
      $('#tourRepeat').checked = t.repeat;
      for (const b of document.querySelectorAll('#tourPresets [data-seconds]')) {
        b.setAttribute('aria-pressed', String(+b.dataset.seconds === t.seconds));
      }
      const plan = buildTourPlan();
      const stops = plan.filter((st) => !st.fixed);
      const each = stops.reduce((a, st) => a + st.dur, 0) / Math.max(1, stops.length);
      const trips = plan.some((st) => st.fixed) ? `, plus ${JOURNEY_SECONDS.toFixed(1)} seconds for each trip to Earth and back` : '';
      $('#tourSummary').textContent = `${formatDuration(t.seconds)} in total: ${stops.length} stops of about ${each < 10 ? each.toFixed(1) : Math.round(each)} seconds each${trips}.`;
    }
    function setTourSetting(key, value) {
      settings.tour = sanitizeTour(Object.assign({}, settings.tour, { [key]: value }));
      saveSettings();
      renderTourSettings();
    }
    tourSecondsEl.addEventListener('change', () => {
      const v = Math.round(Number(tourSecondsEl.value));
      setTourSetting('seconds', Number.isFinite(v) ? v : settings.tour.seconds);
      tourSecondsEl.value = String(settings.tour.seconds);
      if (v !== settings.tour.seconds && Number.isFinite(v)) setStatus(`The tour can be ${TOUR_MIN_SECONDS} seconds to ${TOUR_MAX_SECONDS / 60} minutes long.`);
    });
    tourSecondsEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') tourSecondsEl.blur(); });
    for (const b of document.querySelectorAll('#tourPresets [data-seconds]')) {
      b.addEventListener('click', () => {
        setTourSetting('seconds', +b.dataset.seconds);
        tourSecondsEl.value = String(settings.tour.seconds);
      });
    }
    $('#tourRepeat').addEventListener('change', (e) => setTourSetting('repeat', e.target.checked));
    $('#tourPlayBtn').addEventListener('click', () => {
      closeEditor();
      setTour(true);
      tourToast();
    });
    $('#tourVideoBtn').addEventListener('click', () => playForVideo());

    // ---- editor: backup ----
    // A backup file holds the settings (the look, the extras and the tour).
    $('#exportBtn').addEventListener('click', () => {
      const data = { app: 'you-are-here', version: 1 };
      for (const f of FIELDS) data[f] = settings[f];
      download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'you-are-here-backup.json');
      setStatus('Backup saved to your downloads.');
    });
    const importFile = $('#importFile');
    $('#importBtn').addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', async () => {
      const file = importFile.files && importFile.files[0];
      importFile.value = '';
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (!data || data.app !== 'you-are-here') throw new Error('not a backup from this app');
        for (const f of FIELDS) if (f in data) settings[f] = sanitizeField(f, data[f], settings[f]);
        saveSettings();
        buildGalaxy();
        placeSolMarker();
        applyNavVisibility();
        renderEditor();
        toast('Backup loaded');
      } catch (err) {
        toast("That file isn't a You Are Here backup. Choose a file made with Save backup.");
      }
    });

    // Reset needs a second click within a few seconds.
    const resetBtn = $('#resetBtn');
    let resetTimer = 0;
    resetBtn.addEventListener('click', () => {
      if (!resetBtn.classList.contains('armed')) {
        resetBtn.classList.add('armed');
        resetBtn.textContent = 'Click again to reset';
        resetTimer = setTimeout(() => { resetBtn.classList.remove('armed'); resetBtn.textContent = 'Reset to defaults'; }, 3500);
        return;
      }
      clearTimeout(resetTimer);
      resetBtn.classList.remove('armed');
      resetBtn.textContent = 'Reset to defaults';
      settings = configDefaults();
      try { localStorage.removeItem(STORE_KEY); } catch (e) { /* storage blocked: nothing to remove */ }
      buildGalaxy();
      placeSolMarker();
      applyNavVisibility();
      renderEditor();
      setStatus('Back to the defaults in config.js.');
      toast('Reset to the settings in config.js');
    });

    // ---- keyboard ----
    // W A S D fly, arrow keys go around; both work while held down.
    const NAV_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (cards && cards.compareOpen) { cards.closeCompare(); return; }
        if (!goMenu.hidden) closeGoMenu(true);
        else if (!aboutEl.hidden) closeAbout();
        else if (!helpEl.hidden) closeHelp();
        else if (editorOpen()) closeEditor();
        else if (cards && cards.open) cards.hide();
        return;
      }
      const t = e.target;
      if (t && t.closest && t.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (NAV_KEYS.has(e.code)) {
        const inPanel = t && t.closest && t.closest('#editor, #goMenu, #help, [role="slider"]');
        if (inPanel && e.code.startsWith('Arrow')) return;
        e.preventDefault();
        if (!heldKeys.has(e.code)) { heldKeys.set(e.code, performance.now()); userInput(); }
        nav.fast = e.shiftKey;
        updateNav();
        return;
      }
      if (e.repeat && /^[cehfnpotrgvjlkybimx0-9 \[\]]$/i.test(e.key)) return;
      const onButton = t && t.closest && t.closest('button, [role="slider"], summary');
      if (onButton && (e.key === ' ' || e.key === 'Enter')) return;

      let handled = true;
      switch (e.key) {
        case '+': case '=': zoomBy(0.75); userInput('zoom'); break;
        case '-': case '_': zoomBy(1 / 0.75); userInput('zoom'); break;
        case 'r': case 'R': userInput(); resetView(); glide(3); break;
        case 'c': case 'C': setTour(!tourOn); tourToast(); break;
        case 'v': case 'V': playForVideo(); break;
        case 'g': case 'G': if (goMenu.hidden) openGoMenu(); else closeGoMenu(true); break;
        case 'n': case 'N':
          setExtra('labels', !settings.extras.labels);
          toast(settings.extras.labels ? 'Names on' : 'Names off');
          break;
        case 'x': case 'X': {
          if (world !== 'earth' || !earth) { toast('The scale switch works in the solar system. Press J to go there.'); break; }
          const ids = Object.keys(SKY.SCALE_MODES);
          setScaleMode(ids[(ids.indexOf(earth.scaleMode) + 1) % ids.length]);
          break;
        }
        case 'b': case 'B':
          setExtra('orbits', !settings.extras.orbits);
          toast(settings.extras.orbits ? 'Orbits on' : 'Orbits off');
          break;
        case 'o': case 'O':
          setExtra('waves', !settings.extras.waves);
          toast(settings.extras.waves ? 'Ocean waves on' : 'Ocean waves off');
          break;
        case 't': case 'T':
          if (world !== 'earth') toast(coarsePointer ? 'Shooting stars fall around Earth. Use the planet button to go there.' : 'Shooting stars fall around Earth. Press J to go there.');
          else spawnMeteor();
          break;
        case 'j': case 'J': startJourney(world === 'earth' ? 'galaxy' : 'earth', true); break;
        case 'l': case 'L':
          if (world === 'earth') { userInput(); startEclipseView(); } else startEclipseView();
          break;
        case '1': case '2': case '3': case '4': case '5': case '6': case '7': case '8': case '9': case '0':
          goToNumber(Number(e.key));
          break;
        case 'e': case 'E': if (editorOpen()) closeEditor(); else openEditor(); break;
        case 'h': case 'H': toggleUI(); break;
        case 'f': case 'F': toggleFullscreen(); break;
        case 'p': case 'P': savePicture(); break;
        case '[': timeStep(-1); break;
        case ']': timeStep(1); break;
        case 'k': case 'K': timePause(); break;
        case 'y': case 'Y': timeNow(); break;
        case 'i': case 'I': if (aboutEl.hidden) openAbout(); else closeAbout(); break;
        case 'm': case 'M': setReducedMotion(!reducedMotion); break;
        case ' ':
          spinning = !spinning;
          toast(spinning ? 'Spinning' : 'Spin paused');
          break;
        default: handled = false;
      }
      if (handled) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      const pressedAt = heldKeys.get(e.code);
      if (pressedAt !== undefined) {
        heldKeys.delete(e.code);
        nav.fast = e.shiftKey;
        updateNav();
        // A quick tap still gives a small step.
        if (performance.now() - pressedAt < 200) applyNav(0.3, KEY_AXES[e.code]);
      } else if (e.key === 'Shift') {
        nav.fast = false;
      }
    });
    // Letting go of everything if the window loses focus (no runaway flying).
    window.addEventListener('blur', () => {
      heldKeys.clear();
      for (const k of Object.keys(padHeld)) padHeld[k] = 0;
      updateNav();
    });

    // =================================================================
    // 12b. Getting around: arrow pads, the map, and Go to
    // =================================================================
    const nav = { lookX: 0, lookY: 0, moveX: 0, moveZ: 0, fast: false };
    const padHeld = { lookX: 0, lookY: 0, moveX: 0, moveZ: 0 };
    const heldKeys = new Map(); // key code → when it was pressed
    const KEY_AXES = {
      KeyW: { moveZ: 1 }, KeyS: { moveZ: -1 }, KeyA: { moveX: -1 }, KeyD: { moveX: 1 },
      ArrowUp: { lookY: 1 }, ArrowDown: { lookY: -1 }, ArrowLeft: { lookX: -1 }, ArrowRight: { lookX: 1 },
    };

    function updateNav() {
      const k = (code) => (heldKeys.has(code) ? 1 : 0);
      nav.moveZ = clamp(k('KeyW') - k('KeyS') + padHeld.moveZ, -1, 1);
      nav.moveX = clamp(k('KeyD') - k('KeyA') + padHeld.moveX, -1, 1);
      nav.lookX = clamp(k('ArrowRight') - k('ArrowLeft') + padHeld.lookX, -1, 1);
      nav.lookY = clamp(k('ArrowUp') - k('ArrowDown') + padHeld.lookY, -1, 1);
    }

    const navFwd = new THREE.Vector3();
    const navRight = new THREE.Vector3();
    // Look: go around the galaxy (left/right) and over or under it (up/down).
    // Move: fly towards where you're looking, back, or slide sideways.
    // Speed scales with distance, so it feels the same close up and far out.
    function applyNav(dt, axes) {
      const a = Object.assign({ lookX: 0, lookY: 0, moveX: 0, moveZ: 0 }, axes || nav);
      const boost = nav.fast ? 2.5 : 1;
      if (a.lookX || a.lookY) {
        view.goalTheta += a.lookX * dt * 1.1 * boost;
        view.goalPhi -= a.lookY * dt * 0.8 * boost;
      }
      if ((a.moveX || a.moveZ) && world === 'earth') {
        // On Earth: forward and back zoom towards or away from the planet,
        // and sideways goes around it.
        view.goalRadius *= Math.exp(-a.moveZ * dt * 0.9 * boost);
        view.goalTheta += a.moveX * dt * 0.9 * boost;
      } else if (a.moveX || a.moveZ) {
        const speed = clamp(view.radius * 0.9, 0.5, 9) * boost;
        camera.getWorldDirection(navFwd);
        navRight.crossVectors(navFwd, WORLD_UP);
        if (navRight.lengthSq() < 1e-6) navRight.setFromMatrixColumn(camera.matrixWorld, 0);
        navRight.normalize();
        view.goalTarget.addScaledVector(navFwd, a.moveZ * speed * dt).addScaledVector(navRight, a.moveX * speed * dt);
      }
      clampGoals();
    }

    // Arrow pads: hold to keep going; a quick click gives a small step.
    for (const b of document.querySelectorAll('.pad-btn')) {
      const axis = b.dataset.axis;
      const dir = Number(b.dataset.dir);
      let pressedAt = 0;
      const release = () => {
        if (!pressedAt) return;
        const quick = performance.now() - pressedAt < 200;
        pressedAt = 0;
        if (padHeld[axis] === dir) padHeld[axis] = 0;
        b.classList.remove('held');
        updateNav();
        if (quick) applyNav(0.3, { [axis]: dir });
      };
      b.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        try { b.setPointerCapture(e.pointerId); } catch (err) { /* keeps working without capture */ }
        pressedAt = performance.now();
        padHeld[axis] = dir;
        b.classList.add('held');
        userInput();
        updateNav();
      });
      b.addEventListener('pointerup', release);
      b.addEventListener('pointercancel', release);
      b.addEventListener('lostpointercapture', release);
      b.addEventListener('click', (e) => {
        if (e.detail === 0) { userInput(); applyNav(0.35, { [axis]: dir }); } // Enter/Space on the button
      });
    }

    // ---- Go to ----
    const goBtn = $('#goBtn');
    const goMenu = $('#goMenu');
    const anchor = new THREE.Object3D(); // a point on the galaxy to follow as it spins
    galaxy.add(anchor);

    // The places in Go to, for each world (keys 1 to 0 follow this order).
    function goPlaces() {
      if (world === 'earth') {
        const list = [
          ['earth', 'The whole Earth'],
          ['luna', 'Luna, the Moon'],
          ['sol', 'Sol, the Sun'],
        ];
        if (planets) for (const b of planets.bodies) list.push([b.id, b.sub ? `${b.name} (${b.sub})` : b.name]);
        list.push(['system', 'The whole solar system'], ['eclipse', 'The next solar eclipse'], ['sizes', 'Size line-up'], ['ladder', 'Light-time ladder'], ['galaxy', 'Back to the galaxy']);
        return list;
      }
      return [
        ['overview', 'The whole galaxy'],
        ['side', 'Side view'],
        ['core', 'The very centre'],
        ['bar', 'The central bar'],
        ['orion', 'The Orion Arm (our arm)'],
        ['sol', 'Sol, our Sun'],
        ['earth', 'Earth'],
        ['surprise', 'Surprise me'],
        ['sizes', 'Size line-up'],
        ['ladder', 'Light-time ladder'],
      ];
    }

    function renderGoMenu() {
      goMenu.textContent = '';
      goPlaces().forEach(([id, label], i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'menuitem');
        b.dataset.go = id;
        const span = document.createElement('span');
        span.textContent = label;
        const kbd = document.createElement('kbd');
        kbd.textContent = String((i + 1) % 10);
        b.append(span, kbd);
        goMenu.appendChild(b);
      });
    }
    function openGoMenu() {
      closeHelp();
      renderGoMenu();
      goMenu.hidden = false;
      goBtn.setAttribute('aria-expanded', 'true');
      const first = goMenu.querySelector('button');
      if (first) first.focus();
    }
    function closeGoMenu(refocus) {
      if (goMenu.hidden) return;
      goMenu.hidden = true;
      goBtn.setAttribute('aria-expanded', 'false');
      if (refocus) goBtn.focus({ preventScroll: true });
    }
    goBtn.addEventListener('click', (e) => { e.stopPropagation(); if (goMenu.hidden) openGoMenu(); else closeGoMenu(); });
    document.addEventListener('pointerdown', (e) => {
      if (!goMenu.hidden && !goMenu.contains(e.target) && !goBtn.contains(e.target)) closeGoMenu();
    });
    goMenu.addEventListener('keydown', (e) => {
      const items = Array.from(goMenu.querySelectorAll('button'));
      const i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    });
    goMenu.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-go]');
      if (b) goTo(b.dataset.go, true);
    });
    function goToNumber(n) {
      const item = goPlaces()[(n + 9) % 10];
      if (item) goTo(item[0], true);
    }

    function followPoint(localPos, radius, phi) {
      anchor.position.copy(localPos);
      follow = { obj: anchor };
      view.goalRadius = radius;
      if (phi !== undefined) view.goalPhi = phi;
    }

    function goTo(dest, fromUser = true) {
      if (fromUser) userInput();
      closeGoMenu();
      if (journey) return;
      if (dest === 'sizes' || dest === 'ladder') { if (cards) cards.openCompare(dest); return; }
      if (cards) cards.closeCompare();
      if (world === 'galaxy') {
        const card = { core: 'centre', bar: 'bar', orion: 'orion', sol: 'sol' }[dest];
        if (card) showCard(card); else if (cards) cards.hide();
      }
      if (world === 'earth') { goToOnEarth(dest); return; }
      if (dest === 'earth') { startJourney('earth', false); return; }
      glide(4);
      switch (dest) {
        case 'overview':
          view.goalTarget.set(0, 0, 0);
          view.goalRadius = startRadius();
          view.goalPhi = 0.5;
          break;
        case 'side':
          view.goalTarget.set(0, 0, 0);
          view.goalRadius = startRadius();
          view.goalPhi = 1.45;
          break;
        case 'core':
          view.goalTarget.set(0, 0, 0);
          view.goalRadius = 0.72;
          view.goalPhi = 0.95;
          break;
        case 'sol':
          follow = { obj: solMarker };
          view.goalRadius = 1.1;
          view.goalPhi = 1.05;
          toast(coarsePointer
            ? 'Sol, our Sun. Tap it, or keep zooming in, to fly to Earth.'
            : 'Sol, our Sun. Click it, or keep zooming in, to fly to Earth.');
          break;
        case 'bar':
          view.goalTarget.set(0, 0, 0);
          view.goalRadius = 4.2;
          view.goalPhi = 0.35;
          break;
        case 'orion': {
          // From a little way out from the Sun, looking along the arm.
          const p = MODEL.sunPosition;
          followPoint(new THREE.Vector3(p[0] * 0.98, 0, p[2] - 0.35), 2.2, 0.9);
          break;
        }
        case 'surprise': {
          const a = MODEL.randomArmPoint();
          followPoint(new THREE.Vector3(a[0], a[1], a[2]), 1.2 + Math.random() * 0.8, 0.7 + Math.random() * 0.6);
          view.goalTheta += (Math.random() - 0.5) * 2;
          break;
        }
        default:
          break;
      }
      clampGoals();
    }

    function goToOnEarth(dest) {
      follow = null;
      const card = { earth: 'earth', luna: 'moon', sol: 'sun' }[dest] || (planets && planets.byId[dest] ? dest : null);
      if (card) showCard(card); else if (cards) cards.hide();
      if (dest !== 'eclipse' && earth && earth.eclipse.active) earth.stopEclipse(); // the clock stays on the eclipse's date
      glide(4);
      switch (dest) {
        case 'earth':
          view.goalTarget.set(0, 0, 0);
          view.goalRadius = startRadius();
          view.goalPhi = 1.2;
          break;
        case 'luna':
          // Seen from Earth's side, so it shows its real phase right now.
          follow = { obj: earth.moon, fromEarth: true };
          view.goalRadius = 2.8;
          break;
        case 'sol':
          follow = { obj: earth.sol };
          view.goalRadius = earth.sunR * 4;
          view.goalPhi = 1.3;
          break;
        case 'eclipse':
          startEclipseView();
          return;
        case 'system':
          view.goalTarget.copy(earth.sunPos);
          view.goalRadius = SKY.distanceUnits(32, earth.scaleMode) * 1.9;
          view.goalPhi = 0.75;
          glide(5);
          break;
        case 'galaxy':
          startJourney('galaxy', false);
          return;
        default: {
          const b = planets && planets.byId[dest];
          if (!b) break;
          follow = { obj: b.group, planet: b };
          view.goalRadius = b.R * 4.2;
          view.goalPhi = 1.25;
          glide(5);
          break;
        }
      }
      clampGoals();
    }

    // The eclipse: the camera goes just above Earth's night side, looking
    // past the planet's edge at Sol, and Luna slides across.
    // The next real solar eclipse (Astronomy Engine), seen from the place
    // where it is greatest. The clock jumps to it and plays it through.
    function startEclipseView(seconds) {
      if (world !== 'earth' || !earth) {
        toast(coarsePointer ? 'Eclipses are seen from Earth. Use the planet button to go there.' : 'Eclipses are seen from Earth. Press J (or the planet button) to go there.');
        return null;
      }
      const res = earth.startEclipse(seconds, clock.now());
      if (!res) { toast("Couldn't find the next solar eclipse."); return null; }
      clock.setDate(earth.timeMs);
      follow = { eclipse: true };
      const v = res.view;
      view.goalTarget.copy(v.target);
      view.goalRadius = v.radius;
      view.goalPhi = v.phi;
      view.goalTheta = v.theta + Math.round((view.goalTheta - v.theta) / TAU) * TAU;
      glide(3.5);
      clampGoals();
      return res.info;
    }
    function eclipseEnded() {
      if (follow && follow.eclipse) follow = null;
      if (tourOn) return; // the tour puts the clock back itself
      const info = earth.eclipse.info;
      if (info) toast(`That was the ${eclipseName(info).toLowerCase()} of ${fmtDay(info.peak)}. Press Now to come back to today.`, { label: 'Now', run: () => clock.setLive() });
    }
    const KIND_NAMES = { total: 'Total', annular: 'Annular', partial: 'Partial', hybrid: 'Hybrid' };
    function eclipseName(info) { return `${KIND_NAMES[info.kind] || 'Solar'} solar eclipse`; }
    function fmtLatLon(lat, lon) {
      return `${Math.abs(lat).toFixed(1)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(1)}° ${lon >= 0 ? 'E' : 'W'}`;
    }

    // ---- the map ----
    // Galaxy: seen from above, turned so "up" on the map is the way you're
    // facing. Earth: a flat world map with day and night. Click to go there.
    const mapCanvas = $('#minimap');
    const mapCtx = mapCanvas.getContext('2d');
    const MAP_PX = 264;
    // Three maps: the galaxy from above; Earth's world map (near Earth); and
    // the solar system from above (anywhere else in the solar system).
    let mapMode = 'galaxy';
    function wantedMapMode() {
      if (world !== 'earth') return 'galaxy';
      if (!earth || !planets) return 'earth';
      const away = camera.position.length() > 30 || (follow && (follow.planet || follow.obj === earth.sol));
      return away ? 'system' : 'earth';
    }
    function sizeMapCanvas() {
      if (mapMode === 'earth') { mapCanvas.width = 352; mapCanvas.height = 176; }
      else { mapCanvas.width = MAP_PX; mapCanvas.height = MAP_PX; }
    }
    const MAP_LABELS = {
      galaxy: 'Map of the galaxy, seen from above. Click a spot to fly there.',
      earth: 'World map with day and night. Click a place to turn Earth towards it.',
      system: 'Map of the solar system, seen from above the planets. Click a planet to fly there.',
    };
    function applyMapMode(force) {
      const m = wantedMapMode();
      if (m === mapMode && !force) return;
      mapMode = m;
      $('#navmap').classList.toggle('earth', m === 'earth');
      mapCanvas.setAttribute('aria-label', MAP_LABELS[m]);
      sizeMapCanvas();
    }
    sizeMapCanvas();
    let mapBg = null;
    const mapRange = () => GALAXY_R * 1.4; // galaxy units from the centre to the edge of the map

    function buildMapBackground() {
      if (!stars || !G) return;
      const c = document.createElement('canvas');
      c.width = c.height = MAP_PX;
      const ctx = c.getContext('2d');
      ctx.globalCompositeOperation = 'lighter';
      const pos = stars.geometry.getAttribute('position').array;
      const col = stars.geometry.getAttribute('aColor').array;
      const half = MAP_PX / 2;
      const s = half / mapRange();
      const stepN = Math.max(1, Math.floor(G.count / 14000));
      for (let i = 0; i < G.count; i += stepN) {
        ctx.fillStyle = `rgba(${(col[i * 3] * 255) | 0}, ${(col[i * 3 + 1] * 255) | 0}, ${(col[i * 3 + 2] * 255) | 0}, 0.55)`;
        ctx.fillRect(half + pos[i * 3] * s - 0.7, half + pos[i * 3 + 2] * s - 0.7, 1.4, 1.4);
      }
      mapBg = c;
    }

    function drawMap() {
      if (mapCanvas.getClientRects().length === 0) return; // hidden
      applyMapMode(false);
      if (world === 'earth') { if (earth) { if (mapMode === 'system') drawSystemMap(); else drawEarthMap(); } return; }
      if (!mapBg) return;
      const W = MAP_PX;
      const half = W / 2;
      const s = half / mapRange();
      const ctx = mapCtx;
      const heading = view.theta;
      const cos = Math.cos(heading);
      const sin = Math.sin(heading);
      const toMap = (x, z) => [half + (x * cos - z * sin) * s, half + (x * sin + z * cos) * s];

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, W);
      ctx.save();
      ctx.beginPath();
      ctx.arc(half, half, half - 1, 0, TAU);
      ctx.clip();
      ctx.fillStyle = 'rgba(12, 6, 20, 0.82)';
      ctx.fillRect(0, 0, W, W);

      ctx.save();
      ctx.translate(half, half);
      ctx.rotate(heading - galaxy.rotation.y);
      ctx.drawImage(mapBg, -half, -half);
      ctx.restore();

      // Sol, our Sun (you are here)
      solMarker.getWorldPosition(tmpV);
      const [sx, sy] = toMap(tmpV.x, tmpV.z);
      ctx.fillStyle = '#ffd38a';
      ctx.shadowColor = 'rgba(255, 190, 120, 0.95)';
      ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(sx, sy, 5, 0, TAU); ctx.fill();
      ctx.shadowBlur = 0;

      // where you're looking (the point you go around)
      const [tx, ty] = toMap(view.target.x, view.target.z);
      ctx.strokeStyle = 'rgba(255, 92, 138, 0.95)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(tx, ty, 5, 0, TAU); ctx.stroke();

      // you, with a wedge showing which way you're facing
      let [cx, cy] = toMap(camera.position.x, camera.position.z);
      const dx = cx - half;
      const dy = cy - half;
      const d = Math.hypot(dx, dy);
      const edge = half - 10;
      if (d > edge) { cx = half + (dx / d) * edge; cy = half + (dy / d) * edge; }
      const look = Math.atan2(ty - cy, tx - cx);
      const faceAngle = Math.hypot(ty - cy, tx - cx) > 2 ? look : -Math.PI / 2;
      const fov = Math.atan(Math.tan((camera.fov * Math.PI) / 360) * camera.aspect);
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 34);
      grad.addColorStop(0, 'rgba(255, 184, 207, 0.45)');
      grad.addColorStop(1, 'rgba(255, 184, 207, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, 34, faceAngle - fov, faceAngle + fov);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = 'rgba(255, 92, 138, 1)';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(cx, cy, 5.5, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.restore();

      ctx.strokeStyle = 'rgba(255, 184, 207, 0.3)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(half, half, half - 1, 0, TAU); ctx.stroke();
    }

    // Earth's map: continents, the night side, where the Sun and Moon are
    // overhead, and where you're looking.
    const nightCanvas = document.createElement('canvas');
    nightCanvas.width = 88;
    nightCanvas.height = 44;
    let nightPaintedAt = -Infinity;
    function paintNight() {
      const ss = earth.subsolar();
      const w = nightCanvas.width;
      const h = nightCanvas.height;
      const ctx = nightCanvas.getContext('2d');
      const img = ctx.createImageData(w, h);
      const sLat = (ss.lat * Math.PI) / 180;
      const sLon = (ss.lon * Math.PI) / 180;
      for (let y = 0; y < h; y++) {
        const lat = (Math.PI / 2) - ((y + 0.5) / h) * Math.PI;
        for (let x = 0; x < w; x++) {
          const lon = ((x + 0.5) / w) * TAU - Math.PI;
          const c = Math.sin(lat) * Math.sin(sLat) + Math.cos(lat) * Math.cos(sLat) * Math.cos(lon - sLon);
          const i = (y * w + x) * 4;
          img.data[i] = 6;
          img.data[i + 1] = 3;
          img.data[i + 2] = 18;
          img.data[i + 3] = Math.round(smoothstep(0.08, -0.12, c) * 170);
        }
      }
      ctx.putImageData(img, 0, 0);
    }
    function drawEarthMap() {
      const W = mapCanvas.width;
      const H = mapCanvas.height;
      const ctx = mapCtx;
      const toXY = (lat, lon) => [((lon + 180) / 360) * W, ((90 - lat) / 180) * H];
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(earth.mapImage, 0, 0, W, H);
      const now = performance.now();
      if (now - nightPaintedAt > 2000) { nightPaintedAt = now; paintNight(); }
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(nightCanvas, 0, 0, W, H);

      // overhead Sun and Moon
      const ss = earth.subsolar();
      let [x, y] = toXY(ss.lat, ss.lon);
      ctx.fillStyle = '#ffd38a';
      ctx.shadowColor = 'rgba(255, 190, 120, 0.95)';
      ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(x, y, 5, 0, TAU); ctx.fill();
      const sl = earth.sublunar();
      [x, y] = toXY(sl.lat, sl.lon);
      ctx.fillStyle = '#e8ecff';
      ctx.shadowColor = 'rgba(190, 210, 255, 0.95)';
      ctx.beginPath(); ctx.arc(x, y, 4, 0, TAU); ctx.fill();
      ctx.shadowBlur = 0;
      // where you're looking
      const me = earth.worldToLatLon(camera.position.clone());
      [x, y] = toXY(me.lat, me.lon);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 8, 0, TAU); ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 92, 138, 1)';
      ctx.beginPath(); ctx.arc(x, y, 11, 0, TAU); ctx.stroke();

      ctx.strokeStyle = 'rgba(255, 184, 207, 0.4)';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, W - 2, H - 2);
    }

    // The solar system from above (the ecliptic plane), turned so "up" on
    // the map is the way you're facing, with each orbit and planet.
    let systemMapRange = 1;
    function systemToMap(x, z) {
      const half = MAP_PX / 2;
      const s = (half - 8) / systemMapRange;
      const dx = x - earth.sunPos.x;
      const dz = z - earth.sunPos.z;
      const c = Math.cos(view.theta);
      const n = Math.sin(view.theta);
      return [half + (dx * c - dz * n) * s, half + (dx * n + dz * c) * s];
    }
    function drawSystemMap() {
      const W = MAP_PX;
      const half = W / 2;
      const ctx = mapCtx;
      let range = 1;
      for (const b of planets.bodies) range = Math.max(range, b.group.position.distanceTo(earth.sunPos));
      systemMapRange = range * 1.04;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, W);
      ctx.save();
      ctx.beginPath(); ctx.arc(half, half, half - 1, 0, TAU); ctx.clip();
      ctx.fillStyle = 'rgba(12, 6, 20, 0.85)';
      ctx.fillRect(0, 0, W, W);
      ctx.lineWidth = 1;
      for (const o of planets.orbits) {
        const a = o.line.geometry.getAttribute('position');
        if (!a) continue;
        ctx.strokeStyle = `#${o.color.toString(16).padStart(6, '0')}55`;
        ctx.beginPath();
        for (let i = 0; i < a.count; i += 3) {
          const [x, y] = systemToMap(a.getX(i) + earth.sunPos.x, a.getZ(i) + earth.sunPos.z);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      let [x, y] = systemToMap(earth.sunPos.x, earth.sunPos.z);
      ctx.fillStyle = '#ffd38a';
      ctx.shadowColor = 'rgba(255, 190, 120, 0.95)';
      ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(x, y, 4.5, 0, TAU); ctx.fill();
      ctx.shadowBlur = 0;
      const dot = (px, pz, color, r) => { [x, y] = systemToMap(px, pz); ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); };
      dot(0, 0, '#6f9cff', 3.2); // Earth
      for (const b of planets.bodies) dot(b.group.position.x, b.group.position.z, `#${b.orbit.toString(16).padStart(6, '0')}`, 3);
      // you, with a wedge showing which way you're facing
      let [cx, cy] = systemToMap(camera.position.x, camera.position.z);
      const [tx, ty] = systemToMap(view.target.x, view.target.z);
      const dx = cx - half;
      const dy = cy - half;
      const d = Math.hypot(dx, dy);
      if (d > half - 10) { cx = half + (dx / d) * (half - 10); cy = half + (dy / d) * (half - 10); }
      const face = Math.hypot(ty - cy, tx - cx) > 2 ? Math.atan2(ty - cy, tx - cx) : -Math.PI / 2;
      const fov = Math.atan(Math.tan((camera.fov * Math.PI) / 360) * camera.aspect);
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 30);
      grad.addColorStop(0, 'rgba(255, 184, 207, 0.45)');
      grad.addColorStop(1, 'rgba(255, 184, 207, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, 30, face - fov, face + fov); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = 'rgba(255, 92, 138, 1)';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(cx, cy, 5, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = 'rgba(255, 184, 207, 0.3)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(half, half, half - 1, 0, TAU); ctx.stroke();
    }

    let mapPointer = null;
    function mapGo(e, first) {
      const rect = mapCanvas.getBoundingClientRect();
      if (world === 'earth' && mapMode === 'system') {
        if (!first || !earth || !planets) return;
        // Fly to the body nearest the click (the Sun, Earth or a planet).
        const mx = ((e.clientX - rect.left) / rect.width) * MAP_PX;
        const my = ((e.clientY - rect.top) / rect.height) * MAP_PX;
        const cands = [['sol', earth.sunPos], ['earth', new THREE.Vector3()], ...planets.bodies.map((b) => [b.id, b.group.position])];
        let best = null;
        let bestD = 18;
        for (const [id, p] of cands) {
          const [x, y] = systemToMap(p.x, p.z);
          const d = Math.hypot(x - mx, y - my);
          if (d < bestD) { bestD = d; best = id; }
        }
        if (best) goToOnEarth(best);
        return;
      }
      if (world === 'earth') {
        if (!earth) return;
        const lon = ((e.clientX - rect.left) / rect.width) * 360 - 180;
        const lat = clamp(90 - ((e.clientY - rect.top) / rect.height) * 180, -80, 80);
        view.goalTarget.set(0, 0, 0);
        faceDirection(earth.latLonToWorld(lat, lon, 1));
        if (first) { if (view.goalRadius > 5) view.goalRadius = 4.5; glide(3); }
        clampGoals();
        return;
      }
      const half = rect.width / 2;
      const mx = ((e.clientX - rect.left - half) / half) * mapRange();
      const mz = ((e.clientY - rect.top - half) / half) * mapRange();
      const cos = Math.cos(view.theta);
      const sin = Math.sin(view.theta);
      view.goalTarget.set(mx * cos + mz * sin, 0, -mx * sin + mz * cos);
      if (first) {
        if (view.goalRadius > 3) view.goalRadius = 2.6;
        glide(3);
      }
      clampGoals();
    }
    mapCanvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || journey) return;
      e.preventDefault();
      try { mapCanvas.setPointerCapture(e.pointerId); } catch (err) { /* keeps working without capture */ }
      mapPointer = e.pointerId;
      userInput();
      mapGo(e, true);
    });
    mapCanvas.addEventListener('pointermove', (e) => {
      if (e.pointerId === mapPointer) mapGo(e, false);
    });
    const releaseMap = (e) => { if (e.pointerId === mapPointer) mapPointer = null; };
    mapCanvas.addEventListener('pointerup', releaseMap);
    mapCanvas.addEventListener('pointercancel', releaseMap);
    mapCanvas.addEventListener('lostpointercapture', releaseMap);

    function applyNavVisibility() {
      document.body.classList.toggle('nav-off', !settings.extras.navControls);
    }
    applyNavVisibility();

    // =================================================================
    // 12c. Worlds: the journey between the galaxy and Earth
    // =================================================================
    const warpEl = $('#warp');
    const worldBtn = $('#worldBtn');
    let journey = null; // { to, stage: 'approach' | 'flash' | 'reveal', t }
    let earthState = { coverage: 0, eclipseActive: false };
    let lastSolDistance = Infinity;

    function ensureEarth() {
      if (earth) return true;
      if (!window.YouAreHereEarth || !window.YOU_ARE_HERE_EARTH_LAND) {
        toast("Earth couldn't load. Check that earth.js and earth-map.js are in the folder.");
        return false;
      }
      earth = window.YouAreHereEarth.create(THREE, {
        TAU, clamp, smoothstep, makeCanvasTexture, sunTexture,
        galaxyColors: { inside: settings.galaxy.insideColor, outside: settings.galaxy.outsideColor },
        startMs: clock.now(),
      });
      earthSphere.radius = earth.R;
      earth.setViewport(shared.uViewH.value, starMaterial.uniforms.uMaxSize.value);
      if (window.YouAreHerePlanets) {
        planets = window.YouAreHerePlanets.create(THREE, { TAU, clamp, smoothstep, makeCanvasTexture, textTexture }, earth);
        planets.setViewport(shared.uViewH.value, starMaterial.uniforms.uMaxSize.value);
        if (window.YouAreHereMoons) {
          moons = window.YouAreHereMoons.create(THREE, { TAU, clamp, smoothstep, makeCanvasTexture, textTexture }, earth, planets);
          moons.setViewport(shared.uViewH.value, starMaterial.uniforms.uMaxSize.value);
        }
      }
      return true;
    }

    // The journey: dive into Sol, a flash of light, and you arrive at Earth
    // from far out (Sol, Earth and its orbit for a moment), gliding in.
    function startJourney(to, fromUser) {
      if (journey || world === to) return;
      if (to === 'earth' && !ensureEarth()) return;
      if (fromUser) userInput();
      closeGoMenu();
      follow = null;
      if (to === 'earth') {
        follow = { obj: solMarker };
        view.goalRadius = Z.closest;
      } else {
        view.goalTarget.copy(earth.sunPos).multiplyScalar(0.8);
        view.goalRadius = 60;
      }
      glide(2);
      journey = { to, stage: 'approach', t: 0 };
    }

    function updateJourney(dt) {
      if (!journey) return;
      journey.t += dt;
      let warp = 0;
      if (journey.stage === 'approach') {
        warp = smoothstep(0.9, 1.7, journey.t) * 0.6;
        if (journey.t >= 1.7) { journey.stage = 'flash'; journey.t = 0; }
      } else if (journey.stage === 'flash') {
        warp = 0.6 + 0.4 * clamp(journey.t / 0.45, 0, 1);
        if (journey.t >= 0.45) { switchWorld(journey.to); journey.stage = 'reveal'; journey.t = 0; warp = 1; }
      } else {
        warp = 1 - smoothstep(0, 1.1, journey.t);
        if (journey.t >= 1.1) { journey = null; warp = 0; }
      }
      warpEl.style.opacity = warp.toFixed(3);
      warpEl.classList.toggle('on', warp > 0);
    }

    function switchWorld(to) {
      world = to;
      follow = null;
      caption.on = false;
      if (to === 'earth') {
        for (const m of meteors) earth.scene.add(m.mesh);
        // Start far out, looking between Sol and Earth (the solar system for
        // a moment), then glide in to Earth.
        const sunAngle = Math.atan2(earth.sunDir.x, earth.sunDir.z);
        view.target.copy(earth.sunPos).multiplyScalar(0.45);
        view.goalTarget.set(0, 0, 0);
        view.radius = 150;
        view.goalRadius = startRadius();
        view.theta = sunAngle + Math.PI / 2;
        view.goalTheta = sunAngle + 1.25; // ends about 70° from the Sun: day, night and sunset
        view.phi = 1.15;
        view.goalPhi = 1.22;
        glide(9, 0.55, 0.5); // slow at first, so you see Sol and Earth together
        if (!tourOn) toast(`Welcome to Earth.${coarsePointer ? '' : ' Press L for the next solar eclipse.'}`);
      } else {
        clearMeteors(); // shooting stars only fall around Earth
        for (const m of meteors) scene.add(m.mesh);
        solMarker.getWorldPosition(tmpV);
        view.target.copy(tmpV);
        view.goalTarget.copy(tmpV);
        view.radius = 0.45;
        view.goalRadius = 4.5;
        view.phi = view.goalPhi = 0.95;
        glide(5);
      }
      applyWorldUI();
    }

    function applyWorldUI() {
      const inEarth = world === 'earth';
      document.body.classList.toggle('in-earth', inEarth);
      worldBtn.setAttribute('aria-label', inEarth ? 'Back to the galaxy' : 'Go to Earth');
      worldBtn.title = inEarth ? 'Back to the galaxy (J)' : 'Go to Earth (J)';
      applyMapMode(true);
      if (!goMenu.hidden) renderGoMenu();
      railShown = -1;
      setHintText();
    }
    worldBtn.addEventListener('click', () => startJourney(world === 'earth' ? 'galaxy' : 'earth', true));

    // =================================================================
    // 12d. Save the tour as a video file (no screen recorder needed)
    // =================================================================
    // The page draws the tour at a fixed size (phone: 1080 x 1920, or
    // widescreen: 1920 x 1080), records the drawing with the browser's
    // MediaRecorder, and downloads it. The typed captions and the fades are
    // drawn into the picture here, because the on-screen caption is HTML and
    // wouldn't be in the recording.
    let capture = null;
    const hud = {
      scene: new THREE.Scene(),
      cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
      canvas: document.createElement('canvas'),
      region: 0.36,
      key: '',
      drawnAt: 0,
    };
    hud.tex = new THREE.CanvasTexture(hud.canvas);
    hud.msg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: hud.tex, transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
    hud.fade = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
    hud.msg.renderOrder = 1;
    hud.fade.renderOrder = 2;
    hud.scene.add(hud.msg, hud.fade);

    // Formats to try, best first. H.264 in MP4 plays everywhere (iPhone,
    // TikTok, Instagram); WebM is the browser's older, steadier recorder.
    // The video has no sound, so no audio codec is ever declared: declaring
    // an audio track that never arrives made Chrome's MP4 encoder crash the
    // tab on Windows.
    const VIDEO_FAMILIES = [
      { id: 'mp4', label: 'MP4', types: ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1.4d0028', 'video/mp4;codecs=avc1.42E028', 'video/mp4;codecs=avc1', 'video/mp4'] },
      { id: 'vp9', label: 'WebM', types: ['video/webm;codecs=vp9'] },
      { id: 'vp8', label: 'WebM', types: ['video/webm;codecs=vp8', 'video/webm'] },
    ];
    // If Chrome crashes while saving a video, the page can't catch it. So a
    // note is left before recording and removed afterwards; a note still
    // there on the next visit means that format crashed, and it's skipped
    // from then on (until the browser updates to a new version).
    const REC_KEY = 'you-are-here-recording';
    const REC_BAD_KEY = 'you-are-here-recording-skip';
    function recRead(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (err) { return null; } }
    function recWrite(key, value) {
      try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)); } catch (err) { /* private mode: no memory */ }
    }
    function skippedFamilies() {
      const s = recRead(REC_BAD_KEY);
      return s && s.ua === navigator.userAgent && Array.isArray(s.families) ? s.families : [];
    }
    function videoType() {
      if (!canvas.captureStream || !window.MediaRecorder) return null;
      const skip = skippedFamilies();
      for (const fam of VIDEO_FAMILIES) {
        if (skip.includes(fam.id)) continue;
        const type = fam.types.find((t) => MediaRecorder.isTypeSupported(t));
        if (type) return { type, family: fam.id, label: fam.label };
      }
      return null;
    }
    (function checkLastRecording() {
      const last = recRead(REC_KEY);
      if (!last || !last.family) return;
      recWrite(REC_KEY, null);
      const families = [...new Set([...skippedFamilies(), last.family])];
      recWrite(REC_BAD_KEY, { ua: navigator.userAgent, families });
      const next = videoType();
      setTimeout(() => toast(next
        ? `Saving the video crashed the browser last time, so it will use ${next.label} next time. Try Save as a video again.`
        : 'Saving a video keeps crashing this browser. Use Play for a video with a screen recorder instead.'), 1200);
    })();
    // Closing or reloading the page on purpose mid-recording isn't a crash.
    window.addEventListener('pagehide', () => { if (capture) recWrite(REC_KEY, null); });

    // Where the caption sits, as a share of the height (like the CSS).
    const HUD_PLACE = { moon: 0.72, eclipse: 0.2 };
    const hudPlace = (src) => HUD_PLACE[src] || (src && src.startsWith('stop:') ? 0.74 : 0.46);
    function wrapCanvasText(ctx, text, maxW) {
      const words = text.split(' ');
      const lines = [];
      let line = '';
      for (const w of words) {
        const next = line ? `${line} ${w}` : w;
        if (line && ctx.measureText(next).width > maxW) { lines.push(line); line = w; } else line = next;
      }
      if (line) lines.push(line);
      return lines;
    }
    function drawHud() {
      const { W, H } = capture;
      const c = hud.canvas;
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, c.width, c.height);
      const text = captionTextEl.textContent;
      if (!text) { hud.tex.needsUpdate = true; return; }
      const small = caption.source === 'moon' || caption.source === 'eclipse' || caption.source.startsWith('stop:');
      const px = Math.round(Math.min(W * (small ? 0.06 : 0.075), H * (small ? 0.05 : 0.065)));
      ctx.font = `italic 500 ${px}px "Cormorant Garamond", Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const lines = wrapCanvasText(ctx, text, Math.min(W * 0.86, px * 15));
      const lh = px * 1.12;
      const sub = caption.sub && captionEl.classList.contains('done') ? caption.sub.split('\n') : [];
      const subPx = Math.round(px * 0.3);
      const blockH = lines.length * lh + (sub.length ? subPx * 0.8 + sub.length * subPx * 1.5 : 0);
      let y = c.height / 2 - blockH / 2 + lh / 2;
      // a soft dark patch behind the words, like on screen
      const g = ctx.createRadialGradient(W / 2, c.height / 2, 0, W / 2, c.height / 2, Math.max(blockH, px * 4));
      g.addColorStop(0, 'rgba(7, 4, 13, 0.8)');
      g.addColorStop(1, 'rgba(7, 4, 13, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, c.width, c.height);
      for (const l of lines) {
        ctx.shadowColor = 'rgba(170, 80, 255, 0.55)';
        ctx.shadowBlur = px * 0.6;
        ctx.fillStyle = '#fff4f8';
        ctx.fillText(l, W / 2, y);
        ctx.shadowColor = 'rgba(255, 92, 138, 0.85)';
        ctx.shadowBlur = px * 0.24;
        ctx.fillText(l, W / 2, y);
        y += lh;
      }
      if (sub.length) {
        ctx.shadowColor = 'rgba(7, 4, 13, 0.9)';
        ctx.shadowBlur = 10;
        ctx.font = `400 ${subPx}px "Jost", "Segoe UI", sans-serif`;
        ctx.fillStyle = 'rgba(236, 232, 255, 0.92)';
        y += subPx * 0.8 - lh / 2 + subPx * 0.75;
        for (const l of sub) { ctx.fillText(l, W / 2, y); y += subPx * 1.5; }
      }
      hud.tex.needsUpdate = true;
    }
    function updateHud(dt) {
      const key = `${caption.source}|${caption.shown}|${captionEl.classList.contains('done')}`;
      const now = performance.now();
      if (key !== hud.key && now - hud.drawnAt > 45) {
        hud.key = key;
        hud.drawnAt = now;
        drawHud();
      }
      const place = hudPlace(caption.source);
      hud.msg.scale.y = hud.region;
      hud.msg.position.y = 1 - 2 * place;
      hud.msg.material.opacity = caption.alpha;
      // Fade in from black at the start, and out to black during the tour's
      // last moment (so a 60-second tour makes a 60-second video).
      const left = tourOn && tourPlan.length ? tourProgress().total - tourProgress().elapsed : 0;
      if (capture.ending || (tourOn && left < 0.8)) capture.fade = Math.min(1, capture.fade + dt / 0.75);
      else capture.fade = Math.max(0, capture.fade - dt / 0.9);
      hud.fade.material.opacity = capture.fade;
      renderer.autoClear = false;
      renderer.render(hud.scene, hud.cam);
      renderer.autoClear = true;
      if (capture.ending && capture.fade >= 1 && !capture.stopping) {
        capture.stopping = true;
        try { capture.recorder.stop(); } catch (err) { finishVideoFile(); }
      }
      const sec = (now - capture.started) / 1000;
      recStatusText.textContent = `Saving the video (${capture.label}): ${fmtTime(sec)} of ${fmtTime(capture.total)}`;
    }

    const recStatus = $('#recStatus');
    const recStatusText = $('#recStatusText');
    function startVideo(format) {
      if (capture) return;
      const choice = videoType();
      if (!choice) {
        toast(skippedFamilies().length
          ? 'Saving a video keeps crashing this browser. Use Play for a video with a screen recorder instead.'
          : "This browser can't save videos. Use Chrome or Edge on a computer, or use Play for a video with a screen recorder.");
        return;
      }
      const { type, family, label } = choice;
      const [W, H] = format === 'wide' ? [1920, 1080] : [1080, 1920];
      closeEditor();
      closeHelp();
      closeGoMenu();
      hideToast();
      if (tourOn) setTour(false);
      toggleUI(true, true);
      document.body.classList.add('recording', 'capturing');
      capture = { W, H, type, family, label, chunks: [], fade: 1, ending: 0, started: performance.now(), total: settings.tour.seconds, format };
      applySize();
      hud.canvas.width = W;
      hud.canvas.height = Math.round(H * hud.region);
      hud.key = '';
      const stream = canvas.captureStream(30);
      let rec;
      try {
        // 8 Mbps: YouTube's recommended rate for 1080p, and easier on the encoder.
        rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8e6 });
      } catch (err) {
        capture = null;
        document.body.classList.remove('recording', 'capturing');
        applySize();
        toggleUI(false, true);
        toast("This browser couldn't start recording. Try Chrome or Edge on a computer.");
        return;
      }
      capture.recorder = rec;
      rec.ondataavailable = (e) => { if (e.data && e.data.size) capture.chunks.push(e.data); };
      rec.onstop = finishVideoFile;
      recStatus.hidden = false;
      keepAwake(true);
      setTour(true, { once: true, fade: false });
      recWrite(REC_KEY, { family, type, at: Date.now() });
      rec.start(1000);
    }
    function cancelVideo() {
      if (!capture || capture.stopping) return;
      capture.cancelled = true;
      capture.stopping = true;
      try { capture.recorder.stop(); } catch (err) { finishVideoFile(); }
    }
    function finishVideoFile() {
      if (!capture || capture.finished) return;
      const c = capture;
      c.finished = true;
      capture = null;
      recStatus.hidden = true;
      document.body.classList.remove('recording', 'capturing');
      canvas.style.removeProperty('width');
      canvas.style.removeProperty('height');
      canvas.style.removeProperty('left');
      canvas.style.removeProperty('top');
      applySize();
      hud.msg.material.opacity = 0;
      if (tourOn) setTour(false);
      toggleUI(false, true);
      keepAwake(tourOn);
      if (c.cancelled) { recWrite(REC_KEY, null); toast('Video cancelled'); return; }
      const base = c.type.split(';')[0];
      const blob = new Blob(c.chunks, { type: base });
      const ext = base === 'video/mp4' ? 'mp4' : 'webm';
      download(blob, `You Are Here${c.format === 'wide' ? ' (widescreen)' : ''}.${ext}`, 60000);
      recWrite(REC_KEY, null);
      lastVideo = { bytes: blob.size, type: c.type, family: c.family };
      toast(`Video saved to your downloads (${ext.toUpperCase()}, ${fmtSize(blob.size)})`);
    }
    let lastVideo = null;
    // Where the browser can't record a video (for example Safari on iPhone),
    // the Save as a video part of the editor is hidden.
    if (!videoType() && !skippedFamilies().length) {
      const vs = document.querySelector('.video-save');
      if (vs) vs.hidden = true;
    }
    $('#videoSaveBtn').addEventListener('click', () => startVideo($('#videoFormat').value));
    $('#recCancel').addEventListener('click', cancelVideo);
    // While it records: Esc cancels; other keys and clicks on the galaxy do nothing.
    window.addEventListener('keydown', (e) => {
      if (!capture) return;
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); cancelVideo(); }
    }, true);
    for (const type of ['pointerdown', 'wheel', 'dblclick']) {
      window.addEventListener(type, (e) => {
        if (capture && !(e.target && e.target.closest && e.target.closest('#recStatus'))) { e.stopPropagation(); if (e.cancelable) e.preventDefault(); }
      }, { capture: true, passive: false });
    }

    // =================================================================
    // 13. Animation loop and long-running safeguards
    // =================================================================
    let spinning = !reducedMotion;
    let phaseTime = 0;
    let zoomNow = 0;

    function applySize() {
      let w = window.innerWidth;
      let h = window.innerHeight;
      if (capture) {
        // Recording a video: draw at the video's size, and show it scaled
        // down to fit the window.
        const fit = Math.min(w / capture.W, h / capture.H);
        canvas.style.width = `${Math.round(capture.W * fit)}px`;
        canvas.style.height = `${Math.round(capture.H * fit)}px`;
        canvas.style.left = `${Math.round((w - capture.W * fit) / 2)}px`;
        canvas.style.top = `${Math.round((h - capture.H * fit) / 2)}px`;
        w = capture.W;
        h = capture.H;
        renderer.setPixelRatio(1);
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        shared.uViewH.value = h;
        starMaterial.uniforms.uMaxSize.value = Math.min(MAX_POINT, 48 * (h / 900));
        if (earth) earth.setViewport(h, Math.min(MAX_POINT, 48 * (h / 900)));
        if (planets) planets.setViewport(h, Math.min(MAX_POINT, 48 * (h / 900)));
        if (moons) moons.setViewport(h, Math.min(MAX_POINT, 48 * (h / 900)));
        return;
      }
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      shared.uViewH.value = h * pixelRatio;
      starMaterial.uniforms.uMaxSize.value = Math.min(MAX_POINT, 48 * pixelRatio);
      if (earth) earth.setViewport(h * pixelRatio, Math.min(MAX_POINT, 48 * pixelRatio));
      if (planets) planets.setViewport(h * pixelRatio, Math.min(MAX_POINT, 48 * pixelRatio));
      if (moons) moons.setViewport(h * pixelRatio, Math.min(MAX_POINT, 48 * pixelRatio));
    }
    let resizeQueued = false;
    window.addEventListener('resize', () => {
      if (resizeQueued) return;
      resizeQueued = true;
      requestAnimationFrame(() => { resizeQueued = false; applySize(); });
    });

    // Everything that moves, advanced by dt seconds. Clocks are wrapped so
    // values never grow without limit, whether it runs for minutes or days.
    const followPos = new THREE.Vector3();
    function step(dt) {
      phaseTime = (phaseTime + dt) % LOOP_SECONDS;
      shared.uPhase.value = (phaseTime / LOOP_SECONDS) * TAU;

      // The clock: a real eclipse being played sets it; otherwise it runs.
      if (earth && earth.eclipse.active) {
        const ms = earth.advanceEclipse(dt);
        if (ms !== null) clock.setDate(ms);
        if (!earth.eclipse.active) eclipseEnded();
      } else if (clock.tick(dt)) {
        toast(`The clock runs from ${new Date(clock.min).getUTCFullYear()} to ${new Date(clock.max).getUTCFullYear()}, so it stopped there.`);
      }

      updateJourney(dt);
      const idle = !reducedMotion && performance.now() - lastInput > 15000;
      if (tourOn) {
        updateTour(dt);
      } else if (world === 'earth') {
        // After a while with no input, drift slowly around Earth.
        if (idle && !follow && !earthState.eclipseActive && view.target.lengthSq() < 1) view.goalTheta -= dt * 0.04;
      } else {
        // After a while with no input, drift slowly around the galaxy.
        if (idle && !journey) view.goalTheta -= dt * 0.05;
        // When far out, ease back to the centre so the galaxy stays framed.
        if (view.goalRadius > 10) view.goalTarget.multiplyScalar(Math.exp(-dt * 0.8));
      }

      if (nav.lookX || nav.lookY || nav.moveX || nav.moveZ) applyNav(dt);
      if (follow && follow.eclipse) {
        if (earth && world === 'earth') {
          const v = earth.eclipseView();
          view.goalTarget.copy(v.target);
          view.goalRadius = v.radius;
          view.goalPhi = v.phi;
          view.goalTheta = v.theta + Math.round((view.goalTheta - v.theta) / TAU) * TAU;
          clampGoals();
        }
      } else if (follow) {
        follow.obj.getWorldPosition(followPos);
        if (follow.face) { view.goalTarget.set(0, 0, 0); faceDirection(followPos); }
        else if (follow.fromEarth) { view.goalTarget.copy(followPos); faceDirection(followPos.clone().negate()); }
        else view.goalTarget.copy(followPos);
        clampGoals();
      }
      // Flying right into Sol takes you to Earth.
      if (world === 'galaxy' && !journey && lastSolDistance < 0.33) startJourney('earth', false);

      if (world === 'earth') updateEarthZoom();
      updateCamera(dt);
      updateDepthRange();
      zoomNow = zoomAmount(view.radius);

      const waveGoal = settings.extras.waves ? 1 : 0;
      shared.uWave.value += (waveGoal - shared.uWave.value) * (1 - Math.exp(-dt * 1.5));

      if (spinning) {
        // Slow the spin when you're close, so the stars don't slide away.
        // The Milky Way turns clockwise seen from above its north pole (+y).
        const speed = settings.galaxy.spinSpeed * (1 - 0.85 * zoomNow);
        galaxy.rotation.y = (galaxy.rotation.y - dt * speed) % TAU;
      }
      updateMeteors(dt);
    }

    // The camera's near and far planes follow the zoom, so the depth buffer
    // keeps its precision at every scale (sky.js: the scale system).
    function updateDepthRange() {
      const near = world === 'earth' ? clamp(view.radius * 0.004, 0.002, 50) : 0.01;
      const far = world === 'earth' ? Math.max(2000, ZE.farthest * 3, view.radius * 4) : 900;
      if (Math.abs(near - camera.near) > camera.near * 0.05 || Math.abs(far - camera.far) > camera.far * 0.05) {
        camera.near = near;
        camera.far = far;
        camera.updateProjectionMatrix();
      }
    }

    // If the frame rate stays low, render at a slightly lower resolution.
    let perfTime = 0;
    let perfFrames = 0;
    function watchPerformance(dt) {
      if (capture) return; // a video keeps its size
      perfTime += dt;
      perfFrames++;
      if (perfTime < 3) return;
      const avg = perfTime / perfFrames;
      if (avg > 1 / 36 && pixelRatio > 1) {
        pixelRatio = Math.max(1, pixelRatio - 0.25);
        applySize();
      }
      perfTime = 0;
      perfFrames = 0;
    }

    const activeScene = () => (world === 'earth' && earth ? earth.scene : scene);
    let last = performance.now();
    let mapFrame = 0;
    let frameErrors = 0;
    function frame(now) {
      let dt = (now - last) / 1000;
      last = now;
      // A hidden tab or a slow frame can produce a huge or odd gap; cap it.
      if (!(dt >= 0)) dt = 0;
      // (While a video records it follows the real clock, so a 60-second
      // tour makes a 60-second video even if the computer is slow.)
      else if (dt > (capture ? 0.5 : 0.1)) dt = capture ? 0.5 : 0.1;

      // Each part runs on its own, so one unexpected error can never stop
      // the animation (it's reported in the console a few times, then quiet).
      const run = (fn) => {
        try { fn(); } catch (err) { if (frameErrors++ < 5) console.error(err); }
      };
      run(() => step(dt));
      run(() => updateTimebar());
      if (cards) run(() => cards.update());
      if (world === 'earth' && earth) {
        run(() => { earthState = earth.update(dt, camera, { phase: shared.uPhase.value, ms: clock.now() }); });
        if (planets) run(() => { planets.opts.orbits = settings.extras.orbits; planets.opts.labels = settings.extras.labels; planets.update(dt, camera, clock.now()); });
        if (moons) run(() => { moons.opts.labels = settings.extras.labels; moons.opts.belts = settings.extras.belts; moons.update(dt, camera, clock.now()); });
      } else {
        run(() => { lastSolDistance = updateSolMarker(); });
        run(() => updateArmLabels(dt));
      }
      run(() => updateCaption(dt));
      run(() => updateRail());
      run(() => renderer.render(activeScene(), camera));
      if (capture) run(() => updateHud(dt));
      run(() => { mapFrame = (mapFrame + 1) % 2; if (mapFrame === 0) drawMap(); });
      run(() => watchPerformance(dt));
      if (!firstFrameShown) {
        firstFrameShown = true;
        const ld = $('#loading');
        ld.classList.add('done');
        setTimeout(() => { ld.hidden = true; }, 900);
      }
    }
    let firstFrameShown = false;

    // If the graphics driver resets (sleep, driver update, too many tabs),
    // Three.js re-uploads everything by itself once the browser restores it.
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      toast('Graphics paused by the browser. Restoring…');
    });
    canvas.addEventListener('webglcontextrestored', () => toast('Galaxy restored'));

    // ---- go ----
    applySize();
    buildGalaxy();
    const fontsReady = document.fonts && document.fonts.load
      ? Promise.race([
          document.fonts.load(LABEL_FONT).catch(() => null),
          new Promise((resolve) => setTimeout(resolve, 2500)),
        ])
      : Promise.resolve();
    fontsReady.then(() => {
      makeSolLabels(); // drawn once the real font is ready
      buildArmLabels();
    });

    if (configChangedNotice) toast('Using your latest changes from config.js');
    setStatus('Changes save automatically in this browser.');

    setTour(tourOn, { fade: false });
    last = performance.now();
    renderer.setAnimationLoop(frame);

    // Handy for experimenting in the browser console (and used by the tests):
    //   youAreHere.zoomTo(1.2)   youAreHere.goTo('sol')   youAreHere.planTour()
    window.youAreHere = {
      THREE, scene, camera, renderer, view, clock, sky: SKY,
      get settings() { return settings; },
      get zoom() { return zoomNow; },
      get captionText() { return captionTextEl.textContent; },
      zoomTo(r) { view.goalRadius = clamp(r, Z.closest, Z.farthest); setTour(false); },
      goTo: (dest) => goTo(dest),
      get following() {
        if (!follow) return null;
        if (follow.obj === solMarker) return 'sol-star';
        if (earth && follow.obj === earth.moon) return 'luna';
        if (earth && follow.obj === earth.sol) return 'sol';
        if (follow.planet) return follow.planet.id;
        return follow.face ? 'face' : 'point';
      },
      get world() { return world; },
      get journey() { return journey ? journey.stage : null; },
      get earthState() { return earthState; },
      get earth() { return earth; },
      get planets() { return planets; },
      get moons() { return moons; },
      get solPosition() { return solMarker.getWorldPosition(new THREE.Vector3()).toArray(); },
      journeyTo: (to) => startJourney(to, true),
      get tour() {
        const p = tourProgress();
        const st = tourPlan[tourIndex];
        return { on: tourOn, once: tourOnce, stop: st ? st.id : null, index: tourIndex, clock: tourClock, elapsed: p.elapsed, total: p.total, plan: tourPlan.map((x) => [x.id, +x.dur.toFixed(2)]) };
      },
      planTour: () => buildTourPlan().map((x) => [x.id, +x.dur.toFixed(2)]),
      playTour: (opts) => setTour(true, opts || {}),
      playForVideo: () => playForVideo(),
      get recording() { return recording ? (recording.playing ? 'playing' : 'countdown') : null; },
      get meteors() { return meteors.filter((m) => m.active).map((m) => m.headNow.toArray()); },
      get awake() { return { wanted: wakeWanted, held: !!wakeLock }; },
      get video() { return capture ? { W: capture.W, H: capture.H, type: capture.type, fade: capture.fade, ending: !!capture.ending } : null; },
      get lastVideo() { return lastVideo; },
      saveVideo: (format) => startVideo(format),
      setScale: (mode) => setScaleMode(mode, true),
      get cards() { return cards; },
      videoChoice: () => videoType(),
      eclipse: () => { userInput(); startEclipseView(); },
      shootingStar: spawnMeteor,
      // Fast-forward the simulation (seconds) without drawing, e.g. to
      // check that nothing drifts after hours of running.
      fastForward(seconds) {
        const n = Math.ceil(seconds / 0.1);
        for (let i = 0; i < n; i++) step(0.1);
        return { theta: view.theta, phase: shared.uPhase.value, spin: galaxy.rotation.y, tour: tourOn ? tourProgress().elapsed : 0, radius: view.radius };
      },
      stats() { return { ...renderer.info.memory, programs: renderer.info.programs.length, pixelRatio }; },
    };
  }
})();
