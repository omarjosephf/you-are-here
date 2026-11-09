/*  You Are Here: cards.js
    ------------------------------------------------------------------
    Info cards (real HTML, so screen readers can read them) for the Sun,
    the planets, Pluto, the Moon and the galaxy's features, with live values
    for the clock's date: distance from Earth and from the Sun, how long
    light takes, and the constellation it appears in. Also the two compare
    panels: the size line-up (true relative sizes) and the light-time ladder.

    Facts: facts.js (each cited). Live values: Astronomy Engine via sky.js.
    The speed of light is exact by definition: 299,792.458 km/s (SI).
*/
window.YouAreHereCards = {
  create(env) {
    'use strict';
    const { SKY, $ } = env;
    const FACTS = window.YouAreHereFacts;
    const C_KM_S = 299792.458;
    const BODY_NAMES = { sun: 'Sun', mercury: 'Mercury', venus: 'Venus', earth: 'Earth', moon: 'Moon', mars: 'Mars', jupiter: 'Jupiter', saturn: 'Saturn', uranus: 'Uranus', neptune: 'Neptune', pluto: 'Pluto' };
    const cardEl = $('#card');
    const titleEl = $('#cardTitle');
    const kindEl = $('#cardKind');
    const factsEl = $('#cardFacts');
    const liveEl = $('#cardLive');
    const noteEl = $('#cardNote');
    let current = null;
    let liveAt = 0;

    function fill(dl, rows) {
      dl.textContent = '';
      for (const [k, v] of rows) {
        const dt = document.createElement('dt');
        dt.textContent = k;
        const dd = document.createElement('dd');
        dd.textContent = v;
        dl.append(dt, dd);
      }
    }
    function fmtKm(km) {
      if (km < 1e6) return `${Math.round(km).toLocaleString()} km`;
      if (km < 1e9) return `${(km / 1e6).toLocaleString(undefined, { maximumFractionDigits: 1 })} million km`;
      return `${(km / 1e9).toLocaleString(undefined, { maximumFractionDigits: 2 })} billion km`;
    }
    function fmtAU(au) { return `${au.toLocaleString(undefined, { maximumFractionDigits: au < 10 ? 3 : 2 })} AU`; }
    function fmtLight(sec) {
      if (sec < 60) return `${sec.toFixed(sec < 10 ? 2 : 1)} seconds`;
      if (sec < 3600) { const m = Math.floor(sec / 60); return `${m} min ${Math.round(sec - m * 60)} s`; }
      const h = Math.floor(sec / 3600); return `${h} h ${Math.round((sec - h * 3600) / 60)} min`;
    }

    // key: a body id (sun, mercury ... pluto, earth, moon) or a galaxy
    // feature (centre, bar, orion, sol, or an arm: { arm, name, major }).
    function show(key, arm) {
      let f = null;
      if (arm && arm.landmark) {
        const m = arm.landmark;
        f = { name: m.name, kind: 'Landmark in the galaxy', galaxy: true, note: `Source: ${m.source}.`,
          facts: [['What it is', m.what], ['Distance from the Sun', m.dist], ['How sure', m.sure], ['Seen from Earth', `in ${SKY.constellationOf(SKY.galacticToScene(m.l, m.b))}`]] };
      } else if (arm) {
        const g = FACTS.galaxy[arm.major ? 'major' : 'minor'];
        f = { name: arm.name, kind: g.kind, facts: g.facts, galaxy: true };
      } else if (key === 'paleBlueDot') {
        f = Object.assign({ galaxy: true }, FACTS.paleBlueDot);
      } else if (FACTS.bodies[key]) f = FACTS.bodies[key];
      else if (FACTS.galaxy[key]) f = Object.assign({ galaxy: true }, FACTS.galaxy[key]);
      if (!f) { hide(); return; }
      current = { key, f };
      kindEl.textContent = f.kind || '';
      titleEl.textContent = f.name || '';
      fill(factsEl, f.facts || []);
      noteEl.textContent = f.note || '';
      if (f.link) {
        const a = document.createElement('a');
        a.href = f.link[1];
        a.textContent = f.link[0];
        a.target = '_blank';
        a.rel = 'noopener';
        if (f.note) noteEl.append(document.createTextNode(' '));
        noteEl.append(a);
      }
      noteEl.hidden = !f.note && !f.link;
      liveEl.hidden = !!f.galaxy;
      cardEl.hidden = false;
      cardEl.setAttribute('aria-label', `${f.name}: facts`);
      liveAt = 0;
      update(true);
    }
    function hide() { current = null; cardEl.hidden = true; }

    // Live values for the clock's date (twice a second at most).
    function update(force) {
      if (!current || current.f.galaxy) return;
      const now = performance.now();
      if (!force && now - liveAt < 500) return;
      liveAt = now;
      const ms = env.clock.now();
      const key = current.key;
      const rows = [];
      const body = BODY_NAMES[key];
      if (key !== 'earth') {
        const g = SKY.geoVector(body, ms);
        const km = SKY.len3(g) * SKY.AU_KM;
        rows.push(['From Earth', key === 'moon' ? fmtKm(km) : `${fmtAU(SKY.len3(g))} (${fmtKm(km)})`]);
        rows.push([key === 'sun' ? 'Sunlight reaches Earth in' : 'Its light reaches Earth in', fmtLight(km / C_KM_S)]);
        rows.push(['In Earth’s sky', `in ${SKY.constellationOf(g, ms)}`]);
      }
      if (key !== 'sun' && key !== 'moon') {
        const h = SKY.helioVector(body, ms);
        rows.push(['From the Sun', `${fmtAU(SKY.len3(h))} (${fmtKm(SKY.len3(h) * SKY.AU_KM)})`]);
        if (key === 'earth') rows.push(['Sunlight takes', fmtLight((SKY.len3(h) * SKY.AU_KM) / C_KM_S)]);
      }
      rows.push(['On', env.fmtDay(ms)]);
      fill(liveEl, rows);
    }

    // ---- compare panels ----------------------------------------------------
    const cmpEl = $('#compare');
    const cmpTitle = $('#compareTitle');
    const cmpBody = $('#compareBody');
    const cmpNote = $('#compareNote');
    const SVG = 'http://www.w3.org/2000/svg';
    const el = (name, attrs, text) => {
      const e = document.createElementNS(SVG, name);
      for (const k of Object.keys(attrs)) e.setAttribute(k, attrs[k]);
      if (text !== undefined) e.textContent = text;
      return e;
    };
    // Diameters (km): NASA fact sheets.
    const SIZES = [['Mercury', 4879], ['Venus', 12104], ['Earth', 12756], ['Mars', 6792], ['Jupiter', 142984], ['Saturn', 120536], ['Uranus', 51118], ['Neptune', 49528], ['Pluto', 2376]];
    function sizeLineup() {
      cmpTitle.textContent = 'Size line-up';
      cmpBody.textContent = '';
      const H = 210;
      const jupR = 70; // Jupiter's radius on screen, px
      const k = jupR / (142984 / 2);
      const sunR = 1391400 / 2 * k;
      let x = 40;
      const items = [];
      for (const [name, d] of SIZES) {
        const r = Math.max(0.8, (d / 2) * k);
        x += r + 10;
        items.push({ name, d, r, x });
        x += r + 10;
      }
      const W = Math.ceil(x + 10);
      const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': 'The planets and Pluto side by side at their true relative sizes, with the edge of the Sun on the left.' });
      svg.append(el('circle', { cx: 18 - sunR, cy: H / 2 - 10, r: sunR, fill: '#ffcf7a', opacity: '0.9' }));
      items.forEach((it, i) => {
        svg.append(el('circle', { cx: it.x, cy: H / 2 - 10, r: it.r, fill: env.colorOf(it.name.toLowerCase()) }));
        // Small neighbours take turns above and below, so names don't overlap.
        const low = it.r > 20 || i % 2 === 0;
        svg.append(el('text', { x: it.x, y: low ? H - 14 : H - 30, 'text-anchor': 'middle', class: 'cmp-label' }, it.name));
      });
      svg.append(el('text', { x: 24, y: 16, class: 'cmp-label' }, 'The Sun’s edge'));
      cmpBody.append(svg);
      cmpNote.textContent = 'True relative sizes (diameters from NASA’s fact sheets). The Sun is 109 times as wide as Earth: only its edge fits on the left.';
    }
    function lightLadder() {
      cmpTitle.textContent = 'Light-time ladder';
      cmpBody.textContent = '';
      const ms = env.clock.now();
      const rows = ['Moon', 'Sun', 'Venus', 'Mercury', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto'].map((b) => {
        const km = SKY.len3(SKY.geoVector(b, ms)) * SKY.AU_KM;
        return { name: b === 'Moon' ? 'The Moon' : b === 'Sun' ? 'The Sun' : b, sec: km / C_KM_S };
      });
      for (const extra of env.ladderExtras ? env.ladderExtras(ms) : []) rows.push(extra);
      rows.sort((a, b) => a.sec - b.sec);
      const lo = Math.log10(1);
      const hi = Math.log10(Math.max(...rows.map((r) => r.sec)) * 1.2);
      const list = document.createElement('ol');
      list.className = 'ladder';
      for (const r of rows) {
        const li = document.createElement('li');
        const name = document.createElement('span');
        name.className = 'ladder-name';
        name.textContent = r.name;
        const bar = document.createElement('span');
        bar.className = 'ladder-bar';
        bar.style.setProperty('--w', `${Math.max(2, ((Math.log10(Math.max(1, r.sec)) - lo) / (hi - lo)) * 100).toFixed(1)}%`);
        const t = document.createElement('span');
        t.className = 'ladder-time';
        t.textContent = r.label || fmtLight(r.sec);
        li.append(name, bar, t);
        list.append(li);
      }
      cmpBody.append(list);
      cmpNote.textContent = `How long light takes to reach Earth from each, on ${env.fmtDay(ms)} (distances from Astronomy Engine; light travels 299,792 km a second). The bars use a log scale: each step is ten times further.`;
    }
    function openCompare(which) {
      if (which === 'sizes') sizeLineup(); else lightLadder();
      cmpEl.hidden = false;
      cmpEl.dataset.which = which;
      const close = $('#compareClose');
      if (close) close.focus({ preventScroll: true });
    }
    function closeCompare() { cmpEl.hidden = true; }

    $('#cardClose').addEventListener('click', hide);
    $('#compareClose').addEventListener('click', closeCompare);

    return {
      show, hide, update, openCompare, closeCompare,
      get current() { return current ? current.key : null; },
      get open() { return !cardEl.hidden; },
      get compareOpen() { return !cmpEl.hidden; },
      fmtLight,
    };
  },
};
