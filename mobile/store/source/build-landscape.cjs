// Landscape (16:9, 1920x1080) Google Play screenshots for tablet, desktop and XR sections, from REAL captures of the web app
// (captures/land/<set>/<page>.png, taken at 1920x1080, 1280x720@1.5 and 960x540@2 against the demo restaurant).
//   node build-landscape.cjs [path-to-playwright-core]  -> ../screenshots/play-1.47-landscape/<set>/*.png
const path = require('path'); const fs = require('fs');
const { chromium } = require(process.argv[2] || 'playwright-core');
const HERE = __dirname; const OUT = path.join(HERE, '..', 'screenshots', 'play-1.47-landscape');
const LOGO = 'file://' + path.join(HERE, '..', '..', 'www', 'assets', 'logo.png');
const SHOTS = [
  ['01-dashboard', 'dashboard', "Today's sales", 'live', 'Revenue, orders, tables and the kitchen queue.'],
  ['02-pos', 'pos', 'Free restaurant POS', 'billing', 'Tap dishes, send the KOT, take payment.'],
  ['03-menu', 'menu', 'Your menu,', 'your prices', 'Categories, stations, tax, and pause a dish in one tap.'],
  ['04-tables', 'tables', 'Every table', 'at a glance', 'Live floor status, waitlist and guest QR ordering.'],
  ['05-kitchen', 'kds', 'Kitchen display', 'on any screen', 'Accept, prepare, mark ready.'],
  ['06-reports', 'reports', 'Reports', 'that explain it', 'Daily sales, popular items, tax. Export to Excel, PDF or CSV.'],
];
const html = (cap, img) => `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}
body{width:1920px;height:1080px;overflow:hidden;font-family:Lato,"Liberation Sans",sans-serif;color:#f7e9d7;
 background:radial-gradient(1100px 600px at 100% 0%,#0f6a70 0%,transparent 62%),linear-gradient(165deg,#064a4f 0%,#033d41 60%,#022c30 100%)}
.brand{position:absolute;left:70px;top:46px;display:flex;align-items:center;gap:16px;font-size:34px;font-weight:900}
.brand img{width:68px;height:68px;border-radius:50%}
.h{position:absolute;left:470px;top:34px}
.top{font-size:34px;font-weight:700;opacity:.95;line-height:1}
.big{font-size:68px;font-weight:900;letter-spacing:-.02em;text-transform:uppercase;color:#ffd9a8;line-height:1.05}
.sub{position:absolute;right:70px;top:62px;width:760px;text-align:right;font-size:30px;line-height:1.25;opacity:.92}
.shot{position:absolute;left:50%;transform:translateX(-50%);top:236px;height:800px;border-radius:22px;overflow:hidden;box-shadow:0 30px 70px rgba(0,0,0,.5),0 0 0 3px rgba(247,233,215,.14)}
.shot img{display:block;height:100%}
</style></head><body>
<div class="brand"><img src="${LOGO}" alt="">OrderRestro</div>
<div class="h"><div class="top">${cap[0]}</div><div class="big">${cap[1]}</div></div><div class="sub">${cap[2]}</div>
<div class="shot"><img src="file://${img}"></div></body></html>`;
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  for (const set of ['desktop', 'tablet10', 'tablet7']) {
    fs.mkdirSync(path.join(OUT, set), { recursive: true });
    for (const [file, cap, top, big, sub] of SHOTS) {
      const f = path.join(HERE, '.tmp-land.html');
      fs.writeFileSync(f, html([top, big, sub], path.join(HERE, 'captures', 'land', set, cap + '.png')));
      await p.goto('file://' + f); await p.waitForTimeout(250);
      await p.screenshot({ path: path.join(OUT, set, file + '.png') });
    }
  }
  fs.unlinkSync(path.join(HERE, '.tmp-land.html')); await b.close(); console.log('built landscape sets');
})();
