import { ConflictError, NotFoundError } from "../../lib/errors.js";
import { enqueue, type JobRow } from "../../lib/queue.js";
import { videoAssetService } from "../video/service.js";
import { transcriptDao } from "./dao.js";
import type { TranscriptRow, TranscriptWordRow } from "./model.js";

export const transcriptService = {
  /**
   * Enqueue transcription. Never runs Whisper inline — a 47-min video is ~25-35 min
   * of inference, so the handler gets a job id back and the SPA polls it.
   */
  async requestTranscription(videoAssetId: string): Promise<JobRow> {
    const asset = await videoAssetService.get(videoAssetId);

    const existing = await transcriptDao.findByAssetId(videoAssetId);
    if (existing?.status === "pending") {
      throw new ConflictError(`video_asset ${videoAssetId} is already being transcribed`);
    }

    return enqueue({
      jobType: "transcribe_asset",
      payload: { videoAssetId },
      videoProjectId: asset.videoProjectId,
    });
  },

  async getByAssetId(videoAssetId: string): Promise<{ transcript: TranscriptRow; words: TranscriptWordRow[] }> {
    await videoAssetService.get(videoAssetId);
    const transcript = await transcriptDao.findByAssetId(videoAssetId);
    if (!transcript) throw new NotFoundError("transcript for video_asset", videoAssetId);
    // only a ready transcript has words worth reading
    const words = transcript.status === "ready" ? await transcriptDao.listWords(transcript.id) : [];
    return { transcript, words };
  },
};
