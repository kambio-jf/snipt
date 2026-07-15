import { z } from "zod";
import { JOB_STATUSES, JOB_TYPES } from "../../db/schema.js";
import type { JobRow } from "../../lib/queue.js";

export const jobIdParam = z.object({ jobId: z.string().uuid() });

export const jobQuery = z.object({
  videoProjectId: z.string().uuid().optional(),
  status: z.enum(JOB_STATUSES).optional(),
});

export const jobResponse = z.object({
  id: z.string().uuid(),
  videoProjectId: z.string().uuid().nullable(),
  jobType: z.enum(JOB_TYPES),
  status: z.enum(JOB_STATUSES),
  progress: z.number().int(),
  stage: z.string().nullable(),
  result: z.record(z.unknown()).nullable(),
  error: z.string().nullable(),
  attempts: z.number().int(),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
});

export const jobListResponse = z.object({ items: z.array(jobResponse) });

export type JobResponse = z.infer<typeof jobResponse>;

export const toJobResponse = (row: JobRow): JobResponse => ({
  id: row.id,
  videoProjectId: row.videoProjectId,
  jobType: row.jobType,
  status: row.status,
  progress: row.progress,
  stage: row.stage,
  result: row.result ?? null,
  error: row.error,
  attempts: row.attempts,
  createdAt: row.createdAt.toISOString(),
  startedAt: row.startedAt?.toISOString() ?? null,
  finishedAt: row.finishedAt?.toISOString() ?? null,
});
