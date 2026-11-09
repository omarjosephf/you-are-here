/*  You Are Here: settings
    ------------------------------------------------------------------
    These are the defaults. Edit them here, save, then reload the page.

    You can also change the look and the tour inside the app (the pencil
    button, or press E). Those changes are saved in your browser. If you
    later edit a setting in this file, the app uses this file again for that
    setting and keeps your other in-app changes.
*/
window.YOU_ARE_HERE_CONFIG = {
  // The look of the galaxy. Its shape is the Milky Way's measured shape
  // (galaxy-model.js), so only the look can change here.
  galaxy: {
    count: 100000,           // number of stars (50,000 runs better on older laptops and phones)
    insideColor: "#ff6030",  // colour at the centre
    outsideColor: "#1b3984", // colour at the edges
    spinSpeed: 0.04,         // how fast the galaxy turns (0 = still)
  },

  // Extra touches. true = on, false = off. (Also switchable in the app.)
  extras: {
    waves: false,          // the galaxy ripples like ocean waves (O)
    shootingStars: true,   // a shooting star every few seconds around Earth (T for one now)
    navControls: true,     // the map (top left) and the arrow pads (bottom left)
    earthInTour: true,     // the tour visits the solar system (the Sun, every planet and Pluto) and comes back
    labels: true,          // names: the arms, the bar, the centre and the planets (N)
    orbits: true,          // the planets' orbit lines (B)
    cards: true,           // info cards with facts about what you go to
    belts: true,           // the asteroid belt and the Kuiper belt
    moving: true,          // "you are moving": how far you have travelled since opening the page
  },

  // The tour (the play button, or C). It flies through everything once in
  // this many seconds: anything from 30 (half a minute) to 600 (10 minutes).
  // Press V (or "Play for a video" in the editor) to play it once, full
  // screen, with no controls, ready to screen-record.
  tour: {
    seconds: 160,    // how long one whole tour takes (18 stops, so about 8 seconds each)
    repeat: true,    // start again when it ends (false = stop at the end)
  },

  // Zoom distances. Smaller numbers are closer to the stars.
  zoom: {
    start: 9,          // where the camera starts
    closest: 0.3,      // how close you can get
    farthest: 30,      // how far out you can go
  },

  startWithTour: true,    // start with the automatic camera tour
};
