// Drizzle schema — the 11 tables from docs/001-data-model-api.md.
// SQLite today, Aurora/Postgres later; the dialect swap is why the DAO layer exists.
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { DateTime } from "luxon";
import { randomUUID } from "node:crypto";

const id = () => text("id").primaryKey().$defaultFn(() => randomUUID());
const now = () => DateTime.utc().toJSDate();
const createdAt = () => integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now);
const updatedAt = () =>
  integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now).$onUpdateFn(now);

// ── project ────────────────────────────────────────────────────────────────────

export const videoProject = sqliteTable("video_project", {
  id: id(),
  name: text("name").notNull(),
  userId: text("user_id"), // KMBO-259 — null until multi-user
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ── video ──────────────────────────────────────────────────────────────────────

export const ASSET_TYPES = ["source_recording", "edited_master", "short_source_clip", "rendered_short"] as const;

export const videoAsset = sqliteTable(
  "video_asset",
  {
    id: id(),
    videoProjectId: text("video_project_id").notNull().references(() => videoProject.id, { onDelete: "cascade" }),
    // lineage — derived files trace back to their parent (self-reference)
    parentVideoAssetId: text("parent_video_asset_id").references((): AnySQLiteColumn => videoAsset.id, {
      onDelete: "set null",
    }),
    assetType: text("asset_type", { enum: ASSET_TYPES }).notNull(),
    uri: text("uri").notNull(), // local path now; s3:// later
    durationS: real("duration_s"),
    width: integer("width"),
    height: integer("height"),
    fps: real("fps"),
    createdAt: createdAt(),
  },
  (t) => [index("video_asset_project_idx").on(t.videoProjectId), index("video_asset_parent_idx").on(t.parentVideoAssetId)],
);

// ── transcript ─────────────────────────────────────────────────────────────────

export const TRANSCRIPT_STATUSES = ["pending", "ready", "failed"] as const;

export const transcript = sqliteTable(
  "transcript",
  {
    id: id(),
    videoAssetId: text("video_asset_id").notNull().references(() => videoAsset.id, { onDelete: "cascade" }),
    model: text("model").notNull(), // 'ggml-base.en'
    status: text("status", { enum: TRANSCRIPT_STATUSES }).notNull().default("pending"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("transcript_asset_uq").on(t.videoAssetId)],
);

export const transcriptWord = sqliteTable(
  "transcript_word",
  {
    id: id(),
    transcriptId: text("transcript_id").notNull().references(() => transcript.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(), // ordinal position
    startS: real("start_s").notNull(),
    endS: real("end_s").notNull(),
    text: text("text").notNull(),
  },
  (t) => [index("transcript_word_order_idx").on(t.transcriptId, t.idx)],
);

/**
 * The EDL. Stores the user's *intent* (deleted words + settings); keep_spans is a
 * derived cache — so improving cutlib's math recomputes every edit correctly.
 */
export const transcriptEdit = sqliteTable(
  "transcript_edit",
  {
    id: id(),
    transcriptId: text("transcript_id").notNull().references(() => transcript.id, { onDelete: "cascade" }),
    deletedWordIdxs: text("deleted_word_idxs", { mode: "json" }).$type<number[]>().notNull().default(sql`'[]'`),
    tightenMs: integer("tighten_ms").notNull().default(0), // dead-air cap; 0 = off
    defiller: integer("defiller", { mode: "boolean" }).notNull().default(false),
    manualCuts: text("manual_cuts", { mode: "json" }).$type<[number, number][]>().notNull().default(sql`'[]'`),
    // derived caches
    keepSpans: text("keep_spans", { mode: "json" }).$type<[number, number][]>().notNull().default(sql`'[]'`),
    keptDurationS: real("kept_duration_s"),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("transcript_edit_transcript_uq").on(t.transcriptId)], // one per transcript for MVP
);

/** Global dictionary rule (piano → P&L). Applied at transcribe time. */
export const transcriptCorrectionRule = sqliteTable("transcript_correction_rule", {
  id: id(),
  fromText: text("from_text").notNull(),
  toText: text("to_text").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  userId: text("user_id"), // KMBO-259
  createdAt: createdAt(),
});

// ── short ──────────────────────────────────────────────────────────────────────

export interface LayoutCanvas {
  w: number;
  h: number;
}
export interface LayoutRegion {
  key: string;
  /** where the region sits on the canvas */
  place: { x: number; y: number; w: number; h: number };
  /** aperture size in source pixels — i.e. the zoom level. Origin comes from the keyframe. */
  crop_size: { w: number; h: number };
}

export const videoShortLayout = sqliteTable("video_short_layout", {
  id: id(),
  name: text("name").notNull(),
  canvas: text("canvas", { mode: "json" }).$type<LayoutCanvas>().notNull(),
  regions: text("regions", { mode: "json" }).$type<LayoutRegion[]>().notNull(),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
});

export const videoShort = sqliteTable(
  "video_short",
  {
    id: id(),
    videoProjectId: text("video_project_id").notNull().references(() => videoProject.id, { onDelete: "cascade" }),
    clipVideoAssetId: text("clip_video_asset_id").notNull().references(() => videoAsset.id, { onDelete: "cascade" }),
    videoShortLayoutId: text("video_short_layout_id").notNull().references(() => videoShortLayout.id),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("video_short_project_idx").on(t.videoProjectId)],
);

/** Where the source sits behind a region's fixed aperture. PiP = 1 (static); viewport = many (slides). */
export const videoShortRegionKeyframe = sqliteTable(
  "video_short_region_keyframe",
  {
    id: id(),
    videoShortId: text("video_short_id").notNull().references(() => videoShort.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    regionKey: text("region_key").notNull(), // 'pip' | 'viewport' | custom
    anchor: text("anchor").notNull(), // 'start' or a spoken phrase
    x: integer("x").notNull(), // top-left of the SOURCE behind the aperture
    y: integer("y").notNull(),
  },
  (t) => [index("video_short_region_keyframe_order_idx").on(t.videoShortId, t.idx)],
);

export const CUE_POSITIONS = ["center", "upper", "lower"] as const;

export interface CueLine {
  size: number;
  parts: { t: string; c?: string }[];
}

export const videoShortTextCue = sqliteTable(
  "video_short_text_cue",
  {
    id: id(),
    videoShortId: text("video_short_id").notNull().references(() => videoShort.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    anchor: text("anchor").notNull(),
    holdS: real("hold_s").notNull(),
    at: text("at").notNull(), // 'center' | 'upper' | 'lower' | '<y>'
    hook: integer("hook", { mode: "boolean" }).notNull().default(false), // render at frame 1
    lines: text("lines", { mode: "json" }).$type<CueLine[]>().notNull(),
  },
  (t) => [index("video_short_text_cue_order_idx").on(t.videoShortId, t.idx)],
);

// ── processor ──────────────────────────────────────────────────────────────────

export const JOB_TYPES = ["transcribe_asset", "extract_short_clip", "render_edited_master", "render_short"] as const;
export const JOB_STATUSES = ["queued", "running", "done", "failed", "canceled"] as const;

export const videoProcessingJob = sqliteTable(
  "video_processing_job",
  {
    id: id(),
    videoProjectId: text("video_project_id").references(() => videoProject.id, { onDelete: "cascade" }),
    jobType: text("job_type", { enum: JOB_TYPES }).notNull(),
    status: text("status", { enum: JOB_STATUSES }).notNull().default("queued"),
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    progress: integer("progress").notNull().default(0), // 0..100
    stage: text("stage"), // 'extracting segments 120/293'
    result: text("result", { mode: "json" }).$type<Record<string, unknown>>(),
    error: text("error"),
    // exists now so the future SQS visibility-timeout retry is config, not a redesign
    attempts: integer("attempts").notNull().default(0),
    createdAt: createdAt(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("video_processing_job_claim_idx").on(t.status, t.createdAt)],
);
