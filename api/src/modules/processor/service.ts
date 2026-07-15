import { NotFoundError } from "../../lib/errors.js";
import { findJob, requestCancel, type JobRow, type JobStatus } from "../../lib/queue.js";
import { jobDao } from "./dao.js";

export const jobService = {
  async get(id: string): Promise<JobRow> {
    const row = await findJob(id);
    if (!row) throw new NotFoundError("video_processing_job", id);
    return row;
  },

  async list(filter: { videoProjectId?: string; status?: JobStatus }): Promise<JobRow[]> {
    return jobDao.list(filter);
  },

  /** Canceling a finished job is a no-op, not an error — the caller wanted it stopped, and it is. */
  async cancel(id: string): Promise<JobRow> {
    const canceled = await requestCancel(id);
    return canceled ?? (await this.get(id));
  },
};
