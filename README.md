# snipt

Local, free, **transcript-driven** video editing + auto-Shorts. Edit your video by deleting words from its transcript; auto-clean dead air; generate captioned vertical clips with keyframed pans. Built on **ffmpeg + Whisper** — no cloud, no subscription.

Think Descript × OpusClips, running on your own machine.

## What it does

- **Master clean** (`cli/clean.mjs`) — word-level transcribe → you delete filler words in the transcript → it cuts those + tightens dead air → renders a clean landscape master. Also emits a timestamped transcript (no waiting on platform captions).
- **Transcript editor** (`cli/transcribe.mjs` + `cli/cut.mjs`) — Descript-style: delete words in `*.script.txt`, and the matching audio+video is cut. Cuts snap to silence and never clip word onsets.
- **Shorts** (`cli/build.mjs`) — split PiP + screen vertical layout, keyframed pan across the frame, Whisper-synced karaoke captions + describable JSON overlay cues. Driven by a per-day `shorts.json`.
- **Pan helper** (`cli/pancaps.mjs`) — outputs a screencap at each pan anchor so you can read viewport coordinates off the exact frame.
- **Filler dictionary** (`cli/defiller.mjs` + `fillers.json`) — your *personal* filler phrases, removed from the script in one pass. Word-aware, so one `you know` entry catches every punctuation and case variant, and the longest phrase wins (`you know what i mean` beats `you know`). Replaces the hand-run find/replace pass.
- **Corrections** (`corrections.json`) — a domain dictionary that auto-fixes the small Whisper model's *consistent* garbles at transcribe time (extend it as you spot new ones).

> Both dictionaries share one guardrail: **only unambiguous entries.** Never map or delete a word you say legitimately — measured on real transcripts, `like` is ~91% legitimate and bare `kind of` ~64%, so neither belongs in `fillers.json`.

## Layout

npm workspaces — `lib`, `api`, `web`.

```
cli/    command-line entry points (thin arg-parsing over lib/)
lib/    the engine — cutlib.mjs: keep-spans, transcript LCS diff, corrections,
        anchor resolution, SRT timelines. Published as @video-tools/lib so the
        API imports it rather than reimplementing any of it.
api/    Fastify + Zod (schemas auto-generate the OpenAPI spec) + Drizzle/SQLite.
        modules/<domain>/{handler,service,dao,model}; shared tools in src/lib.
        src/worker.ts runs queued jobs in its own process.
web/    Vite + React SPA; its API client is generated from api/openapi.json.
docs/   design specs
models/ Whisper model (downloaded, not committed)
clips/  per-day working folders (not committed)
```

The CLI and the app share one engine: `lib/` is the source of truth for all cut
math, and `cli/*.mjs` and `api/` are both just callers.

## Web app (in progress)

```bash
npm install
npm run db:migrate      # create/upgrade the local SQLite db
npm run db:seed         # import corrections.json + the default Short layout

npm run dev:api         # http://127.0.0.1:3000  (Swagger UI at /docs)
npm run dev:worker      # runs transcribe/render jobs
npm run dev:web         # http://localhost:5173  (proxies /api to the API)
```

**The worker is a separate process on purpose.** Whisper and ffmpeg are CPU-bound and
would stall the API's event loop, so nothing heavy ever runs inside a request: handlers
enqueue a job and return `202 {jobId}`, and the SPA polls it. That split is also the seam
where the queue becomes SQS and the worker becomes a pool — without touching the API.

After changing any handler schema, regenerate the contract and the typed client:

```bash
npm run spec --workspace=api      # handlers -> api/openapi.json
npm run gen:api --workspace=web   # openapi.json -> web/src/api/schema.d.ts
```

## Requirements

- **Node.js ≥ 22**
- **ffmpeg** with the `whisper` filter and (optional) hardware encoders. On Windows: `winget install Gyan.FFmpeg`.
- The Whisper model: `bash fetch-model.sh` (downloads `ggml-base.en.bin`, ~142 MB, not committed).

## Quick start

```bash
bash fetch-model.sh

# 1) transcribe the full recording
node cli/clean.mjs "path/to/recording.mp4"
#    -> edit <name>.script.txt (delete filler words), then:
node cli/clean.mjs "path/to/recording.mp4"          # renders <name>-CLEAN.mp4 + transcript

# 2) make a Short (see a clips/<date>/shorts.json for the schema)
node cli/transcribe.mjs clips/<date>/<name>-raw.mp4  # word timing + editable script
node cli/cut.mjs clips/<date>/shorts.json <name>     # apply transcript edits -> keep[]
node cli/build.mjs clips/<date>/shorts.json <name>   # render the vertical Short
```

## Notes

- Larger Whisper models (`small.en` / `medium.en`) improve accuracy at a big speed cost on CPU; a GPU box runs them near-realtime. Swap the model path in `lib/cutlib.mjs` and point `fetch-model.sh` at the new file.
- Rendering uses Intel Quick Sync (`h264_qsv`) where available; adjust the encoder in the render scripts for other hardware.

_All rights reserved. Not currently licensed for reuse._
