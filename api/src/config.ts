import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..", "..");

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? "127.0.0.1",
  /** SQLite today; swap to an Aurora URL later — see db/client.ts */
  databaseUrl: process.env.DATABASE_URL ?? resolve(repoRoot, "data", "video-tools.db"),
  /** where rendered/uploaded media lands. Local disk now; s3:// later. */
  mediaRoot: process.env.MEDIA_ROOT ?? resolve(repoRoot, "clips"),
  /** a 1-hour OBS recording runs ~3-4 GB; 16 GB leaves real headroom */
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 16 * 1024 * 1024 * 1024),
  logLevel: process.env.LOG_LEVEL ?? "info",
} as const;
