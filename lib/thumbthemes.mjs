// thumbthemes.mjs — colour themes for the KFTP thumbnail renderer.
//
// Joel's Canva output rotated roughly eighteen named palettes (Amber, Navy,
// Dark Teal, Emerald, Warm Copper …) so consecutive episodes never looked like
// reruns of each other in a subscriptions feed. That rotation was manual, which
// means it only held as long as someone remembered what yesterday looked like.
// Here it's derived from the date, so back-to-back episodes CANNOT collide.
//
// Registry + getTheme() rather than a switch: adding a palette is one object,
// and every consumer (CLI flag, --list-themes, the date rotation) reads the
// same source.

/**
 * Every theme supplies the same token set, so the template never branches on
 * theme name. `light: true` flips the card treatment for pale backgrounds —
 * the one structural difference a palette is allowed to make.
 */
const THEMES = {
  "navy-amber": {
    light: false,
    bg: "#070B14", glow: "#12203A", grid: "#7FA8FF22",
    ink: "#F2F6FF", accent: "#F5A524", sub: "#9FB0CC",
    cardBg: "#0C1424", cardBorder: "#23324D",
    good: "#43C282", bad: "#E0574B", goodEdge: "#2E6F4E", goodInk: "#5FD39A",
    muted: "#8FA3C4", faint: "#4A5B78", watermark: "#8FA3C4",
  },
  "deep-teal": {
    light: false,
    bg: "#04100F", glow: "#0E2C2A", grid: "#5FE8D022",
    ink: "#EAFBF7", accent: "#34D3B5", sub: "#8FB8B1",
    cardBg: "#081A18", cardBorder: "#1E3B38",
    good: "#3FCB92", bad: "#E0705A", goodEdge: "#2A6B54", goodInk: "#5FDCA8",
    muted: "#7FA8A1", faint: "#3F625C", watermark: "#7FA8A1",
  },
  "crimson": {
    light: false,
    bg: "#100609", glow: "#36101C", grid: "#FF9BA822",
    ink: "#FFF1EE", accent: "#FF6B5A", sub: "#C7A0A0",
    cardBg: "#1A0A0F", cardBorder: "#3D1F27",
    good: "#48C58A", bad: "#E85C4A", goodEdge: "#2F6B50", goodInk: "#63D69C",
    muted: "#B08C8C", faint: "#6B4A4E", watermark: "#B08C8C",
  },
  "electric-blue": {
    light: false,
    bg: "#050A18", glow: "#102550", grid: "#6FA8FF26",
    ink: "#EFF5FF", accent: "#4DA3FF", sub: "#9BB2D4",
    cardBg: "#0A1428", cardBorder: "#1F3358",
    good: "#43C282", bad: "#E0574B", goodEdge: "#2E6F4E", goodInk: "#5FD39A",
    muted: "#8CA4CC", faint: "#455C86", watermark: "#8CA4CC",
  },
  "emerald": {
    light: false,
    bg: "#05110B", glow: "#0E2E1D", grid: "#6FE8A422",
    ink: "#EDFBF2", accent: "#4CD787", sub: "#93BCA5",
    cardBg: "#081C11", cardBorder: "#1D3D2A",
    good: "#4CD787", bad: "#E0705A", goodEdge: "#2D7048", goodInk: "#6FE2A2",
    muted: "#82AC93", faint: "#3F6650", watermark: "#82AC93",
  },
  "warm-copper": {
    light: false,
    bg: "#120A05", glow: "#38210F", grid: "#FFB87A22",
    ink: "#FFF4EA", accent: "#FF9A3C", sub: "#C9A88C",
    cardBg: "#1C1108", cardBorder: "#402916",
    good: "#4BC98C", bad: "#E4674F", goodEdge: "#2F6B4E", goodInk: "#66DBA3",
    muted: "#B3927A", faint: "#6B5238", watermark: "#B3927A",
  },
  "violet": {
    light: false,
    bg: "#0B0714", glow: "#251641", grid: "#B79BFF22",
    ink: "#F4EEFF", accent: "#B98CFF", sub: "#AFA0C9",
    cardBg: "#130C22", cardBorder: "#2E2148",
    good: "#4FCB93", bad: "#E4675F", goodEdge: "#2F6B52", goodInk: "#6BDCA8",
    muted: "#9A8CBA", faint: "#584878", watermark: "#9A8CBA",
  },
  "signal-yellow": {
    light: true,
    bg: "#FFD84D", glow: "#FFE98A", grid: "#8A6A0022",
    ink: "#12161F", accent: "#FF6A13", sub: "#4A4436",
    cardBg: "#FFFFFF", cardBorder: "#12161F",
    good: "#1E9E5A", bad: "#D93B26", goodEdge: "#1E9E5A", goodInk: "#12161F",
    muted: "#5A5340", faint: "#8A7C52", watermark: "#12161F",
  },
};

/** Rotation order. Adjacent entries are deliberately far apart in hue. */
export const THEME_ORDER = [
  "navy-amber",
  "signal-yellow",
  "deep-teal",
  "crimson",
  "electric-blue",
  "warm-copper",
  "emerald",
  "violet",
];

export const themeNames = () => [...THEME_ORDER];

export function getTheme(name) {
  const t = THEMES[name];
  if (!t) throw new Error(`unknown theme "${name}" — try one of: ${THEME_ORDER.join(", ")}`);
  return { name, ...t };
}

/**
 * Deterministic rotation off the episode date. Two episodes on consecutive days
 * always land on different palettes, and re-rendering the same day always gives
 * the same one — so a re-run doesn't silently change a thumbnail already
 * uploaded. Date-driven rather than a counter file: nothing to keep in sync.
 */
export function themeForDate(dateISO) {
  const days = Math.floor(Date.parse(`${dateISO}T00:00:00Z`) / 86400000);
  if (!Number.isFinite(days)) throw new Error(`bad date "${dateISO}" — expected YYYY-MM-DD`);
  return THEME_ORDER[((days % THEME_ORDER.length) + THEME_ORDER.length) % THEME_ORDER.length];
}
