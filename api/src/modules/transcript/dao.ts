import { asc, eq } from "drizzle-orm";
import { db, schema } from "../../db/client.js";
import type { TranscriptRow, TranscriptWordRow } from "./model.js";

export const transcriptDao = {
  async findByAssetId(videoAssetId: string): Promise<TranscriptRow | undefined> {
    const [row] = await db
      .select()
      .from(schema.transcript)
      .where(eq(schema.transcript.videoAssetId, videoAssetId))
      .limit(1);
    return row;
  },

  async listWords(transcriptId: string): Promise<TranscriptWordRow[]> {
    return db
      .select({
        idx: schema.transcriptWord.idx,
        startS: schema.transcriptWord.startS,
        endS: schema.transcriptWord.endS,
        text: schema.transcriptWord.text,
      })
      .from(schema.transcriptWord)
      .where(eq(schema.transcriptWord.transcriptId, transcriptId))
      .orderBy(asc(schema.transcriptWord.idx));
  },
};

export const correctionRuleDao = {
  async listEnabled() {
    return db
      .select()
      .from(schema.transcriptCorrectionRule)
      .where(eq(schema.transcriptCorrectionRule.enabled, true));
  },

  async count(): Promise<number> {
    return (await db.select({ id: schema.transcriptCorrectionRule.id }).from(schema.transcriptCorrectionRule)).length;
  },
};
