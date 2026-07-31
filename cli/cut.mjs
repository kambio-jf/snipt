// cut.mjs — turn an edited transcript into keep-spans (Descript-style) for a Short.
// Diffs <name>.script.txt (edited by DELETING words) against <name>.words.json,
// writes a `keep` array onto the matching short in shorts.json. build.mjs renders it.
//
// usage: node cli/cut.mjs clips/2026-07-09/shorts.json flat-exit [--tighten 350] [--defiller]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { computeKeep, ffprobeDur, detectPauses, snapSpansToPauses, dropPhantomWords } from "../lib/cutlib.mjs";

const args = process.argv.slice(2);
const jsonPath = args[0], shortName = args[1];
const tighten = args.includes("--tighten") ? +args[args.indexOf("--tighten") + 1] : 0;
const defiller = args.includes("--defiller");
const noSnap = args.includes("--no-snap");
const snapWindow = args.includes("--snap-window") ? +args[args.indexOf("--snap-window") + 1] / 1000 : 0.4;
if (!jsonPath || !shortName) { console.error("usage: node cli/cut.mjs <shorts.json> <name> [--tighten ms] [--defiller] [--no-snap] [--snap-window ms]"); process.exit(1); }

const cfg = JSON.parse(readFileSync(jsonPath, "utf8"));
const short = cfg.shorts.find((s) => s.name === shortName);
if (!short) { console.error(`no short named "${shortName}" in ${jsonPath}`); process.exit(1); }
const dir = dirname(resolve(short.source));
let words = JSON.parse(readFileSync(join(dir, `${shortName}.words.json`), "utf8"));
const editedFile = existsSync(join(dir, `${shortName}.script-edited.txt`)) ? `${shortName}.script-edited.txt` : `${shortName}.script.txt`;
const editedText = readFileSync(join(dir, editedFile), "utf8");
console.log(`(using ${editedFile})`);
const clip = resolve(short.source);
const dur = ffprobeDur(clip);

// Measure where the audio is actually silent, then (a) discard "words" Whisper
// decoded out of non-speech and (b) put the cuts in the gaps. Word timings alone
// drift and hallucinate; the waveform doesn't.
const pauses = noSnap ? [] : detectPauses(clip);
if (pauses.length) {
  const before = words.length;
  words = dropPhantomWords(words, pauses);
  if (words.length !== before) console.log(`⚠ dropped ${before - words.length} phantom word(s) sitting inside silence`);
}

const { keep: rawKeep, matched, keptWords } = computeKeep({ words, editedText, dur, tighten, defiller });
if (!rawKeep.length) { console.error("nothing survived the edit — aborting"); process.exit(1); }

let keep = rawKeep;
if (pauses.length) {
  const r = snapSpansToPauses(rawKeep, pauses, { windowS: snapWindow });
  keep = r.keep;
  console.log(`\npauses: ${pauses.length} measured · ${r.snapped} boundary/ies snapped to silence`);
  if (r.unsnapped.length) {
    console.log(`⚠ ${r.unsnapped.length} boundary/ies had no silence within ${Math.round(snapWindow * 1000)}ms — cut lands mid-speech:`);
    for (const u of r.unsnapped.slice(0, 6)) console.log(`    span ${u.span + 1} ${u.edge} @ ${u.t.toFixed(2)}s`);
  }
}

const kd = keep.reduce((a, [s, e]) => a + (e - s), 0);
console.log(`\n${shortName}: ${matched}/${words.length} words kept${defiller ? " (−fillers)" : ""}${tighten ? `, tighten ${tighten}ms` : ""}`);
console.log(`cuts: ${keep.length} keep-span(s) · ${kd.toFixed(1)}s of ${dur.toFixed(1)}s (removed ${(dur - kd).toFixed(1)}s)`);
keep.forEach(([s, e], i) => console.log(`  keep ${String(i + 1).padStart(2)}  ${s.toFixed(2)}–${e.toFixed(2)}  (${(e - s).toFixed(1)}s)`));
delete short.in; delete short.out; delete short.remove;         // keep supersedes these
short.keep = keep;
// Which words.json entries survived — the LCS already decided this exactly, so hand
// it to build.mjs rather than making it re-derive "is this word audible?" from the
// keep-spans. It can't: base.en emits spans that are wrong (a 1.8s word spoken in
// 0.3s, 10ms words, spans that overlap their neighbour), so every timing heuristic
// misjudges words at a cut boundary. This is the ground truth.
short.keptIdx = (keptWords ?? []).map((w) => w.i);
writeFileSync(jsonPath, JSON.stringify(cfg, null, 2) + "\n");
console.log(`✅ wrote keep[] to ${shortName} in ${jsonPath} — now: node build.mjs ${jsonPath} ${shortName}`);
