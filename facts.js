/*  You Are Here: facts.js
    ------------------------------------------------------------------
    The facts on the info cards. Every figure is from a cited source
    (SOURCES.md, and PLAN.md section 6):
      NASA Planetary Fact Sheet (updated 18 March 2025) and its notes;
      NASA Sun Fact Sheet (9 May 2024) and Sun facts; NASA Moon Fact Sheet
      (11 January 2024); NASA Mercury facts; moon counts from NASA and the
      Minor Planet Center (as of 9 November 2026); IAU 2006 Resolutions
      B5 and B6; Reid et al. 2019; GRAVITY Collaboration 2022; NASA/JPL 2008;
      the Orion Arm figures; Wegg et al. 2015 and Bland-Hawthorn & Gerhard
      2016 for the bar.
    Values in brackets are arithmetic from those figures (hours to days,
    days to years). Live values (distances, light time, constellation) are
    worked out in main.js from Astronomy Engine for the clock's date.
*/
window.YouAreHereFacts = {
  asOf: '9 November 2026',
  // Galaxy landmarks (stage 8): galactic longitude and latitude from SIMBAD;
  // distances from the Sun with their uncertainty (SOURCES.md). 1 pc =
  // 3.2616 light-years. sure: how well the distance is known.
  landmarks: [
    { id: 'gc', name: 'Sagittarius A*', l: 359.944, b: -0.046, kpc: 8.178, dist: '26,700 light-years (8,178 ± 26 pc)', source: 'GRAVITY Collaboration 2019', sure: 'Well measured (about 0.3%)', what: 'The black hole at the galactic centre' },
    { id: 'orion', name: 'Orion Nebula', l: 209.010, b: -19.382, kpc: 0.388, dist: '1,270 light-years (388 ± 5 pc)', source: 'Kounkel et al. 2017 (VLBA); other measurements give 403 to 414 pc', sure: 'Well measured, though methods differ by about 6%', what: 'A star-forming nebula' },
    { id: 'pleiades', name: 'Pleiades', l: 166.463, b: -23.615, kpc: 0.1362, dist: '444 light-years (136.2 ± 1.2 pc)', source: 'Melis et al. 2014 (VLBI)', sure: 'Well measured (about 1%)', what: 'A young star cluster' },
    { id: 'hyades', name: 'Hyades', l: 179.628, b: -21.124, kpc: 0.0473, dist: '154 light-years (about 47.3 pc)', source: 'Gaia DR3 (Hunt & Reffert 2023)', sure: 'Well measured', what: 'An open star cluster' },
    { id: 'crab', name: 'Crab Nebula', l: 184.555, b: -5.783, kpc: 1.90, dist: '6,200 light-years (1.90 +0.22/−0.18 kpc)', source: 'Lin et al. 2023 (pulsar parallax)', sure: 'Uncertain by 10 to 20%', what: 'The remains of an exploded star, with a pulsar at its centre' },
    { id: 'eagle', name: 'Eagle Nebula', l: 16.962, b: 0.811, kpc: 1.70, dist: 'about 5,500 light-years (about 1.7 kpc)', source: 'Gaia DR3 (Hunt & Reffert 2023)', sure: 'Good to a few per cent', what: 'A star-forming nebula' },
    { id: 'lagoon', name: 'Lagoon Nebula', l: 5.958, b: -1.167, kpc: 1.28, dist: '4,000 to 4,400 light-years (1.23 to 1.34 kpc)', source: 'Gaia DR3 and DR2', sure: 'Uncertain by about 8% (two Gaia releases differ)', what: 'A star-forming nebula' },
    { id: 'carina', name: 'Carina Nebula', l: 287.602, b: -0.645, kpc: 2.35, dist: '7,700 light-years (2.35 ± 0.05 kpc)', source: 'Göppl & Preibisch 2022 (Gaia EDR3)', sure: 'Good to a few per cent', what: 'A star-forming region' },
    { id: 'omega', name: 'Omega Centauri', l: 309.102, b: 14.968, kpc: 5.43, dist: '17,700 light-years (5.43 ± 0.05 kpc)', source: 'Baumgardt & Vasiliev 2021', sure: 'Well measured (about 1%)', what: 'A globular cluster, well above the galaxy’s disc' },
  ],
  // The Pale Blue Dot (stage 8). Time: NASA. Position: JPL Horizons.
  paleBlueDot: {
    ms: Date.UTC(1990, 1, 14, 4, 48),
    helioEclipticAU: [-15.7416, -30.0575, 21.8572], // x, y, z, J2000 ecliptic (JPL Horizons, target -31)
    name: 'The Pale Blue Dot', kind: 'Voyager 1, 14 February 1990',
    facts: [
      ['When', '04:48 GMT on 14 February 1990, 34 minutes before Voyager 1 turned its cameras off for good (NASA)'],
      ['Where Voyager 1 was', 'about 6 billion km from Earth and 40.4 AU from the Sun, 32.8° above the plane of the planets (JPL Horizons)'],
    ],
    link: ['Carl Sagan’s words about it (The Planetary Society)', 'https://www.planetary.org/worlds/pale-blue-dot'],
  },

  bodies: {
    sun: {
      name: 'The Sun', kind: 'Our star',
      facts: [
        ['Diameter', '1,391,400 km (109 Earths)'],
        ['Gravity at the surface', '274 m/s² (28 times Earth’s)'],
        ['Turns once in', 'about 25 days at its equator and 36 days near its poles: it is not solid'],
        ['Tilt to Earth’s orbit', '7.25°'],
        ['Temperature', 'about 5,772 K at the visible surface; about 15.7 million K at the centre'],
      ],
    },
    mercury: {
      name: 'Mercury', kind: 'Planet',
      facts: [
        ['Diameter', '4,879 km'],
        ['Turns once in', '58.6 Earth days (1,407.6 hours)'],
        ['One day (sunrise to sunrise)', '176 Earth days'],
        ['Tilt', '0.034°'],
        ['Gravity', '3.7 m/s²'],
        ['Temperature', 'up to about 430°C by day, down to about −180°C at night (the average, 167°C, is true almost nowhere)'],
        ['Known moons', '0'],
        ['One orbit', '88 Earth days'],
      ],
    },
    venus: {
      name: 'Venus', kind: 'Planet',
      facts: [
        ['Diameter', '12,104 km'],
        ['Turns once in', '243 Earth days, backwards (5,832.5 hours)'],
        ['One day (sunrise to sunrise)', '117 Earth days'],
        ['Tilt', '177.4° (upside down, so it spins backwards)'],
        ['Gravity', '8.9 m/s²'],
        ['Mean temperature', '464°C'],
        ['Known moons', '0'],
        ['One orbit', '224.7 Earth days'],
      ],
      note: 'Seen here: its cloud tops, which hide the surface.',
    },
    earth: {
      name: 'Earth', kind: 'Planet (you are here)',
      facts: [
        ['Diameter', '12,756 km'],
        ['Turns once in', '23.9 hours'],
        ['Tilt', '23.4°, which gives us the seasons'],
        ['Gravity', '9.8 m/s²'],
        ['Mean temperature', '15°C'],
        ['Known moons', '1'],
        ['One orbit', '365.2 days, at about 29.8 km/s'],
      ],
    },
    moon: {
      name: 'Luna, the Moon', kind: 'Earth’s moon',
      facts: [
        ['Diameter', '3,474.8 km'],
        ['Turns once in', '27.3 days, the same time it takes to go round Earth, so one face always points at us'],
        ['From new moon to new moon', '29.53 days'],
        ['Gravity', '1.62 m/s² (about a sixth of Earth’s)'],
        ['Temperature at its equator', 'from about −178°C at night to 117°C by day'],
        ['Average distance from Earth', '384,400 km'],
      ],
    },
    mars: {
      name: 'Mars', kind: 'Planet',
      facts: [
        ['Diameter', '6,792 km'],
        ['Turns once in', '24.6 hours'],
        ['Tilt', '25.2°'],
        ['Gravity', '3.7 m/s²'],
        ['Mean temperature', '−65°C'],
        ['Known moons', '2'],
        ['One orbit', '687 Earth days'],
      ],
    },
    jupiter: {
      name: 'Jupiter', kind: 'Planet (gas giant)',
      facts: [
        ['Diameter', '142,984 km (11 Earths)'],
        ['Turns once in', '9.9 hours'],
        ['Tilt', '3.1°'],
        ['Gravity', '23.1 m/s², where the pressure is 1 bar (it has no solid surface)'],
        ['Mean temperature', '−110°C, at the 1-bar level'],
        ['Known moons', '115 (as of 9 November 2026)'],
        ['One orbit', '11.9 Earth years (4,331 days)'],
      ],
    },
    saturn: {
      name: 'Saturn', kind: 'Planet (gas giant)',
      facts: [
        ['Diameter', '120,536 km'],
        ['Turns once in', '10.7 hours'],
        ['Tilt', '26.7°'],
        ['Gravity', '9.0 m/s², at the 1-bar level (no solid surface)'],
        ['Mean temperature', '−140°C, at the 1-bar level'],
        ['Known moons', '293 (as of 9 November 2026)'],
        ['One orbit', '29.4 Earth years (10,747 days)'],
      ],
    },
    uranus: {
      name: 'Uranus', kind: 'Planet (ice giant)',
      facts: [
        ['Diameter', '51,118 km'],
        ['Turns once in', '17.2 hours, backwards'],
        ['Tilt', '97.8°: it rolls around the Sun on its side'],
        ['Gravity', '8.7 m/s², at the 1-bar level'],
        ['Mean temperature', '−195°C, at the 1-bar level'],
        ['Known moons', '29 (as of 9 November 2026)'],
        ['One orbit', '83.7 Earth years (30,589 days)'],
      ],
      note: 'Its surface map is nearly featureless artistic banding.',
    },
    neptune: {
      name: 'Neptune', kind: 'Planet (ice giant)',
      facts: [
        ['Diameter', '49,528 km'],
        ['Turns once in', '16.1 hours'],
        ['Tilt', '28.3°'],
        ['Gravity', '11.0 m/s², at the 1-bar level'],
        ['Mean temperature', '−200°C, at the 1-bar level'],
        ['Known moons', '16 (as of 9 November 2026)'],
        ['One orbit', '163.7 Earth years (59,800 days)'],
      ],
      note: 'Its surface map is artistic, and shows a dark spot seen in 1989 that has since gone.',
    },
    pluto: {
      name: 'Pluto', kind: 'Dwarf planet (IAU, 2006)',
      facts: [
        ['Diameter', '2,376 km'],
        ['Turns once in', '6.4 Earth days, backwards (153.3 hours)'],
        ['Tilt', '119.5°'],
        ['Gravity', '0.7 m/s²'],
        ['Mean temperature', '−225°C'],
        ['Known moons', '5 (as of 9 November 2026)'],
        ['One orbit', '247.9 Earth years (90,560 days)'],
      ],
      note: 'Its map is grey (New Horizons, 2015), tinted here; the south was in darkness and was never photographed.',
    },
  },
  galaxy: {
    centre: {
      name: 'The galactic centre', kind: 'Sagittarius A*',
      facts: [
        ['What is there', 'a black hole of about 4.3 million Suns (4.297 ± 0.012 million, GRAVITY 2022)'],
        ['How far', 'about 26,600 to 27,000 light-years (8.15 to 8.28 kpc, depending on the measurement)'],
        ['Seen from Earth', 'in the constellation Sagittarius'],
      ],
    },
    bar: {
      name: 'The central bar', kind: 'A bar of old stars',
      facts: [
        ['Length', 'about 5 kpc (16,000 light-years) from the centre to each end, though its length is still debated (3.5 to 5 kpc)'],
        ['Angle', 'about 30° to the line from the Sun to the centre, with its nearer end at positive galactic longitude'],
      ],
    },
    major: {
      kind: 'Major arm',
      facts: [['What is in it', 'the greatest densities of young, bright stars (NASA/JPL)']],
    },
    minor: {
      kind: 'Minor arm',
      facts: [['What is in it', 'mostly gas and pockets of young stars (NASA/JPL)']],
    },
    orion: {
      name: 'The Orion Arm', kind: 'Our home arm (the Local Arm)',
      facts: [
        ['Size', 'about 3,500 light-years wide and 20,000 light-years long'],
        ['Where we are', 'the Sun sits near its inner edge, about halfway along it'],
        ['Major or minor?', 'usually called a minor arm, but parallax surveys find it longer than once thought, with a pitch and star formation like the major arms'],
      ],
    },
    sol: {
      name: 'Sol, our Sun', kind: 'Our star, seen from across the galaxy',
      facts: [
        ['From the centre', 'about 26,600 light-years (8.15 ± 0.15 kpc, Reid et al. 2019)'],
        ['Speed around the galaxy', 'about 247 km/s'],
        ['One trip around', 'about 200 million years'],
      ],
    },
  },
};
