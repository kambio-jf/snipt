// panpresets.mjs — named default pan windows, one per recurring screen.
//
// Joel's desktop layout is stable across episodes: the same apps, the same
// window geometry, the same panel widths. So the left edge of the content that
// matters is a CONSTANT per screen, not something to re-derive from a screencap
// every time. These are those constants, measured off the 2026-09-02 recording.
//
// A preset is a starting point, not a rule: a Short that needs to show one
// specific thing still overrides x/y. The point is that the common case —
// "we're on Slack now, then the option chain, then back" — stops being manual.
//
// Registry + getPanPreset() so adding a screen is one object, and the CLI, the
// listing and build.mjs all read the same source.

/**
 * Coordinates are the TOP-LEFT of the 640x790 pan window in the 1920x1080
 * frame, same units Joel's Photoshop marquee produces. x is clamped to
 * [0,1280] and y to [0,290] by build.mjs.
 */
const PRESETS = {
  slack: {
    x: 600, y: 150,
    note: "Message column starts at raw x~550 and the workspace sidebar ends at ~520; " +
          "600 drops the sidebar and the avatar gutter, keeping the full message text. " +
          "y=150 rather than the 290 maximum because the pane SCROLLS during a clip — " +
          "150 is the window that still contains the content at both the start and the " +
          "end of a typical 45s span.",
  },
  claude: {
    x: 500, y: 200,
    note: "Claude Code: project sidebar ends at raw x~340, the response column starts " +
          "at ~524. 500 sits just left of the text so nothing is clipped. Verified on " +
          "the 2026-09-01 Shorts (fingerscrossed x=500, unittests x=520).",
  },
  "tos-positions": {
    x: 600, y: 250,
    note: "thinkorswim Positions. The Positions table starts at raw x~600 (Position, " +
          "Qty, P/L Day, P/L Open) and the Activity/Working block sits above it, so " +
          "y=250 holds both. ALSO a compliance property, not a coincidence: the left " +
          "Account Summary panel occupies raw x 0-570 and carries Account Value and " +
          "P/L Day for the whole account. Any x>=600 excludes it automatically.",
  },
  "tos-chain": {
    x: 900, y: 290,
    note: "thinkorswim option chain. The Strike column is the axis you read the chain " +
          "against and sits at raw x~1220; 900 centres the 640-wide window on it, so " +
          "the call bid/ask land left of the strikes and the put bid/ask right. Also " +
          "clears the Account Summary panel.",
  },
  "yahoo-chart": {
    x: 1280, y: 150,
    note: "Yahoo Finance chart, anchored right: the price axis is at raw x~1820-1920 " +
          "and the most recent candles are beside it, which is what a chart is almost " +
          "always being shown FOR. This is the weakest default of the set — when the " +
          "point is a pattern earlier in the series, override x rather than fight it.",
  },
};

export const panPresetNames = () => Object.keys(PRESETS);

export function getPanPreset(name) {
  const p = PRESETS[name];
  if (!p) throw new Error(`unknown pan preset "${name}" — try one of: ${panPresetNames().join(", ")}`);
  return { name, ...p };
}

/**
 * Resolve one pan keyframe. An explicit x/y always wins over the preset, so
 * `{ preset: "slack", x: 810 }` means "the Slack default, nudged right" — which
 * is the shape most overrides take.
 */
export function resolvePanKey(k) {
  if (!k.preset) return k;
  const p = getPanPreset(k.preset);
  return { ...k, x: k.x ?? p.x, y: k.y ?? p.y };
}
