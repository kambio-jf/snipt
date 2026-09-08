// thumblayouts.mjs — how the RIGHT-HAND side of a thumbnail is arranged.
//
// Sixteen palettes made consecutive episodes look different in colour, but every
// one of them was still the same picture: headline left, two contrast cards and a
// pill strip right. Colour is the weakest axis of variation — a viewer scanning a
// subscriptions feed reads SHAPE first. Three layouts x sixteen palettes is 48
// combinations, and layout is the half that actually registers.
//
// The left column (tick, headline, rule, kicker, brand) is shared by all layouts
// and lives in cli/thumb.mjs. A layout owns the right column only: its extra CSS
// and the markup that fills it.
//
// Registry + getLayout() to match thumbthemes.mjs: adding a layout is one object,
// and the CLI flag, the listing and the renderer all read the same source.

/**
 * Each layout is `{ css(T), html(spec, T, esc) }`.
 *   css  — extra rules, given the resolved theme so it can use its tokens
 *   html — the inner markup of `.right`, already escaped by the caller's `esc`
 * Neither may touch the left column; that is deliberately not passed in.
 */
const LAYOUTS = {
  /**
   * cards — the original. A before/after contrast plus a strip of counts.
   * Best when the episode is "what we believed" against "what was true", which
   * is most debrief episodes.
   */
  cards: {
    fields: "cards[{title,tone,rows[]}] · pills[{n,l}]",
    css: (T) => `
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
  .eq{display:grid;place-items:center;font-size:44px;color:${T.accent};font-weight:900;padding:0 2px}`,
    html: (spec, T, esc) => {
      const cards = (spec.cards ?? [])
        .map((c) => {
          const tone = c.tone === "good" ? "yes" : "no";
          const rows = (c.rows ?? [])
            .map((r) => `<div class="row"><div class="ico ${tone}">${tone === "yes" ? "✓" : "✕"}</div>${esc(r)}</div>`)
            .join("");
          return `<div class="card ${c.tone === "good" ? "win" : ""}"><h2>${esc(c.title ?? "")}</h2>${rows}</div>`;
        })
        .join('<div class="eq">→</div>');
      return `${cards ? `<div class="cards">${cards}</div>` : ""}${pills(spec, esc)}`;
    },
  },

  /**
   * stat — one number, very large, with what it means underneath.
   * For the episodes that turn on a single figure: 23 issues in one review,
   * 0 earnings events that day, 1 record in a table nobody used. The cards
   * layout buries a number like that in a pill; this one makes it the picture.
   */
  stat: {
    fields: "stat{n,l,note?} · rows[] · pills[{n,l}] (optional)",
    css: (T) => `
  .statwrap{background:${T.cardBg};border:2px solid ${T.cardBorder};border-radius:22px;
            padding:30px 34px;box-shadow:0 18px 40px ${T.light ? "#0002" : "#0006"}}
  .stat-n{font-family:'Sequel100Black-65',Impact,'Arial Black',sans-serif;
          font-size:196px;line-height:.82;color:${T.accent};letter-spacing:-.01em}
  .stat-l{font-size:25px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;
          color:${T.light ? T.ink : "#D7E2F5"};margin-top:16px;line-height:1.25}
  .stat-note{font-size:17px;font-weight:700;letter-spacing:.06em;color:${T.muted};margin-top:9px}
  .stat-rule{height:3px;background:${T.cardBorder};border-radius:2px;margin:22px 0 18px}
  .srow{display:flex;align-items:flex-start;gap:11px;font-size:19px;line-height:1.25;
        color:${T.light ? T.ink : "#D7E2F5"};margin-bottom:12px}
  .srow:last-child{margin-bottom:0}
  .sdot{flex:0 0 9px;height:9px;border-radius:50%;background:${T.accent};margin-top:8px}`,
    html: (spec, T, esc) => {
      const s = spec.stat ?? {};
      const rows = (spec.rows ?? [])
        .map((r) => `<div class="srow"><div class="sdot"></div>${esc(r)}</div>`).join("");
      return `<div class="statwrap">
      <div class="stat-n">${esc(s.n ?? "")}</div>
      ${s.l ? `<div class="stat-l">${esc(s.l)}</div>` : ""}
      ${s.note ? `<div class="stat-note">${esc(s.note)}</div>` : ""}
      ${rows ? `<div class="stat-rule"></div>${rows}` : ""}
    </div>${pills(spec, esc)}`;
    },
  },

  /**
   * timeline — an ordered sequence, numbered, with a spine running through it.
   * For the episodes that are a story rather than a contrast: it was green, it
   * was in memory, here is what we changed. Reads top-to-bottom, which a
   * two-card comparison cannot express.
   */
  timeline: {
    fields: "steps[{t,d}] · pills[{n,l}] (optional)",
    css: (T) => `
  .steps{display:flex;flex-direction:column;gap:0;position:relative;
         background:${T.cardBg};border:2px solid ${T.cardBorder};border-radius:22px;padding:26px 30px;
         box-shadow:0 18px 40px ${T.light ? "#0002" : "#0006"}}
  .step{display:flex;gap:18px;position:relative;padding-bottom:24px}
  .step:last-child{padding-bottom:0}
  .step::before{content:"";position:absolute;left:21px;top:46px;bottom:0;width:3px;
                background:${T.cardBorder};border-radius:2px}
  .step:last-child::before{display:none}
  .badge{flex:0 0 44px;height:44px;border-radius:50%;background:${T.accent};
         display:grid;place-items:center;font-family:'Sequel100Black-65',Impact,sans-serif;
         font-size:24px;color:${T.light ? "#fff" : T.bg};position:relative;z-index:1}
  .step.done .badge{background:${T.good}}
  .stept{font-size:25px;font-weight:800;color:${T.light ? T.ink : "#EEF4FF"};line-height:1.2;padding-top:7px}
  .stepd{font-size:18px;color:${T.muted};line-height:1.3;margin-top:6px}`,
    html: (spec, T, esc) => {
      const steps = (spec.steps ?? [])
        .map((s, i) => `<div class="step${s.done ? " done" : ""}">
        <div class="badge">${s.done ? "✓" : i + 1}</div>
        <div><div class="stept">${esc(s.t ?? "")}</div>${s.d ? `<div class="stepd">${esc(s.d)}</div>` : ""}</div>
      </div>`).join("");
      return `${steps ? `<div class="steps">${steps}</div>` : ""}${pills(spec, esc)}`;
    },
  },
};

/** The pill strip is shared — every layout may carry one, none requires it. */
function pills(spec, esc) {
  const p = (spec.pills ?? [])
    .map((x) => `<div class="pill"><div class="n">${esc(x.n)}</div><div class="l">${esc(x.l)}</div></div>`)
    .join("");
  return p ? `<div class="pills">${p}</div>` : "";
}

export const layoutNames = () => Object.keys(LAYOUTS);

export function getLayout(name) {
  const l = LAYOUTS[name];
  if (!l) throw new Error(`unknown layout "${name}" — try one of: ${layoutNames().join(", ")}`);
  return { name, ...l };
}
