// transcribe.mjs — word-level Whisper for the Descript-style text editor.
// Emits: <name>.words.json (timing) · <name>.script.txt (edit surface) · <name>.srt (karaoke).
// (<name> = clip basename minus a trailing "-raw".)
//
// usage: node transcribe.mjs clips/2026-07-09/flat-exit-raw.mp4
import { writeFileSync } from "node:fs";
import { dirname, basename, resolve, join } from "node:path";
import { runWordWhisper } from "./cutlib.mjs";

const clipRel = process.argv[2];
if (!clipRel) { console.error("usage: node transcribe.mjs <clip>"); process.exit(1); }
const clip = resolve(clipRel);
const dir = dirname(clip);
const name = basename(clip).replace(/\.[^.]+$/, "").replace(/-raw$/, "");

console.log(`▶ transcribing ${basename(clip)} (word-level)…`);
const words = runWordWhisper(clip);
writeFileSync(join(dir, `${name}.words.json`), JSON.stringify(words));
writeFileSync(join(dir, `${name}.script.txt`), words.map((w) => w.text).join(" ") + "\n");

// phrase-grouped SRT for karaoke (break on sentence punct or ~42 chars)
const t = (sec) => { const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${s.toFixed(3).padStart(6, "0")}`.replace(".", ","); };
const rows = []; let row = [];
const flush = () => { if (row.length) { rows.push(row); row = []; } };
for (const w of words) {
  row.push(w);
  const chars = row.map((x) => x.text).join(" ").length;
  if ((/[.?!]$/.test(w.text) && row.length >= 3) || chars >= 42) flush();
}
flush();
const srt = rows.map((r, i) => `${i}\n${t(r[0].start)} --> ${t(r[r.length - 1].end)}\n${r.map((x) => x.text).join(" ")}\n`).join("\n");
writeFileSync(join(dir, `${name}.srt`), srt + "\n");

console.log(`✅ ${words.length} words -> ${name}.words.json, ${name}.script.txt, ${name}.srt (${rows.length} karaoke rows)`);
console.log(`   Edit ${name}.script.txt (delete words to cut), then: node cut.mjs <shorts.json> ${name}`);
console.log(`   ⚠ proofread ${name}.srt for the karaoke line (jargon/tickers).`);
