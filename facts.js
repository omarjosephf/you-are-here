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
