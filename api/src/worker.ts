/**
 * The job worker. A separate process on purpose: Whisper and ffmpeg are CPU-bound
 * and would stall the API's event loop. Today it polls the jobs table; at scale it
 * becomes N of these behind SQS, which is why nothing else knows how work is claimed.
 *
 * Run: npm run worker --workspace=api
 */
import { getJobRunner } from "./lib/jobs/registry.js";
import { claimNext, isCanceled, markDone, markFailed, reportProgress, type JobRow } from "./lib/queue.js";

const IDLE_POLL_MS = 1000;
/** How often a running job checks whether it's been canceled. */
const CANCEL_POLL_MS = 2000;
/** Don't write every progress tick to the DB — ffmpeg emits a lot of them. */
const PROGRESS_FLUSH_MS = 1000;

let shuttingDown = false;

async function runJob(job: JobRow): Promise<void> {
  const controller = new AbortController();
  let progress = job.progress;
  let stage: string | null = job.stage;
  let dirty = false;

  const flush = setInterval(() => {
    if (!dirty) return;
    dirty = false;
    void reportProgress(job.id, progress, stage ?? undefined).catch(() => {});
  }, PROGRESS_FLUSH_MS);

  // cancel is cooperative: the API marks the row, we notice and kill the child
  const cancelWatch = setInterval(() => {
    void isCanceled(job.id).then((canceled) => canceled && controller.abort()).catch(() => {});
  }, CANCEL_POLL_MS);

  const log = (msg: string) => console.log(`[${job.jobType} ${job.id.slice(0, 8)}] ${msg}`);

  try {
    log("started");
    const result = await getJobRunner(job.jobType)({
      job,
      setProgress: (pct) => { progress = pct; dirty = true; },
      setStage: (s) => { stage = s; dirty = true; log(s); },
      signal: controller.signal,
    });

    if (controller.signal.aborted) return log("canceled");
    await markDone(job.id, result);
    log(`done ${JSON.stringify(result)}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (controller.signal.aborted) return log("canceled");
    await markFailed(job.id, message, job.attempts);
    log(`failed: ${message}`);
  } finally {
    clearInterval(flush);
    clearInterval(cancelWatch);
  }
}

async function loop(): Promise<void> {
  console.log("worker started — polling for jobs");
  while (!shuttingDown) {
    const job = claimNext();
    if (!job) {
      await new Promise((r) => setTimeout(r, IDLE_POLL_MS));
      continue;
    }
    await runJob(job);
  }
  console.log("worker stopped");
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (shuttingDown) process.exit(1); // second signal = impatient
    console.log("shutting down after the current job…");
    shuttingDown = true;
  });
}

await loop();
