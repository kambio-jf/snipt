/**
 * The job queue. A table plus a polling worker today; the intent is that swapping
 * this for SQS + a worker pool is a change *here*, not in any service or handler.
 * Services only ever call enqueue() and get a job id back.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { DateTime } from "luxon";
import { db, schema } from "../db/client.js";

export type JobType = (typeof schema.JOB_TYPES)[number];
export type JobStatus = (typeof schema.JOB_STATUSES)[number];
export type JobRow = typeof schema.videoProcessingJob.$inferSelect;

/** Retried up to this many times before a job stays failed. Mirrors an SQS redrive policy. */
export const MAX_ATTEMPTS = 3;

const now = () => DateTime.utc().toJSDate();

export async function enqueue(input: {
  jobType: JobType;
  payload: Record<string, unknown>;
  videoProjectId?: string | null;
}): Promise<JobRow> {
  const [row] = await db
    .insert(schema.videoProcessingJob)
    .values({
      jobType: input.jobType,
      payload: input.payload,
      videoProjectId: input.videoProjectId ?? null,
    })
    .returning();
  return row!;
}

/**
 * Atomically take the oldest queued job. better-sqlite3 transactions are
 * synchronous, so the select+update can't interleave with another claim — this is
 * what an SQS visibility timeout would give us later.
 */
export function claimNext(): JobRow | undefined {
  return db.transaction((tx) => {
    const candidate = tx
      .select()
      .from(schema.videoProcessingJob)
      .where(eq(schema.videoProcessingJob.status, "queued"))
      .orderBy(asc(schema.videoProcessingJob.createdAt))
      .limit(1)
      .get();

    if (!candidate) return undefined;

    return tx
      .update(schema.videoProcessingJob)
      .set({ status: "running", startedAt: now(), attempts: candidate.attempts + 1, error: null })
      .where(eq(schema.videoProcessingJob.id, candidate.id))
      .returning()
      .get();
  });
}

export async function reportProgress(id: string, progress: number, stage?: string): Promise<void> {
  await db
    .update(schema.videoProcessingJob)
    .set({ progress: Math.max(0, Math.min(100, Math.round(progress))), ...(stage ? { stage } : {}) })
    .where(eq(schema.videoProcessingJob.id, id));
}

export async function markDone(id: string, result: Record<string, unknown>): Promise<void> {
  await db
    .update(schema.videoProcessingJob)
    .set({ status: "done", progress: 100, result, finishedAt: now(), stage: null })
    .where(eq(schema.videoProcessingJob.id, id));
}

/** Failed jobs go back to `queued` while attempts remain, mirroring an SQS redrive. */
export async function markFailed(id: string, error: string, attempts: number): Promise<void> {
  const retryable = attempts < MAX_ATTEMPTS;
  await db
    .update(schema.videoProcessingJob)
    .set({
      status: retryable ? "queued" : "failed",
      error,
      ...(retryable ? {} : { finishedAt: now() }),
    })
    .where(eq(schema.videoProcessingJob.id, id));
}

/**
 * Cancel a job. A queued job is canceled outright; a running one is marked and the
 * worker kills its ffmpeg child on the next check — a wasted render burning CPU is
 * worse than a killed one.
 */
export async function requestCancel(id: string): Promise<JobRow | undefined> {
  const [row] = await db
    .update(schema.videoProcessingJob)
    .set({ status: "canceled", finishedAt: now() })
    .where(and(eq(schema.videoProcessingJob.id, id), inArray(schema.videoProcessingJob.status, ["queued", "running"])))
    .returning();
  return row;
}

export async function findJob(id: string): Promise<JobRow | undefined> {
  const [row] = await db
    .select()
    .from(schema.videoProcessingJob)
    .where(eq(schema.videoProcessingJob.id, id))
    .limit(1);
  return row;
}

/** True once someone has asked for this job to stop. Polled by the worker mid-run. */
export async function isCanceled(id: string): Promise<boolean> {
  const row = await findJob(id);
  return row?.status === "canceled";
}
