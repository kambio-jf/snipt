// transcribe_asset — word-level Whisper -> correction rules -> transcript + transcript_word[].
import { runWordWhisperAsync } from "@video-tools/lib";
import { eq } from "drizzle-orm";
import { db, schema } from "../../db/client.js";
import { correctionRuleDao } from "../../modules/transcript/dao.js";
import type { JobContext, JobRunner } from "./types.js";

/** Batched so a 47-min video (~7.7k words) doesn't blow SQLite's variable limit. */
const WORD_INSERT_CHUNK = 500;

export const transcribeAsset: JobRunner = async ({ job, setProgress, setStage, signal }: JobContext) => {
  const { videoAssetId } = job.payload as { videoAssetId?: string };
  if (!videoAssetId) throw new Error("payload.videoAssetId is required");

  const [asset] = await db.select().from(schema.videoAsset).where(eq(schema.videoAsset.id, videoAssetId)).limit(1);
  if (!asset) throw new Error(`video_asset ${videoAssetId} not found`);

  setStage("preparing");

  // one transcript per asset — re-running replaces the previous words
  const [existing] = await db
    .select()
    .from(schema.transcript)
    .where(eq(schema.transcript.videoAssetId, videoAssetId))
    .limit(1);

  const transcript =
    existing ??
    (await db
      .insert(schema.transcript)
      .values({ videoAssetId, model: "ggml-base.en", status: "pending" })
      .returning())[0]!;

  if (existing) {
    await db.delete(schema.transcriptWord).where(eq(schema.transcriptWord.transcriptId, transcript.id));
    await db.update(schema.transcript).set({ status: "pending" }).where(eq(schema.transcript.id, transcript.id));
  }

  try {
    // the dictionary lives in the DB (KMBO-256 edits it); the CLI still reads corrections.json
    const rules = (await correctionRuleDao.listEnabled()).map((r) => ({ from: r.fromText, to: r.toText }));

    setStage("transcribing");
    const words = await runWordWhisperAsync(asset.uri, {
      rules,
      durationS: asset.durationS ?? undefined,
      onProgress: setProgress,
      signal,
    });

    setStage("saving transcript");
    for (let i = 0; i < words.length; i += WORD_INSERT_CHUNK) {
      await db.insert(schema.transcriptWord).values(
        words.slice(i, i + WORD_INSERT_CHUNK).map((w) => ({
          transcriptId: transcript.id,
          idx: w.i,
          startS: w.start,
          endS: w.end,
          text: w.text,
        })),
      );
    }

    await db.update(schema.transcript).set({ status: "ready" }).where(eq(schema.transcript.id, transcript.id));
    return { transcriptId: transcript.id, wordCount: words.length };
  } catch (err) {
    await db.update(schema.transcript).set({ status: "failed" }).where(eq(schema.transcript.id, transcript.id));
    throw err;
  }
};
