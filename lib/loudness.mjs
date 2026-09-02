// loudness.mjs — measure a rendered file and bring it to the delivery target.
//
// Shared by cli/build.mjs (Shorts) and cli/clean.mjs (the master) because the
// problem is identical in both places and was previously solved in only one:
// a render does NOT inherit its source's level. A Short is an excerpt, so it
// carries whatever that passage happened to be; a master carries whatever the
// recording level was that morning. Both then get re-encoded, which pushes true
// peak further.
//
// YouTube only turns loud content DOWN, never quiet content up, so a master
// delivered at -16.5 LUFS plays audibly softer than one delivered at -14 — and
// inconsistency between consecutive episodes is worse than either absolute
// value.
import { execFileSync, spawnSync } from "node:child_process";
import { renameSync, rmSync } from "node:fs";
import { resolve } from "node:path";

export const TARGET_I = -14.0, TOL_I = 0.5, MAX_TP = -1.0;

// Successive ceilings for the correction pass. One pass at 0.82 is usually
// enough, but it is NOT always: an isolated speech transient can decode above
// full scale even after limiting, because the overshoot is a reconstruction
// artefact of the AAC encode rather than something present in the input. Seen
// three times (2026-09-01 master +1.20 dBTP, 2026-09-01 fingerscrossed Short
// +0.32, 2026-09-02 master), each fixed by hand with a lower ceiling. The ladder
// does that automatically instead.
const CEILINGS = [0.82, 0.75, 0.70];

/**
 * Measure integrated loudness and true peak. Returns NaNs rather than throwing
 * so callers can warn and carry on with an unlevelled file.
 */
export function measureLoudness(dir, file) {
  // loudnorm prints its JSON to STDERR. execFileSync returns stdout only, so
  // reading it there yields NaN on every call and the check silently no-ops.
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file,
    "-af", "loudnorm=I=-14:TP=-1.5:print_format=json", "-f", "null", "-"],
    { cwd: dir, encoding: "utf8", maxBuffer: 1 << 24 });
  const out = `${r.stderr ?? ""}${r.stdout ?? ""}`;
  // String.raw so the backslashes survive: a plain template literal turns \s and
  // \d into "s" and "d", which yields a regex that silently never matches.
  const grab = (k) => { const m = out.match(new RegExp(String.raw`"${k}"\s*:\s*"(-?[\d.]+)"`)); return m ? +m[1] : NaN; };
  return { i: grab("input_i"), tp: grab("input_tp") };
}

const inSpec = (m) => Math.abs(TARGET_I - m.i) <= TOL_I && m.tp <= MAX_TP;

/**
 * Measure `file` and, only if it is out of spec, correct it in place.
 *
 * Video is copied, so a correction costs one audio generation and nothing else.
 * Each attempt re-measures and only accepts the result if it is actually in
 * spec — the earlier version applied one pass and reported whatever came out,
 * which is how a Short shipped at +0.32 dBTP while the log line read like a
 * success.
 */
export function levelToTarget(dir, file, { label = "loudness" } = {}) {
  let m;
  try { m = measureLoudness(dir, file); } catch { console.log(`   ⚠ ${label} measure failed — check it by hand`); return; }
  if (!Number.isFinite(m.i) || !Number.isFinite(m.tp)) { console.log(`   ⚠ ${label} measure returned nothing — check it by hand`); return; }
  if (inSpec(m)) { console.log(`   ${label} ${m.i.toFixed(1)} LUFS · peak ${m.tp.toFixed(2)} dBTP — in spec`); return; }

  const before = m;
  for (const limit of CEILINGS) {
    const gain = TARGET_I - m.i;
    const tmp = `${file.replace(/\.mp4$/i, "")}.lvl.mp4`;
    // A failure here must not take the render down with it: by this point the
    // file already exists and is usable, just at the wrong level. Warn and leave
    // it rather than throwing away a 35-minute master over a level correction.
    try {
      execFileSync("ffmpeg", ["-y", "-i", file,
        "-af", `volume=${gain.toFixed(2)}dB,alimiter=limit=${limit}:attack=5:release=50:level=disabled`,
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", tmp],
        { cwd: dir, stdio: ["ignore", "ignore", "pipe"] });
      renameSync(resolve(dir, tmp), resolve(dir, file));
    } catch (err) {
      console.log(`   ⚠ ${label} correction failed at ceiling ${limit} — file left at ${m.i.toFixed(1)} LUFS / ${m.tp.toFixed(2)} dBTP, fix by hand`);
      try { rmSync(resolve(dir, tmp), { force: true }); } catch {}
      return;
    }

    const after = measureLoudness(dir, file);
    if (!Number.isFinite(after.i)) { console.log(`   ⚠ ${label} re-measure failed after correction — check it by hand`); return; }
    if (inSpec(after)) {
      const total = after.i - before.i;
      console.log(`   ${label} ${before.i.toFixed(1)} LUFS · peak ${before.tp.toFixed(2)} dBTP -> ${after.i.toFixed(1)} / ${after.tp.toFixed(2)} (${total >= 0 ? "+" : ""}${total.toFixed(2)} dB, ceiling ${limit})`);
      return;
    }
    // Still out. Almost always a true-peak overshoot from one isolated transient,
    // so tighten the ceiling and go again from the level we now actually have.
    m = after;
  }
  console.log(`   ⚠ ${label} still out of spec after ${CEILINGS.length} passes: ${m.i.toFixed(1)} LUFS · peak ${m.tp.toFixed(2)} dBTP — fix by hand`);
}
