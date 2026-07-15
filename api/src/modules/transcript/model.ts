import { z } from "zod";
import { TRANSCRIPT_STATUSES } from "../../db/schema.js";

export const transcriptWordResponse = z.object({
  idx: z.number().int(),
  startS: z.number(),
  endS: z.number(),
  text: z.string(),
});

export const transcriptResponse = z.object({
  id: z.string().uuid(),
  videoAssetId: z.string().uuid(),
  model: z.string(),
  status: z.enum(TRANSCRIPT_STATUSES),
  createdAt: z.string().datetime(),
  words: z.array(transcriptWordResponse),
});

export const enqueuedJobResponse = z.object({ jobId: z.string().uuid() });

export type TranscriptResponse = z.infer<typeof transcriptResponse>;

export interface TranscriptRow {
  id: string;
  videoAssetId: string;
  model: string;
  status: (typeof TRANSCRIPT_STATUSES)[number];
  createdAt: Date;
}

export interface TranscriptWordRow {
  idx: number;
  startS: number;
  endS: number;
  text: string;
}

export const toTranscriptResponse = (row: TranscriptRow, words: TranscriptWordRow[]): TranscriptResponse => ({
  id: row.id,
  videoAssetId: row.videoAssetId,
  model: row.model,
  status: row.status,
  createdAt: row.createdAt.toISOString(),
  words,
});
