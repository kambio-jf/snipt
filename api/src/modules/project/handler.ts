// Routes for video_project — the reference pattern for the other four modules.
// Schemas here drive runtime validation AND the generated OpenAPI spec, so the
// contract and the code can't drift.
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { videoProjectService } from "./service.js";
import {
  createVideoProjectBody,
  errorResponse,
  noContentResponse,
  toVideoProjectResponse,
  updateVideoProjectBody,
  videoProjectIdParam,
  videoProjectListResponse,
  videoProjectResponse,
} from "./model.js";

export const videoProjectRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/api/video-projects",
    {
      schema: {
        summary: "List video projects",
        tags: ["project"],
        response: { 200: videoProjectListResponse },
      },
    },
    async () => ({ items: (await videoProjectService.list()).map(toVideoProjectResponse) }),
  );

  app.post(
    "/api/video-projects",
    {
      schema: {
        summary: "Create a video project",
        tags: ["project"],
        body: createVideoProjectBody,
        response: { 201: videoProjectResponse },
      },
    },
    async (req, reply) => {
      const row = await videoProjectService.create(req.body);
      return reply.code(201).send(toVideoProjectResponse(row));
    },
  );

  app.get(
    "/api/video-projects/:videoProjectId",
    {
      schema: {
        summary: "Get a video project",
        tags: ["project"],
        params: videoProjectIdParam,
        response: { 200: videoProjectResponse, 404: errorResponse },
      },
    },
    async (req) => toVideoProjectResponse(await videoProjectService.get(req.params.videoProjectId)),
  );

  app.patch(
    "/api/video-projects/:videoProjectId",
    {
      schema: {
        summary: "Update a video project",
        tags: ["project"],
        params: videoProjectIdParam,
        body: updateVideoProjectBody,
        response: { 200: videoProjectResponse, 404: errorResponse },
      },
    },
    async (req) => toVideoProjectResponse(await videoProjectService.update(req.params.videoProjectId, req.body)),
  );

  app.delete(
    "/api/video-projects/:videoProjectId",
    {
      schema: {
        summary: "Delete a video project",
        tags: ["project"],
        params: videoProjectIdParam,
        response: { 204: noContentResponse, 404: errorResponse },
      },
    },
    async (req, reply) => {
      await videoProjectService.remove(req.params.videoProjectId);
      return reply.code(204).send(null);
    },
  );
};
