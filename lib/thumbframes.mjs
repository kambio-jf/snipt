// thumbframes.mjs — how the two BLOCKS of a thumbnail are arranged on the page.
//
// The third axis. Themes changed the colour, layouts changed the shape of the
// right-hand block, but every thumbnail still had the same skeleton: a text
// column on the left, a content block on the right. Sixteen palettes and three
// layouts still read as one template in a subscriptions feed, because the
// SKELETON is what a viewer clocks before either of them.
//
// A frame owns the arrangement only — which block sits where, and how the
// shared furniture (tick, rule, brand mark, watermark, tag) follows it. It
// never invents content and never changes the layouts' own internals, so
// frame x layout x theme all compose: 3 x 3 x 16 = 144 combinations.
//
// Registry + getFrame() to match thumbthemes.mjs and thumblayouts.mjs.

/**
 * Each frame is `{ headlineSize?, css(T) }`.
 *   headlineSize — default headline size for this arrangement; a spec's own
 *                  `headlineSize` still wins. A full-width headline needs to be
 *                  smaller than a 446px-column one or it eats the whole frame.
 *   css          — overrides appended AFTER the base and layout rules, so they
 *                  win on equal specificity. Given the theme for its tokens.
 *
 * Frames re-point the shared furniture rather than duplicating it: the base
 * stylesheet is the single definition of what a tick or a brand mark looks
 * like, and a frame only says where it goes.
 */
const FRAMES = {
  /**
   * split — text left, content right. The original, and the default: every
   * thumb.json written before frames existed renders through this unchanged.
   */
  split: {
    blurb: "text left, content right (the original)",
    css: () => "",
  },

  /**
   * mirror — text right, content left. A true mirror, not just a swap: the
   * tick, rule and headline align to the right edge, the rule's dot moves to
   * the leading end, and the watermark/tag trade sides so the corners keep the
   * same relationship they have in `split`.
   */
  mirror: {
    blurb: "text right, content left",
    css: () => `
  .wrap{flex-direction:row-reverse}
  .left{text-align:right}
  .tick{margin-left:auto}
  .rule{flex-direction:row-reverse}
  .rule .dot{margin-left:0;margin-right:-2px}
  .sticks{left:auto;right:-30px;transform:scaleX(-1)}
  .tag{right:auto;left:54px}`,
  },

  /**
   * stack — text across the top, content across the bottom, both full width.
   * The headline gets the whole 1280 instead of 446, so it wants fewer, longer
   * lines and a smaller size; the rule stretches the full width to divide the
   * two bands.
   *
   * Full width also changes what the layouts should do with the space, so this
   * frame re-points them:
   *   stat     — the number moves BESIDE its label instead of above it. In a
   *              tall narrow column the 196px number reads fine stacked; across
   *              1170px it left an empty upper-right quadrant.
   *   timeline — steps run left-to-right with a horizontal spine. Stacked
   *              vertically they would be very wide rows of mostly empty space.
   *   cards    — already a row; it just gets more room.
   */
  stack: {
    blurb: "text top full width, content bottom full width",
    headlineSize: 78,
    css: (T) => `
  .wrap{flex-direction:column;gap:18px;padding:40px 54px 56px}
  .left{width:auto;flex:0 0 auto}
  h1{line-height:.9}
  .rule{margin:20px 0 14px}
  .rule .bar{flex:1;width:auto}
  .brand{position:absolute;left:54px;bottom:19px;margin-top:0}
  .right{flex:1;justify-content:center}

  /* stat: number beside the label rather than above it.
     The number sits in row 1 and the label centres against it; the rest flows
     underneath. Note "grid-row:1/-1" does NOT work here — -1 is the end of the
     EXPLICIT grid, which is one row, so it silently spans nothing. */
  .statwrap{display:grid;grid-template-columns:auto 1fr;column-gap:40px;padding:26px 34px;
            grid-auto-rows:min-content;align-content:center}
  .stat-n{grid-column:1;grid-row:1;align-self:center;font-size:142px}
  .statwrap>:not(.stat-n){grid-column:2}
  .stat-l{margin-top:0;align-self:center}
  .stat-note{margin-top:7px}
  .stat-rule{margin:14px 0 12px}

  /* timeline: steps left-to-right, spine turned horizontal.
     .badge needs an explicit WIDTH here: "flex:0 0 44px" sizes the main axis,
     which is the height once .step is a column, so the badge stretches to the
     full column width and the circle becomes an ellipse. */
  .steps{flex-direction:row;gap:28px;padding:24px 30px}
  .step{flex:1;flex-direction:column;gap:11px;padding-bottom:0}
  .badge{width:44px;flex:0 0 44px}
  .step::before{left:56px;top:20px;right:-28px;bottom:auto;width:auto;height:3px}
  .stept{padding-top:0}`,
  },
};

export const frameNames = () => Object.keys(FRAMES);

export function getFrame(name) {
  const f = FRAMES[name];
  if (!f) throw new Error(`unknown frame "${name}" — try one of: ${frameNames().join(", ")}`);
  return { name, ...f };
}
