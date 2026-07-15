import { createWriteStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import { AppError, NotFoundError } from "../../lib/errors.js";
import { probeMedia } from "../../lib/media.js";
import { assetPath, removeFile } from "../../lib/storage.js";
import { videoProjectService } from "../project/service.js";
import { videoAssetDao } from "./dao.js";
import type { VideoAssetRow } from "./model.js";

export const videoAssetService = {
  async get(id: string): Promise<VideoAssetRow> {
    const row = await videoAssetDao.findById(id);
    if (!row) throw new NotFoundError("video_asset", id);
    return row;
  },

  async listByProject(videoProjectId: string): Promise<VideoAssetRow[]> {
    await videoProjectService.get(videoProjectId); // 404 rather than an empty list for a bad project
    return videoAssetDao.listByProject(videoProjectId);
  },

  /**
   * Stream an upload to disk, probe it, and record it as a source_recording.
   * The file is written before the row exists, so a failed probe cleans up after itself
   * rather than leaving an orphan on disk.
   */
  async uploadSourceRecording(input: {
    videoProjectId: string;
    filename: string;
    stream: Readable;
  }): Promise<VideoAssetRow> {
    await videoProjectService.get(input.videoProjectId);

    const assetId = randomUUID();
    const uri = await assetPath(input.videoProjectId, assetId, input.filename);

    await pipeline(input.stream, createWriteStream(uri));

    let metadata;
    try {
      metadata = await probeMedia(uri);
    } catch {
      await removeFile(uri);
      throw new AppError("Uploaded file is not readable video", 400, "BAD_MEDIA");
    }

    if (metadata.durationS === null) {
      await removeFile(uri);
      throw new AppError("Uploaded file has no readable duration", 400, "BAD_MEDIA");
    }

    return videoAssetDao.create({
      id: assetId, // the file on disk is named for the row — keep them the same id
      videoProjectId: input.videoProjectId,
      parentVideoAssetId: null,
      assetType: "source_recording",
      uri,
      ...metadata,
    });
  },

  async remove(id: string): Promise<void> {
    const asset = await this.get(id);
    await videoAssetDao.remove(id);
    await removeFile(asset.uri);
  },
};
