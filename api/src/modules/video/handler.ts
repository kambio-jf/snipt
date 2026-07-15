import { createReadStream } from "node:fs";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { AppError } from "../../lib/errors.js";
import { fileSize, isInsideMediaRoot } from "../../lib/storage.js";
import { errorResponse, noContentResponse } from "../project/model.js";
import { videoProjectIdParam } from "../project/model.js";
import { videoAssetService } from "./service.js";
import { toVideoAssetResponse, videoAssetIdParam, videoAssetListResponse, videoAssetResponse } from "./model.js";

export const videoAssetRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/api/video-projects/:videoProjectId/video-assets",
    {
      schema: {
        summary: "List a project's video assets",
        tags: ["video"],
        params: videoProjectIdParam,
        response: { 200: videoAssetListResponse, 404: errorResponse },
      },
    },
    async (req) => ({
      items: (await videoAssetService.listByProject(req.params.videoProjectId)).map(toVideoAssetResponse),
    }),
  );

  app.post(
    "/api/video-projects/:videoProjectId/video-assets",
    {
      schema: {
        summary: "Upload a source recording (multipart/form-data, field: file)",
        description: "Streams the upload to disk, probes it with ffprobe, and records a source_recording asset.",
        tags: ["video"],
        consumes: ["multipart/form-data"],
        params: videoProjectIdParam,
        response: { 201: videoAssetResponse, 400: errorResponse, 404: errorResponse, 413: errorResponse },
      },
    },
    async (req, reply) => {
      const file = await req.file();
      if (!file) throw new AppError("Expected a multipart file field named 'file'", 400, "BAD_REQUEST");

      const asset = await videoAssetService.uploadSourceRecording({
        videoProjectId: req.params.videoProjectId,
        filename: file.filename,
        stream: file.file,
      });

      // @fastify/multipart flags this rather than throwing, so check it explicitly
      if (file.file.truncated) {
        await videoAssetService.remove(asset.id);
        throw new AppError("Upload exceeded the maximum file size", 413, "FILE_TOO_LARGE");
      }

      return reply.code(201).send(toVideoAssetResponse(asset));
    },
  );

  app.get(
    "/api/video-assets/:videoAssetId",
    {
      schema: {
        summary: "Get a video asset",
        tags: ["video"],
        params: videoAssetIdParam,
        response: { 200: videoAssetResponse, 404: errorResponse },
      },
    },
    async (req) => toVideoAssetResponse(await videoAssetService.get(req.params.videoAssetId)),
  );

  /**
   * Range support is what makes instant preview possible (KMBO-253): the SPA plays the
   * original and seeks past cut regions, so this must serve partial content.
   */
  app.get(
    "/api/video-assets/:videoAssetId/file",
    {
      schema: {
        summary: "Stream the asset's file (supports HTTP Range)",
        tags: ["video"],
        params: videoAssetIdParam,
        response: { 200: z.any(), 206: z.any(), 403: errorResponse, 404: errorResponse, 416: z.null() },
      },
    },
    async (req, reply) => {
      const asset = await videoAssetService.get(req.params.videoAssetId);
      if (!isInsideMediaRoot(asset.uri)) throw new AppError("Asset is outside the media root", 403, "FORBIDDEN");

      const size = await fileSize(asset.uri);
      const range = req.headers.range;

      reply.header("Accept-Ranges", "bytes").header("Content-Type", "video/mp4");

      if (!range) {
        reply.header("Content-Length", size);
        return reply.send(createReadStream(asset.uri));
      }

      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) return reply.code(416).header("Content-Range", `bytes */${size}`).send(null);

      // an open-ended suffix range ("bytes=-500") means the LAST 500 bytes
      const [, rawStart, rawEnd] = match;
      let start = rawStart ? Number(rawStart) : size - Number(rawEnd);
      let end = rawStart ? (rawEnd ? Number(rawEnd) : size - 1) : size - 1;
      end = Math.min(end, size - 1);

      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end) {
        return reply.code(416).header("Content-Range", `bytes */${size}`).send(null);
      }

      return reply
        .code(206)
        .header("Content-Range", `bytes ${start}-${end}/${size}`)
        .header("Content-Length", end - start + 1)
        .send(createReadStream(asset.uri, { start, end }));
    },
  );

  app.delete(
    "/api/video-assets/:videoAssetId",
    {
      schema: {
        summary: "Delete a video asset and its file",
        tags: ["video"],
        params: videoAssetIdParam,
        response: { 204: noContentResponse, 404: errorResponse },
      },
    },
    async (req, reply) => {
      await videoAssetService.remove(req.params.videoAssetId);
      return reply.code(204).send(null);
    },
  );
};
