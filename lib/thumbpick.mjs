// thumbpick.mjs — choose a thumbnail's look at random, never one we just used.
//
// A look is three independent picks: palette (16), layout (3), frame (3) — 144
// combinations. The date rotation it replaces had two flaws, both seen on
// 2026-09-10: every time a list grew it re-mapped history (an old thumbnail
// re-rendered in a different colour), and it served palettes in a fixed order,
// so the week after a run it handed that run's palettes back one by one.
//
// Random picks checked against a log of what shipped can do neither. The log is
// the source of truth for "recently used", and it is also what keeps a re-render
// stable: a date that already has a look keeps it.
//
// The log lives in clips/, next to the per-day folders it describes (gitignored,
// local — like everything else about a specific episode).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { themeNames } from "./thumbthemes.mjs";
import { layoutNames } from "./thumblayouts.mjs";
import { frameNames } from "./thumbframes.mjs";

export const HISTORY_PATH = process.env.THUMB_HISTORY
  ?? fileURLToPath(new URL("../clips/thumb-history.json", import.meta.url));

/**
 * How far back a pick is checked. Palette: none of the last 6 thumbnails'
 * colours (of 16). Skeleton = layout + frame (9 of them): not the same as either
 * of the last 2, so consecutive uploads never share a shape.
 */
export const WINDOWS = { theme: 6, skeleton: 2 };

export const skeletonOf = (e) => `${e.layout}/${e.frame}`;

const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

export function readHistory(path = HISTORY_PATH) {
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, "utf8")).sort(byDate);
}

/** Upsert the look used for a date. The newest record for a date wins. */
export function recordUse(entry, path = HISTORY_PATH) {
  const rows = readHistory(path).filter((h) => h.date !== entry.date);
  rows.push({ date: entry.date, theme: entry.theme, layout: entry.layout, frame: entry.frame, at: new Date().toISOString() });
  writeFileSync(path, JSON.stringify(rows.sort(byDate), null, 2) + "\n");
}

/**
 * PURE. Roll a look that clears the recent-use windows.
 *
 * `fixed` pins any axis the caller has already decided — an explicit flag, a
 * spec value, a layout the content was written for. Pinned axes are never
 * re-rolled, and a window is only enforced when at least one axis it covers is
 * being rolled: an explicit choice is the caller's call, not a violation.
 * Entries for `date` itself are ignored, so re-picking a date never blocks
 * against its own earlier pick.
 */
export function pickLook({ history, date, fixed = {}, rng = Math.random, windows = WINDOWS, maxTries = 500 }) {
  const prior = history.filter((h) => h.date !== date).sort(byDate);
  const recentThemes = new Set(prior.slice(-windows.theme).map((h) => h.theme));
  const recentSkeletons = new Set(prior.slice(-windows.skeleton).map(skeletonOf));
  const any = (list) => list[Math.floor(rng() * list.length)];
  for (let tries = 1; tries <= maxTries; tries++) {
    const look = {
      theme: fixed.theme ?? any(themeNames()),
      layout: fixed.layout ?? any(layoutNames()),
      frame: fixed.frame ?? any(frameNames()),
    };
    const themeOk = fixed.theme !== undefined || !recentThemes.has(look.theme);
    const skeletonOk = (fixed.layout !== undefined && fixed.frame !== undefined) || !recentSkeletons.has(skeletonOf(look));
    if (themeOk && skeletonOk) return { ...look, tries };
  }
  // Unreachable with 16/3/3 and windows 6/2. A future config (bigger windows,
  // shorter lists) could make it so, and that should fail loudly, not loop.
  throw new Error(`no look clears the windows after ${maxTries} tries — windows ${JSON.stringify(windows)} are too tight for the lists`);
}
