// Saves the tour as a video at both sizes (widescreen and phone) with a
// 30-second tour, and checks a file came out of each. Uses the browser's
// own recorder, so the format is what this Chrome picks (on Linux and in
// headless runs usually WebM; the MP4 crash fallback is only exercised on
// Windows or macOS with a real screen).
//   CHROME_PATH=<path to Chrome> node video-check.js
const { open } = require('./harness');
let failed = 0;
const say = (ok, msg) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

(async () => {
  const { browser, page, errors } = await open({ executablePath: process.env.CHROME_PATH || undefined });
  try {
    const choice = await page.evaluate(() => window.youAreHere.videoChoice());
    console.log('INFO  recorder choice:', JSON.stringify(choice));
    for (const format of ['wide', 'tall']) {
      await page.evaluate((f) => { const y = window.youAreHere; y.settings.tour.seconds = 30; y.saveVideo(f); }, format);
      const dims = await page.evaluate(() => window.youAreHere.video);
      await page.waitForFunction(() => !window.youAreHere.video, null, { timeout: 15 * 60 * 1000 });
      const v = await page.evaluate(() => window.youAreHere.lastVideo);
      say(dims && v && v.bytes > 50000, `${format}: ${dims ? dims.W + ' x ' + dims.H : '?'}, ${v ? (v.bytes / 1e6).toFixed(2) + ' MB ' + v.type : 'no file'}`);
    }
  } catch (err) {
    errors.push('test: ' + err.message);
  } finally {
    await browser.close();
  }
  for (const e of errors) { failed++; console.log('FAIL  ' + e); }
  console.log(failed ? `${failed} VIDEO CHECK(S) FAILED` : 'ALL VIDEO CHECKS PASSED');
  process.exit(failed ? 1 : 0);
})();
