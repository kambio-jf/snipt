// panshort.mjs — one-off: render drawdown Short with a keyframed (animated) content crop.
import { execFileSync } from "node:child_process";

const D = 0.6; // slide duration (s)
const keys = [
  { t: 0.0,  x: 590, y: 103 },  // start
  { t: 6.3,  x: 480, y: 225 },  // "as of last month"
  { t: 20.5, x: 930, y: 90  },  // "this one this one"
  { t: 23.9, x: 480, y: 225 },  // "so from a negative 11"
];

// piecewise: hold each key, then linear-slide over D arriving at the next key's time
function pw(dim) {
  let acc = String(keys[0][dim]);
  for (let i = 1; i < keys.length; i++) {
    const tB = keys[i].t, vB = keys[i][dim], vA = keys[i - 1][dim];
    const rs = +(tB - D).toFixed(3), dv = vB - vA;
    const ramp = `(${vA}+(${dv})*(t-${rs})/${D})`;
    acc = `if(gte(t\\,${tB})\\,${vB}\\,if(gte(t\\,${rs})\\,${ramp}\\,${acc}))`;
  }
  return acc;
}

const W = 640, H = 790, pipH = 594, contentH = 1326;
const filter =
  `[0:v]split=2[a][b];` +
  `[a]crop=342:188:30:858,scale=1080:${pipH}[pip];` +
  `[b]crop=${W}:${H}:${pw("x")}:${pw("y")},scale=1080:${contentH}:force_original_aspect_ratio=increase,crop=1080:${contentH}[content];` +
  `[pip][content]vstack=inputs=2,ass=drawdown.ass[v]`;

execFileSync("ffmpeg", ["-y", "-i", "drawdown-tight.mp4", "-filter_complex", filter,
  "-map", "[v]", "-map", "0:a", "-c:v", "libx264", "-preset", "medium", "-crf", "19",
  "-c:a", "aac", "-b:a", "192k", "drawdown-SHORT.mp4"],
  { stdio: "inherit", cwd: "clips" });
console.log("✅ rendered drawdown-SHORT.mp4 with animated pan");
