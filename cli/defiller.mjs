#!/usr/bin/env node
// defiller.mjs — apply the personal filler dictionary (fillers.json) to a script,
// writing <name>.script-edited.txt for clean.mjs to cut against.
//
// The manual precursor to KMBO-264 (per-user filler_rule table + right-click to add).
// Replaces the hand-run find/replace pass: one entry per phrase, word-aware, so
// "you know" catches every punctuation/case variant.
//
//   node cli/defiller.mjs "<...>.script.txt" [--dry-run]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { loadFileFillers, removeFillerPhrases } from "../lib/cutlib.mjs";

const [, , scriptPath, ...flags] = process.argv;
const dry = flags.includes("--dry-run");

if (!scriptPath) {
  console.error('usage: node cli/defiller.mjs "<name>.script.txt" [--dry-run]');
  process.exit(1);
}
if (!existsSync(scriptPath)) {
  console.error(`not found: ${scriptPath}`);
  process.exit(1);
}

const phrases = loadFileFillers();
if (!phrases.length) {
  console.error("fillers.json has no phrases — nothing to do.");
  process.exit(1);
}

const src = readFileSync(scriptPath, "utf8");
const { text, counts, removed, kept, total } = removeFillerPhrases(src, phrases);

console.log(`filler dictionary: ${phrases.length} phrases`);
const hits = [...counts.entries()].sort((a, b) => b[1] - a[1]);
for (const [phrase, n] of hits) console.log(`  ${String(n).padStart(4)} x  "${phrase}"`);
const unused = phrases.filter((p) => !counts.has(p));
if (unused.length) console.log(`  (not present today: ${unused.map((p) => `"${p}"`).join(", ")})`);

const pct = ((removed / total) * 100).toFixed(1);
console.log(`\n${total} words -> ${kept} kept · ${removed} removed (${pct}%)`);

if (dry) {
  console.log("\n--dry-run: nothing written.");
  process.exit(0);
}

const out = scriptPath.replace(/\.script\.txt$/, ".script-edited.txt");
if (out === scriptPath) {
  console.error("expected a *.script.txt path");
  process.exit(1);
}
writeFileSync(out, text);
console.log(`\nwrote ${out}`);
console.log("Review it, then render:  node cli/clean.mjs \"<full-video>\"");
