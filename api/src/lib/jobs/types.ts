import type { JobRow } from "../queue.js";

/** What a runner gets. Everything it needs to do work and report on it. */
export interface JobContext {
  job: JobRow;
  /** 0..100 */
  setProgress: (pct: number) => void;
  setStage: (stage: string) => void;
  /** aborts when the job is canceled — pass it to any child process */
  signal: AbortSignal;
}

/** Resolves to the job's `result` payload. Throwing marks the job failed. */
export type JobRunner = (ctx: JobContext) => Promise<Record<string, unknown>>;
