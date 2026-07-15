import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { errorResponse } from "../project/model.js";
import { jobService } from "./service.js";
import { jobIdParam, jobListResponse, jobQuery, jobResponse, toJobResponse } from "./model.js";

export const jobRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/api/video-processing-jobs",
    {
      schema: {
        summary: "List processing jobs",
        tags: ["processor"],
        querystring: jobQuery,
        response: { 200: jobListResponse },
      },
    },
    async (req) => ({ items: (await jobService.list(req.query)).map(toJobResponse) }),
  );

  app.get(
    "/api/video-processing-jobs/:jobId",
    {
      schema: {
        summary: "Get a job's status",
        description: "The SPA polls this. Swappable for SSE later without changing the contract.",
        tags: ["processor"],
        params: jobIdParam,
        response: { 200: jobResponse, 404: errorResponse },
      },
    },
    async (req) => toJobResponse(await jobService.get(req.params.jobId)),
  );

  app.post(
    "/api/video-processing-jobs/:jobId/cancel",
    {
      schema: {
        summary: "Cancel a queued or running job",
        description: "Best-effort: a running job's ffmpeg child is killed — a wasted render burning CPU is worse.",
        tags: ["processor"],
        params: jobIdParam,
        response: { 200: jobResponse, 404: errorResponse },
      },
    },
    async (req) => toJobResponse(await jobService.cancel(req.params.jobId)),
  );
};
