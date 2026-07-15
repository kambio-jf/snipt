import { desc, eq } from "drizzle-orm";
import { db, schema } from "../../db/client.js";
import type { VideoAssetRow } from "./model.js";

export const videoAssetDao = {
  async findById(id: string): Promise<VideoAssetRow | undefined> {
    const [row] = await db.select().from(schema.videoAsset).where(eq(schema.videoAsset.id, id)).limit(1);
    return row;
  },

  async listByProject(videoProjectId: string): Promise<VideoAssetRow[]> {
    return db
      .select()
      .from(schema.videoAsset)
      .where(eq(schema.videoAsset.videoProjectId, videoProjectId))
      .orderBy(desc(schema.videoAsset.createdAt));
  },

  async create(data: Omit<VideoAssetRow, "createdAt">): Promise<VideoAssetRow> {
    const [row] = await db.insert(schema.videoAsset).values(data).returning();
    return row!;
  },

  async remove(id: string): Promise<boolean> {
    const rows = await db.delete(schema.videoAsset).where(eq(schema.videoAsset.id, id)).returning();
    return rows.length > 0;
  },
};
