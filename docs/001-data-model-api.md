# 001 — Data Model, API Contract & Job Lifecycle

Status: **draft for review** · Issue: KMBO-250

The spine everything hangs off: the DAO, the OpenAPI schemas (→ validation + typed React client), and the job flow. Mostly a **formalization of what the CLI already produces** — not a green-field design.

| CLI artifact today | becomes |
|---|---|
| the recording / `-CLEAN.mp4` / `-raw.mp4` | `video_asset` (with lineage) |
| `words.json` | `transcript` + `transcript_word` |
| `script.txt` edits, `--tighten`, `--cut` | `transcript_edit` (intent) → `keep_spans` (derived) |
| `shorts.json` | `video_short` + `video_short_text_cue` + `video_short_viewport_keyframe` + `video_short_layout` |
| `corrections.json` | `transcript_correction_rule` |
| transcribe / render runs | `video_processing_job` |

---

## 0. Naming standard

> **A table is prefixed by its aggregate root. Roots are named so they're unambiguous standalone.**

The prefix is **the root — not the word "video."**
- `transcript` is unambiguous alone → its whole family is `transcript_*`.
- `project`, `short`, `job` are **not** unambiguous alone → they carry `video_`. (`short` especially: in this org's head, "short" is a *short position*.)

Long names are a feature. Every entity should be readable with zero surrounding context. Hold future entities to this rule.

## 0.1 Storage principle

> **Blobs on disk/S3. Structured data in the DB.**

A video is opaque — nothing to query — so it lives as a file (`video_asset.uri`). A transcript is *structured data we will query* (searching transcripts is how you find Short moments), so its words are rows. Keeping words and `transcript_edit` in one store also means the edit's word indices can't silently drift out of sync with a file.

## 0.2 Aggregate roots = modules

Five roots, and they *are* the feature-first modules:

```
modules/project/     video_project
modules/video/       video_asset
modules/transcript/  transcript
                     transcript_word
                     transcript_edit
                     transcript_correction_rule
modules/short/       video_short
                     video_short_layout
                     video_short_viewport_keyframe
                     video_short_text_cue
modules/processor/   video_processing_job
```

Each module: `handler → service → dao → model`. Shared capabilities live in `lib/` (cutlib, queue, mediaRunner, storage).

---

## 1. Entities

### `video_project`
A unit of work (today: a recording day). Container for assets + shorts.
```
id           uuid pk
name         text
created_at   timestamptz
updated_at   timestamptz
user_id      uuid            -- KMBO-259 (null until multi-user)
```

### `video_asset`
Any video file, with **lineage** so derived files trace back to their parent.
```
id                    uuid pk
video_project_id      uuid fk -> video_project
parent_video_asset_id uuid fk -> video_asset   null
asset_type            enum  source_recording | edited_master | short_source_clip | rendered_short
uri                   text                      -- local path now; s3:// later
duration_s            real
width, height         int
fps                   real
created_at            timestamptz
```

### `transcript` / `transcript_word`
```
transcript
  id              uuid pk
  video_asset_id  uuid fk -> video_asset   (unique)
  model           text                      -- 'ggml-base.en'
  status          enum  pending | ready | failed
  created_at      timestamptz

transcript_word
  id             uuid pk
  transcript_id  uuid fk -> transcript
  idx            int                        -- ordinal position
  start_s        real
  end_s          real
  text           text
  index (transcript_id, idx)
```
> **Decided:** words as **rows**, not a JSON blob. ~7.7k rows for a 47-min video — trivial — and it buys indexing, time-range queries, and per-word metadata later. Revisit only if read latency ever bites.

### `transcript_edit`
The user's edit — **the EDL (Edit Decision List)**. Stores *intent*; keep-spans are derived. Applied when the asset is cut.
```
id                 uuid pk
transcript_id      uuid fk -> transcript   (one per transcript for MVP)
deleted_word_idxs  json     -- [12, 13, 88, ...]  the user's intent
tighten_ms         int      -- dead-air cap; 0 = off        (time-based)
defiller           bool     -- auto-drop um/uh
manual_cuts        json     -- [[start_s, end_s], ...]      (time-based)
keep_spans         json     -- DERIVED cache
kept_duration_s    real     -- DERIVED cache
updated_at         timestamptz
```
> **Decided:** persist **intent** (deleted words + settings), cache computed `keep_spans`. If `cutlib`'s math improves, every edit recomputes correctly — storing only keep-spans would freeze old math in.
>
> **Note:** `tighten_ms` and `manual_cuts` are *time-based*, not word-based — modifiers riding along on the same edit. The dominant concept is still the transcript edit.
>
> **Decided:** one edit per transcript for MVP. Add a `label` + multiple rows later if drafts matter.

### `video_short_layout`
Data-driven so custom layouts are just config (KMBO-257).
```
id          uuid pk
name        text
canvas      json    -- {w:1080, h:1920}
regions     json    -- [{source:'pip'|'screen', crop:{x,y,w,h}, place:{x,y,w,h}}]
is_default  bool
```
Today's PiP-top/screen-bottom is **seeded as one row** — never hardcoded in the renderer.

### `video_short`
```
id                    uuid pk
video_project_id      uuid fk -> video_project
clip_video_asset_id   uuid fk -> video_asset       -- asset_type='short_source_clip'
video_short_layout_id uuid fk -> video_short_layout
name                  text
created_at            timestamptz
```
> **Decided:** a short **reuses the same transcript + transcript_edit machinery** as the master — its clip is just another `video_asset` with its own transcript and edit. One editing model everywhere, exactly as the CLI already behaves.

### `video_short_viewport_keyframe` — the pan
```
id, video_short_id fk, idx int
anchor   text     -- 'start' or a spoken phrase
x, y     int      -- top-left of the viewport window
```

### `video_short_text_cue` — the overlay text
```
id, video_short_id fk, idx int
anchor   text     -- 'start' or a spoken phrase
hold_s   real
at       text     -- 'center' | 'upper' | 'lower' | '<y>'
hook     bool     -- render at frame 1
lines    json     -- [{size, parts:[{t, c}]}]
```
Both resolve their `anchor` against the proofread transcript (`cutlib.anchorTime`) — carries over from the CLI as-is. **Keyframe = viewport moves. Cue = text appears.**

### `transcript_correction_rule`
A **global dictionary rule** (`piano → P&L`), not attached to any one video. Applied at transcribe time.
```
id, from_text, to_text, enabled bool, created_at
user_id  -- KMBO-259
```
> Guardrail: only **unambiguous** rules. Never map a bare real word the user says legitimately (`cloud → Claude` is unsafe).

### `video_processing_job`
```
id                uuid pk
video_project_id  uuid fk  null
job_type          enum  transcribe_asset | extract_short_clip | render_edited_master | render_short
status            enum  queued | running | done | failed | canceled
payload           json    -- {videoAssetId, transcriptEditId, videoShortId, ...}
progress          int     -- 0..100
stage             text    -- 'extracting segments 120/293'
result            json    -- {videoAssetId} of the output
error             text
attempts          int
created_at, started_at, finished_at
```

---

## 2. Lineage
```
video_project
  └── video_asset(source_recording)          ← upload
        ├── transcript → transcript_word[]
        │     └── transcript_edit            ← user deletes words
        └── video_asset(edited_master)       ← render_edited_master
              └── video_asset(short_source_clip)   ← extract_short_clip
                    ├── transcript → transcript_word[]
                    │     └── transcript_edit
                    └── video_short → video_short_text_cue[]
                                    → video_short_viewport_keyframe[]
                                    → video_short_layout
                          └── video_asset(rendered_short)   ← render_short
```

---

## 3. API surface

Zod/TypeBox schemas live at the **handler**, auto-generating OpenAPI. DTOs map to domain types at the boundary — request shapes never reach service/DAO.

**project**
```
POST   /api/video-projects
GET    /api/video-projects
GET    /api/video-projects/:videoProjectId
PATCH  /api/video-projects/:videoProjectId
DELETE /api/video-projects/:videoProjectId
```

**video**
```
POST   /api/video-projects/:videoProjectId/video-assets   -- upload source_recording
GET    /api/video-assets/:videoAssetId
GET    /api/video-assets/:videoAssetId/file               -- ⚠ MUST support HTTP Range
POST   /api/video-assets/:videoAssetId/render             -> 202 {jobId}   (render_edited_master)
DELETE /api/video-assets/:videoAssetId
```
> `GET /file` supporting **Range requests** is what makes instant preview possible — `<video>` seeks to skip cut regions.

**transcript**
```
POST   /api/video-assets/:videoAssetId/transcript   -> 202 {jobId}   (transcribe_asset)
GET    /api/video-assets/:videoAssetId/transcript   -> {transcript, words[]}
GET    /api/transcripts/:transcriptId/edit
PUT    /api/transcripts/:transcriptId/edit          -> {keepSpans, keptDurationS}
```
> `PUT .../edit` is the Editor's **hot path**: pure `cutlib`, **no ffmpeg**, returns in ms. The SPA sends deletions, gets keep-spans back, and the player seek-skips them. ffmpeg only runs on render.

```
GET    /api/transcript-correction-rules
POST   /api/transcript-correction-rules
PATCH  /api/transcript-correction-rules/:ruleId
DELETE /api/transcript-correction-rules/:ruleId
```

**short**
```
POST   /api/video-projects/:videoProjectId/video-shorts
         {sourceVideoAssetId, inS, outS, name}
         -> 202 {videoShortId, jobId}     (extract_short_clip → transcribe_asset)
GET    /api/video-shorts/:videoShortId    -- incl. cues, keyframes, layout, clip, transcript ref
PATCH  /api/video-shorts/:videoShortId    -- name, layoutId
PUT    /api/video-shorts/:videoShortId/text-cues
PUT    /api/video-shorts/:videoShortId/viewport-keyframes
POST   /api/video-shorts/:videoShortId/render   -> 202 {jobId}
DELETE /api/video-shorts/:videoShortId

GET    /api/video-short-layouts
POST   /api/video-short-layouts        -- KMBO-257
PATCH  /api/video-short-layouts/:layoutId
```

**processor**
```
GET    /api/video-processing-jobs/:jobId   -> {status, progress, stage, result, error}
GET    /api/video-processing-jobs?videoProjectId=&status=
-- later: GET /api/video-processing-jobs/:jobId/events (SSE) to replace polling
```

---

## 4. Job lifecycle

```
        POST (enqueue)
              │
              ▼
          [queued] ──── cancel ───▶ [canceled]
              │
      worker claims (started_at, attempts++)
              ▼
         [running] ── progress / stage updates
           │     │
        done     failed
           ▼        ▼
        [done]   [failed] ── attempts < max ──▶ [queued]   (retry)
```

Rules:
- **Never run ffmpeg inline in a request.** handler → service → `queue.enqueue()` → `202 {jobId}`.
- A worker (background child process on the same box today) claims a job, runs the **Pipeline**, updates `progress`/`stage`, writes `result` → the output `video_asset` row.
- `attempts` exists now purely so the future **SQS visibility-timeout retry** is a config change, not a redesign.
- SPA polls `GET /api/video-processing-jobs/:jobId`; swap to SSE later without touching the contract.
- **Decided:** canceling a `running` job **best-effort kills** the ffmpeg child and marks `canceled` — a wasted render burning CPU is worse than a killed one.

**Job types → pipeline**
| `job_type` | does |
|---|---|
| `transcribe_asset` | word-level Whisper → correction rules → `transcript` + `transcript_word[]` |
| `extract_short_clip` | cut `[inS,outS]` from a master → `video_asset(short_source_clip)` → chains a `transcribe_asset` |
| `render_edited_master` | edit → keep-spans → parallel segment extract + concat-copy → `video_asset(edited_master)` |
| `render_short` | clip + edit + layout + cues + keyframes → split render + burned captions → `video_asset(rendered_short)` |

> Render at scale **must** use parallel per-segment extraction + concat-copy. One-filtergraph trim/concat crawls (~0.47×) and a `select` expression OOMs past ~200 spans. Learned the hard way.
