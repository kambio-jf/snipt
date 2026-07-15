import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { errorResponse } from "../project/model.js";
import { videoAssetIdParam } from "../video/model.js";
import { transcriptService } from "./service.js";
import { enqueuedJobResponse, toTranscriptResponse, transcriptResponse } from "./model.js";

export const transcriptRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/api/video-assets/:videoAssetId/transcript",
    {
      schema: {
        summary: "Enqueue transcription of an asset",
        description: "Returns 202 with a job id — poll /api/video-processing-jobs/:jobId for progress.",
        tags: ["transcript"],
        params: videoAssetIdParam,
        response: { 202: enqueuedJobResponse, 404: errorResponse, 409: errorResponse },
      },
    },
    async (req, reply) => {
      const job = await transcriptService.requestTranscription(req.params.videoAssetId);
      return reply.code(202).send({ jobId: job.id });
    },
  );

  app.get(
    "/api/video-assets/:videoAssetId/transcript",
    {
      schema: {
        summary: "Get an asset's transcript with word timings",
        tags: ["transcript"],
        params: videoAssetIdParam,
        response: { 200: transcriptResponse, 404: errorResponse },
      },
    },
    async (req) => {
      const { transcript, words } = await transcriptService.getByAssetId(req.params.videoAssetId);
      return toTranscriptResponse(transcript, words);
    },
  );
};
