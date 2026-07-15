import { z } from "zod";
import { ASSET_TYPES } from "../../db/schema.js";

export const videoAssetIdParam = z.object({ videoAssetId: z.string().uuid() });

export const videoAssetResponse = z.object({
  id: z.string().uuid(),
  videoProjectId: z.string().uuid(),
  parentVideoAssetId: z.string().uuid().nullable(),
  assetType: z.enum(ASSET_TYPES),
  uri: z.string(),
  durationS: z.number().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  fps: z.number().nullable(),
  createdAt: z.string().datetime(),
});

export const videoAssetListResponse = z.object({ items: z.array(videoAssetResponse) });

export type VideoAssetResponse = z.infer<typeof videoAssetResponse>;

export interface VideoAssetRow {
  id: string;
  videoProjectId: string;
  parentVideoAssetId: string | null;
  assetType: (typeof ASSET_TYPES)[number];
  uri: string;
  durationS: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  createdAt: Date;
}

export const toVideoAssetResponse = (row: VideoAssetRow): VideoAssetResponse => ({
  id: row.id,
  videoProjectId: row.videoProjectId,
  parentVideoAssetId: row.parentVideoAssetId,
  assetType: row.assetType,
  uri: row.uri,
  durationS: row.durationS,
  width: row.width,
  height: row.height,
  fps: row.fps,
  createdAt: row.createdAt.toISOString(),
});
