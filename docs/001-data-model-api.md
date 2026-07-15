# 001 — Data Model, API Contract & Job Lifecycle

Status: **draft for review** · Issue: KMBO-250

The spine everything hangs off: the DAO, the OpenAPI schemas (→ validation + typed React client), and the job flow. Mostly a **formalization of what the CLI already produces** — not a green-field design.

| CLI artifact today | becomes |
|---|---|
| the recording / `-CLEAN.mp4` / `-raw.mp4` | `media` (with lineage) |
| `words.json` | `transcript` + `word` |
| `script.txt` edits, `--tighten`, `--cut` | `edit` (intent) → `keep_spans` (derived) |
| `shorts.json` | `short` + `cue` + `pan_keyframe` + `layout` |
| `corrections.json` | `correction` |
| transcribe / render runs | `job` |

---

## 1. Entities

### `project`
A unit of work (today: a recording day). Container for media + shorts.
```
id           uuid pk
name         text
created_at   timestamptz
updated_at   timestamptz
user_id      uuid            -- KMBO-259 (null until multi-user)
```

### `media`
Any video file, with **lineage** so derived files trace back to their parent.
```
id               uuid pk
project_id       uuid fk -> project
parent_media_id  uuid fk -> media   null      -- source → master → clip → short
kind             enum   source | master | clip | short
uri              text                          -- local path now; s3:// later
duration_s       real
width, height    int
fps              real
created_at       timestamptz
```
- `source` = the raw upload · `master` = the CLEAN render · `clip` = the extracted window for a Short · `short` = the rendered vertical.

### `transcript` / `word`
```
transcript
  id           uuid pk
  media_id     uuid fk -> media   (unique)
  model        text                -- 'ggml-base.en'
  status       enum  pending | ready | failed
  created_at   timestamptz

word
  id             uuid pk
  transcript_id  uuid fk -> transcript
  idx            int                 -- ordinal position
  start_s        real
  end_s          real
  text           text
  index (transcript_id, idx)
```
> **Decision:** words as **rows**, not a JSON blob. ~7.7k rows for a 47-min video — trivial — and it buys indexing, time-range queries, and per-word metadata later. Blob would be simpler to load; revisit only if read latency ever bites.

### `edit`
The user's edit of a media's transcript. **Stores intent; keep-spans are derived.**
```
id                 uuid pk
media_id           uuid fk -> media   (one per media for MVP)
deleted_word_idxs  json     -- [12, 13, 88, ...]  the user's intent
tighten_ms         int      -- dead-air cap; 0 = off
defiller           bool     -- auto-drop um/uh
manual_cuts        json     -- [[start_s, end_s], ...] redactions
keep_spans         json     -- DERIVED cache
kept_duration_s    real     -- DERIVED cache
updated_at         timestamptz
```
> **Decision:** persist **intent** (which words were deleted + settings), cache the computed `keep_spans`. If `cutlib`'s algorithm improves, every edit recomputes correctly. Storing only keep-spans would freeze old math in.

### `layout`
Data-driven so custom layouts are just config (KMBO-257).
```
id          uuid pk
name        text
canvas      json    -- {w:1080, h:1920}
regions     json    -- [{source:'pip'|'screen', crop:{x,y,w,h}, place:{x,y,w,h}}]
is_default  bool
```
Today's PiP-top/screen-bottom is seeded as one row — **not** hardcoded in the renderer.

### `short`
```
id              uuid pk
project_id      uuid fk -> project
clip_media_id   uuid fk -> media    -- kind='clip'; has its OWN transcript + edit
layout_id       uuid fk -> layout
name            text
created_at      timestamptz
```
> **Decision:** a Short *reuses the same `transcript` + `edit` machinery* as the master — its clip is just another media. Nice symmetry: one editing model everywhere.

### `cue` / `pan_keyframe`
```
cue
  id, short_id fk, idx int
  anchor   text     -- 'start' or a spoken phrase
  hold_s   real
  at       text     -- 'center' | 'upper' | 'lower' | '<y>'
  hook     bool
  lines    json     -- [{size, parts:[{t, c}]}]

pan_keyframe
  id, short_id fk, idx int
  anchor   text     -- 'start' or a spoken phrase
  x, y     int      -- top-left of the window
```
Anchors resolve against the proofread transcript (`cutlib.anchorTime`) — carries over from the CLI as-is.

### `correction`
```
id, from_text, to_text, enabled bool, created_at
user_id  -- KMBO-259
```

### `job`
```
id           uuid pk
project_id   uuid fk  null
type         enum  transcribe | extract_clip | render_master | render_short
status       enum  queued | running | done | failed | canceled
payload      json    -- {mediaId, editId, shortId, ...}
progress     int     -- 0..100
stage        text    -- 'extracting segments 120/293'
result       json    -- {mediaId} of the output
error        text
attempts     int
created_at, started_at, finished_at
```

---

## 2. Lineage
```
project
  └── media(source)            ← upload
        ├── transcript → word[]
        ├── edit                ← user deletes words
        └── media(master)       ← render_master
              └── media(clip)   ← extract_clip  (per Short)
                    ├── transcript → word[]
                    ├── edit
                    └── short → cue[], pan_keyframe[], layout
                          └── media(short)   ← render_short
```

---

## 3. API surface

Feature-first modules; Zod/TypeBox schemas live at the **handler**, auto-generating OpenAPI. DTOs map to domain types at the boundary — request shapes never reach service/DAO.

**projects**
```
POST   /api/projects
GET    /api/projects
GET    /api/projects/:projectId
PATCH  /api/projects/:projectId
DELETE /api/projects/:projectId
```

**media**
```
POST   /api/projects/:projectId/media     -- upload (multipart now, presigned S3 later)
GET    /api/media/:mediaId
GET    /api/media/:mediaId/file           -- ⚠ MUST support HTTP Range
DELETE /api/media/:mediaId
```
> `GET /file` supporting **Range requests** is what makes instant preview possible — `<video>` seeks to skip cut regions.

**transcripts**
```
POST   /api/media/:mediaId/transcript     -> 202 {jobId}
GET    /api/media/:mediaId/transcript     -> {transcript, words[]}
```

**edits** — the Editor hot path
```
GET    /api/media/:mediaId/edit
PUT    /api/media/:mediaId/edit           -> {keepSpans, keptDurationS}
```
> Pure `cutlib` — **no ffmpeg**, so it returns in ms. The SPA sends deletions, gets keep-spans back, and the player seek-skips them. ffmpeg only runs on render.

**render (master)**
```
POST   /api/media/:mediaId/render         -> 202 {jobId}
```

**shorts**
```
POST   /api/projects/:projectId/shorts    {sourceMediaId, inS, outS, name}
                                          -> 202 {shortId, jobId}   (extract_clip → transcribe)
GET    /api/shorts/:shortId               -- incl. cues, pan, layout, clip, transcript ref
PATCH  /api/shorts/:shortId               -- name, layoutId
PUT    /api/shorts/:shortId/cues
PUT    /api/shorts/:shortId/pan
POST   /api/shorts/:shortId/render        -> 202 {jobId}
DELETE /api/shorts/:shortId
```

**jobs**
```
GET    /api/jobs/:jobId                   -> {status, progress, stage, result, error}
GET    /api/jobs?projectId=&status=
-- later: GET /api/jobs/:jobId/events (SSE) to replace polling
```

**corrections**
```
GET    /api/corrections
POST   /api/corrections
PATCH  /api/corrections/:id
DELETE /api/corrections/:id
```

**layouts**
```
GET    /api/layouts
POST   /api/layouts        -- KMBO-257
PATCH  /api/layouts/:id
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
- **Never run ffmpeg inline in a request.** Handler → service → `queue.enqueue()` → return `202 {jobId}`.
- A worker (background child process on the same box today) claims a job, runs the **Pipeline**, updates `progress`/`stage`, writes `result` → the output `media` row.
- `attempts` exists now purely so the future **SQS visibility-timeout retry** is a config change, not a redesign.
- SPA polls `GET /api/jobs/:jobId`; swap to SSE later without touching the contract.

**Job types → pipeline**
| type | does |
|---|---|
| `transcribe` | word-level Whisper → corrections → `transcript` + `word[]` |
| `extract_clip` | cut `[inS,outS]` from a master → `media(kind=clip)` → chains a `transcribe` |
| `render_master` | edit → keep-spans → parallel segment extract + concat-copy → `media(kind=master)` |
| `render_short` | clip + edit + layout + cues + pan → split render + burned captions → `media(kind=short)` |

---

## 5. Open questions
1. **Words as rows vs JSON blob** — recommending rows; flag if you'd rather keep the `words.json` shape verbatim.
2. **One edit per media, or versions?** MVP: one. Add `label` + multiple rows later if drafts matter.
3. **Cancel semantics for `running` jobs** — best-effort kill the child process, or let it finish?
