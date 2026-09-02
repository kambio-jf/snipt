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
    x: 580, y: 250,
    note: "thinkorswim Positions, framed on the LEFT of the listing: the ticker column " +
          "and, when a position is expanded, its legs (\"+10 Sep 18 (16d) 115 P\"). That " +
          "is what the screen is being shown FOR - which legs are on, not the P/L " +
          "columns further right. y=250 also holds the Activity/Working block above it, " +
          "so a fill and the position it changed are visible together.",
  },
  // The chain is one very wide screen with THREE useful framings, not one. Which
  // side matters depends entirely on what is being said, so there is no single
  // honest default — there are two, named for what they show.
  "tos-chain-calls": {
    x: 660, y: 290,
    note: "Call side of the option chain: Open Int, Delta, Prob ITM, Bid, Ask and the " +
          "Strike column at the right edge. Calls sit LEFT of the strikes in ToS, so " +
          "this is the framing for talking about the call spread.",
  },
  "tos-chain-puts": {
    x: 1180, y: 290,
    note: "Put side: the Strike column at the left edge, then Bid, Ask, Prob ITM, Delta, " +
          "Open Int. Mirror of tos-chain-calls. Both keep the strikes in frame, because " +
          "a chain reading is meaningless without the axis it is read against.",
  },
  "yahoo-chart": {
    x: 1280, y: 160,
    note: "Top-right of the chart: current price and the right-edge value boxes, which " +
          "is where RSI, MACD and Hist Vol print their current readings. y=160 clears " +
          "the browser chrome and still reaches all three indicator panes below the " +
          "candles - verified, all four values are in frame at once. The chart itself " +
          "is the point, so this leans top-right rather than centring the indicators.",
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
