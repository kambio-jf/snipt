// Factory registry for job types — add a runner here and the worker picks it up.
// The unimplemented ones fail their job cleanly rather than silently succeeding.
import type { JobType } from "../queue.js";
import { transcribeAsset } from "./transcribe-asset.js";
import type { JobRunner } from "./types.js";

const notImplemented =
  (jobType: JobType): JobRunner =>
  async () => {
    throw new Error(`job type "${jobType}" is not implemented yet`);
  };

const runners: Record<JobType, JobRunner> = {
  transcribe_asset: transcribeAsset,
  extract_short_clip: notImplemented("extract_short_clip"), // KMBO-255
  render_edited_master: notImplemented("render_edited_master"), // KMBO-254
  render_short: notImplemented("render_short"), // KMBO-254
};

export const getJobRunner = (jobType: JobType): JobRunner => runners[jobType];
