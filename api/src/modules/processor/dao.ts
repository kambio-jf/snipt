import { and, desc, eq, type SQL } from "drizzle-orm";
import { db, schema } from "../../db/client.js";
import type { JobRow, JobStatus } from "../../lib/queue.js";

export const jobDao = {
  async list(filter: { videoProjectId?: string; status?: JobStatus }): Promise<JobRow[]> {
    const where: SQL[] = [];
    if (filter.videoProjectId) where.push(eq(schema.videoProcessingJob.videoProjectId, filter.videoProjectId));
    if (filter.status) where.push(eq(schema.videoProcessingJob.status, filter.status));

    return db
      .select()
      .from(schema.videoProcessingJob)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(schema.videoProcessingJob.createdAt));
  },
};
