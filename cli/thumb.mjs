// thumb.mjs — one-command KFTP YouTube thumbnail renderer.
//
// Reads a day's thumb.json and renders a 1280x720 PNG ready to upload.
//
// Why a browser and not ffmpeg: the house style (rounded cards, gradients,
// letter-spaced kickers, SVG chart furniture, icon chips) is trivial in CSS and
// either painful or impossible in a filtergraph. drawtext has no letter-spacing,
// no rounded rectangles and no layout engine — a first pass built that way spent
// its whole budget fighting the tool. Chrome is already on the box, renders the
// same Sequel 100 Black that the Canva originals used, and screenshots to an
// exact pixel size.
//
// usage:
//   node cli/thumb.mjs clips/2026-09-01/thumb.json
//   node cli/thumb.mjs …/thumb.json --theme crimson     (override the rotation)
//   node cli/thumb.mjs …/thumb.json --keep-html         (write the source next to the PNG)
//   node cli/thumb.mjs --list-themes
import { readFileSync, writeFileSync, existsSync, statSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { getTheme, themeForDate, themeNames } from "../lib/thumbthemes.mjs";

const W = 1280, H = 720;
const YT_MAX_BYTES = 2 * 1024 * 1024;   // YouTube rejects thumbnails over 2 MB

const args = process.argv.slice(2);
if (args.includes("--list-themes")) { console.log(themeNames().join("\n")); process.exit(0); }

const jsonPath = args.find((a) => !a.startsWith("--"));
if (!jsonPath) {
  console.error("usage: node cli/thumb.mjs <thumb.json> [--theme name] [--out file.png] [--keep-html]");
  console.error("       node cli/thumb.mjs --list-themes");
  process.exit(1);
}
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };

const specPath = resolve(jsonPath);
const spec = JSON.parse(readFileSync(specPath, "utf8"));
const dir = dirname(specPath);

// ---- theme selection ----
// Explicit --theme beats the file, the file beats the date rotation. The
// rotation is the normal path: it's what stops two episodes in a row from
// looking like the same video in a subscriptions feed.
const themeName = flag("--theme") ?? spec.theme ?? themeForDate(spec.date ?? isoToday());
const T = getTheme(themeName);

const outPath = resolve(flag("--out") ?? spec.out ?? join(dir, `thumb-${spec.date ?? "kftp"}.png`));

// ---- chrome ----
// Headless screenshot needs a Chromium. Edge ships on every Windows box, so the
// fallback list means this works on a machine with no Chrome install.
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);
const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chrome) {
  console.error("no Chrome/Edge found. Set CHROME_PATH to a Chromium binary.");
  process.exit(1);
}

// ---- html ----
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const headline = spec.headline ?? [];
// Accent the last line by default — that's the shape every Canva original used:
// the payoff word carries the colour.
const accentAt = spec.accentLine ?? headline.length - 1;
const headlineHtml = headline
  .map((line, i) => `<span class="${i === accentAt ? "accent" : ""}">${esc(line)}</span>`)
  .join("<br>");

const kicker = Array.isArray(spec.kicker) ? spec.kicker : spec.kicker ? [spec.kicker] : [];
// Last kicker line is the emphasised one; earlier lines are the setup.
const kickerHtml = kicker
  .map((line, i) => (i === kicker.length - 1 && kicker.length > 1 ? `<b>${esc(line)}</b>` : esc(line)))
  .join("<br>");

const cardsHtml = (spec.cards ?? [])
  .map((c) => {
    const tone = c.tone === "good" ? "yes" : "no";
    const rows = (c.rows ?? [])
      .map((r) => `<div class="row"><div class="ico ${tone}">${tone === "yes" ? "✓" : "✕"}</div>${esc(r)}</div>`)
      .join("");
    return `<div class="card ${c.tone === "good" ? "win" : ""}"><h2>${esc(c.title ?? "")}</h2>${rows}</div>`;
  })
  .join('<div class="eq">→</div>');

const pillsHtml = (spec.pills ?? [])
  .map((p) => `<div class="pill"><div class="n">${esc(p.n)}</div><div class="l">${esc(p.l)}</div></div>`)
  .join("");

// A faint candlestick field in the dead corner. Deterministic from the date so a
// re-render of the same episode is byte-stable; it's texture, not information.
const sticks = candlesticks(spec.date ?? "2026-01-01");

const html = `<meta charset="utf-8">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{width:${W}px;height:${H}px;overflow:hidden;background:${T.bg};
       font-family:'Segoe UI',system-ui,-apple-system,sans-serif;position:relative}
  .bg{position:absolute;inset:0;background:radial-gradient(900px 620px at 78% 42%,${T.glow} 0%,${mix(T.glow, T.bg)} 48%,${T.bg} 100%)}
  .grid{position:absolute;inset:0;opacity:.16;
        background-image:linear-gradient(${T.grid} 1px,transparent 1px),linear-gradient(90deg,${T.grid} 1px,transparent 1px);
        background-size:64px 64px;
        -webkit-mask-image:radial-gradient(700px 460px at 74% 46%,#000 30%,transparent 78%)}
  .sticks{position:absolute;left:-30px;bottom:-34px;opacity:${T.light ? ".10" : ".17"};fill:${T.watermark};stroke:${T.watermark}}
  .wrap{position:absolute;inset:0;display:flex;padding:46px 54px 40px;gap:30px}
  .left{width:446px;display:flex;flex-direction:column}
  .tick{width:66px;height:7px;background:${T.accent};border-radius:3px;margin-bottom:22px}
  h1{font-family:'Sequel100Black-65','Sequel100Black-55',Impact,'Arial Black',sans-serif;
     font-size:${spec.headlineSize ?? 93}px;line-height:.88;letter-spacing:.005em;
     color:${T.ink};text-transform:uppercase}
  h1 .accent{color:${T.accent}}
  .rule{display:flex;align-items:center;margin:26px 0 16px}
  .rule .bar{height:4px;width:352px;background:${T.accent};border-radius:2px}
  .rule .dot{width:15px;height:15px;border-radius:50%;border:3px solid ${T.accent};background:${T.bg};margin-left:-2px}
  .kick{font-size:20px;font-weight:700;letter-spacing:.115em;color:${T.sub};text-transform:uppercase;line-height:1.5}
  .kick b{color:${T.ink}}
  .brand{margin-top:auto;position:relative;z-index:2;font-size:15px;font-weight:800;
         letter-spacing:.20em;color:${T.faint};text-transform:uppercase}
  .right{flex:1;display:flex;flex-direction:column;justify-content:center;gap:22px}
  .cards{display:flex;align-items:stretch;gap:14px}
  .card{flex:1;background:${T.cardBg};border:2px solid ${T.cardBorder};border-radius:18px;
        padding:24px 22px;display:flex;flex-direction:column;box-shadow:0 18px 40px ${T.light ? "#0002" : "#0006"}}
  .card.win{border-color:${T.goodEdge}}
  .card h2{font-size:16px;font-weight:800;letter-spacing:.15em;text-transform:uppercase;color:${T.muted};margin-bottom:20px}
  .card.win h2{color:${T.goodInk}}
  .row{display:flex;align-items:center;gap:12px;font-size:21px;color:${T.light ? T.ink : "#D7E2F5"};
       margin-bottom:18px;line-height:1.2}
  .row:last-child{margin-bottom:0}
  .ico{flex:0 0 30px;height:30px;border-radius:50%;display:grid;place-items:center;
       font-size:17px;font-weight:900;color:${T.light ? "#fff" : T.bg}}
  .no{background:${T.bad}}.yes{background:${T.good}}
  .eq{display:grid;place-items:center;font-size:44px;color:${T.accent};font-weight:900;padding:0 2px}
  .pills{display:flex;gap:12px}
  .pill{flex:1;background:${T.cardBg};border:2px solid ${T.cardBorder};border-radius:14px;padding:14px;text-align:center}
  .pill .n{font-family:'Sequel100Black-65',Impact,'Arial Black',sans-serif;font-size:31px;color:${T.accent};line-height:1}
  .pill .l{font-size:12px;font-weight:800;letter-spacing:.13em;color:${T.muted};text-transform:uppercase;margin-top:6px}
  .tag{position:absolute;right:54px;bottom:20px;font-size:13px;font-weight:800;
       letter-spacing:.17em;color:${T.faint};text-transform:uppercase}
</style>
<div class="bg"></div><div class="grid"></div>
${sticks}
<div class="wrap">
  <div class="left">
    <div class="tick"></div>
    <h1>${headlineHtml}</h1>
    <div class="rule"><div class="bar"></div><div class="dot"></div></div>
    <div class="kick">${kickerHtml}</div>
    <div class="brand">${esc(spec.brand ?? "Kambio for the People")}</div>
  </div>
  <div class="right">
    ${cardsHtml ? `<div class="cards">${cardsHtml}</div>` : ""}
    ${pillsHtml ? `<div class="pills">${pillsHtml}</div>` : ""}
  </div>
</div>
${spec.tag === null ? "" : `<div class="tag">${esc(spec.tag ?? "Simulated paper account")}</div>`}
`;

const htmlPath = args.includes("--keep-html")
  ? outPath.replace(/\.png$/i, ".html")
  : join(tmpdir(), `kftp-thumb-${process.pid}.html`);
writeFileSync(htmlPath, html);

// ---- render ----
const r = spawnSync(chrome, [
  "--headless", "--disable-gpu", "--hide-scrollbars",
  "--force-device-scale-factor=1",
  "--virtual-time-budget=3000",          // let webfonts + layout settle before the grab
  `--screenshot=${outPath}`,
  `--window-size=${W},${H}`,
  htmlPath,
], { encoding: "utf8" });

if (!args.includes("--keep-html")) unlinkSync(htmlPath);
if (!existsSync(outPath)) {
  console.error(r.stderr || "chrome produced no screenshot");
  process.exit(1);
}

const bytes = statSync(outPath).size;
console.log(`✅ ${outPath}`);
console.log(`   ${W}x${H} · theme "${T.name}"${flag("--theme") || spec.theme ? "" : " (rotated from date)"} · ${(bytes / 1024).toFixed(0)} KB`);
if (bytes > YT_MAX_BYTES) console.log(`   ⚠ over YouTube's 2 MB limit — trim the artwork or re-encode`);

// ---- helpers ----
function isoToday() { return new Date().toISOString().slice(0, 10); }

/** Blend two hex colours evenly — used for the gradient's middle stop. */
function mix(a, b) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r1, g1, b1] = p(a), [r2, g2, b2] = p(b);
  const h = (n) => Math.round(n).toString(16).padStart(2, "0");
  return `#${h((r1 + r2) / 2)}${h((g1 + g2) / 2)}${h((b1 + b2) / 2)}`;
}

/** Seeded candlestick field. Same date in, same picture out. */
function candlesticks(seed) {
  let s = [...String(seed)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  let y = 150, wicks = "", bodies = "";
  for (let i = 0; i < 13; i++) {
    const x = 14 + i * 32;
    y = Math.max(34, Math.min(160, y - 4 + (rnd() - 0.35) * 34));
    const body = 24 + rnd() * 16, wick = body + 14 + rnd() * 12;
    wicks += `<path d="M${x} ${y - 8}v${wick}"/>`;
    bodies += `<rect x="${x - 7}" y="${y}" width="15" height="${body.toFixed(0)}" rx="2"/>`;
  }
  return `<svg class="sticks" width="560" height="250" viewBox="0 0 470 210">
  <g stroke-width="3" fill="none">${wicks}</g><g stroke="none">${bodies}</g></svg>`;
}
