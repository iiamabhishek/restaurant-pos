// Builds the Google Play screenshots (1080x1920, 9:16) and feature graphic (1024x500) from REAL app captures.
// Captures in ./captures are unedited screenshots of the running app (phone POS in Chrome at 390x844 @2.77x,
// server screens from the web app inside the app shell). Only the frame, background and caption are added here.
//
//   node build.cjs [path-to-playwright-core]     -> ../screenshots/play-1.47/*.png and ../feature-graphic-1024x500.png
//
// Edit the SHOTS list to change captions. Captions must describe what the capture really shows.
const path = require('path');
const fs = require('fs');
const { chromium } = require(process.argv[2] || 'playwright-core');

const HERE = __dirname;
const OUT = path.join(HERE, '..', 'screenshots', 'play-1.47');
const SERVER = 'With your OrderRestro server';

const SHOTS = [
  { file: '01-take-orders', img: 'phone-sell.png', top: 'Free restaurant POS', big: 'in seconds', sub: 'Tap dishes, pick the table, send the KOT.' },
  { file: '02-payments', img: 'phone-pay-upi.png', top: 'Restaurant billing:', big: 'UPI QR', sub: 'Cash, card or UPI, with the exact amount.' },
  { file: '03-tables', img: 'phone-tables.png', top: 'Every table', big: 'at a glance', sub: 'Open orders, totals and minutes waiting.' },
  { file: '04-offline', img: 'phone-sales-offline.png', top: 'Restaurant app that sells with', big: 'no internet', sub: 'Sales wait on the phone and sync later.' },
  { file: '05-kitchen', img: 'server-kds.png', top: 'Kitchen display', big: 'on any phone', sub: 'Accept, prepare, mark ready.', tag: SERVER },
  { file: '06-low-stock', img: 'server-low-stock.png', top: 'Get notified of', big: 'low stock', sub: 'An alert when stock reaches its reorder level.', tag: SERVER },
  { file: '07-dashboard', img: 'server-dashboard.png', top: "Today's sales", big: 'live', sub: 'Revenue, orders, tables and the kitchen queue.', tag: SERVER },
];

const BG = 'radial-gradient(900px 700px at 100% 0%,#0f6a70 0%,transparent 62%),linear-gradient(165deg,#064a4f 0%,#033d41 60%,#022c30 100%)';
const LOGO = 'file://' + path.join(HERE, '..', '..', 'www', 'assets', 'logo.png');
const css = `
*{box-sizing:border-box;margin:0}
body{width:1080px;height:1920px;overflow:hidden;font-family:Lato,"Liberation Sans",sans-serif;color:#f7e9d7;background:${BG}}
.brand{position:absolute;left:72px;top:60px;display:flex;align-items:center;gap:20px;font-size:38px;font-weight:900;letter-spacing:-.01em}
.brand img{width:76px;height:76px;border-radius:50%}
.tag{position:absolute;right:72px;top:70px;padding:10px 22px;border-radius:999px;background:rgba(247,233,215,.14);border:2px solid rgba(247,233,215,.4);font-size:26px;font-weight:700}
.head{position:absolute;left:72px;right:72px;top:176px}
.top{font-size:54px;font-weight:700;line-height:1.05;opacity:.95}
.big{font-size:104px;font-weight:900;line-height:1;letter-spacing:-.02em;text-transform:uppercase;color:#ffd9a8}
.sub{margin-top:14px;font-size:34px;line-height:1.25;opacity:.92}
.phone{position:absolute;left:50%;transform:translateX(-50%);top:486px;height:1384px;border-radius:64px;background:#0b0b0b;padding:14px;box-shadow:0 36px 80px rgba(0,0,0,.5),0 0 0 3px rgba(247,233,215,.12)}
.phone img{display:block;height:100%;border-radius:50px}
`;

function shotHtml(s) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
  <div class="brand"><img src="${LOGO}" alt="">OrderRestro</div>${s.tag ? `<div class="tag">${s.tag}</div>` : ''}
  <div class="head"><div class="top">${s.top}</div><div class="big">${s.big}</div><div class="sub">${s.sub}</div></div>
  <div class="phone"><img src="file://${path.join(HERE, 'captures', s.img)}"></div></body></html>`;
}

const featureHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}
body{width:1024px;height:500px;overflow:hidden;font-family:Lato,"Liberation Sans",sans-serif;color:#f7e9d7;
  background:radial-gradient(520px 420px at 100% 0%,#0f6a70 0%,transparent 65%),linear-gradient(160deg,#064a4f 0%,#033d41 70%,#022c30 100%)}
.t{position:absolute;left:56px;top:78px;width:440px}
.t img{width:84px;height:84px;border-radius:50%;margin-bottom:22px}
h1{font-size:60px;font-weight:900;letter-spacing:-.02em;line-height:1}
p{margin-top:16px;font-size:29px;line-height:1.3;opacity:.95}
p b{color:#ffd9a8;font-weight:900}
.phones{position:absolute;right:44px;top:34px;display:flex;gap:16px}
.phone{height:432px;border-radius:34px;background:#0b0b0b;padding:8px;box-shadow:0 20px 44px rgba(0,0,0,.5),0 0 0 2px rgba(247,233,215,.12)}
.phone img{display:block;height:100%;border-radius:26px}
</style></head><body>
<div class="t"><img src="${LOGO}" alt=""><h1>OrderRestro</h1>
<p>Free restaurant POS app: billing, KOT and tables. <b>Works with no internet.</b></p></div>
<div class="phones"><div class="phone"><img src="file://${path.join(HERE, 'captures', 'phone-sell.png')}"></div><div class="phone"><img src="file://${path.join(HERE, 'captures', 'phone-tables.png')}"></div></div></body></html>`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
  for (const s of SHOTS) {
    const html = path.join(HERE, `.tmp-${s.file}.html`);
    fs.writeFileSync(html, shotHtml(s));
    await p.goto(`file://${html}`);
    await p.waitForTimeout(200);
    await p.screenshot({ path: path.join(OUT, `${s.file}.png`) });
    fs.unlinkSync(html);
  }
  await p.setViewportSize({ width: 1024, height: 500 });
  const fh = path.join(HERE, '.tmp-feature.html');
  fs.writeFileSync(fh, featureHtml);
  await p.goto(`file://${fh}`);
  await p.waitForTimeout(200);
  await p.screenshot({ path: path.join(HERE, '..', 'feature-graphic-1024x500.png') });
  fs.unlinkSync(fh);
  await b.close();
  console.log('built', SHOTS.length, 'screenshots + feature graphic');
})();
