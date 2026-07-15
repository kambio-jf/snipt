// Data access for video_project. Knows Drizzle; knows nothing about HTTP.
// This layer is what keeps the SQLite → Aurora swap contained.
import { desc, eq } from "drizzle-orm";
import { db, schema } from "../../db/client.js";
import type { CreateVideoProject, UpdateVideoProject, VideoProjectRow } from "./model.js";

export const videoProjectDao = {
  async list(): Promise<VideoProjectRow[]> {
    return db.select().from(schema.videoProject).orderBy(desc(schema.videoProject.createdAt));
  },

  async findById(id: string): Promise<VideoProjectRow | undefined> {
    const [row] = await db.select().from(schema.videoProject).where(eq(schema.videoProject.id, id)).limit(1);
    return row;
  },

  async create(data: CreateVideoProject): Promise<VideoProjectRow> {
    const [row] = await db.insert(schema.videoProject).values({ name: data.name }).returning();
    return row!;
  },

  async update(id: string, data: UpdateVideoProject): Promise<VideoProjectRow | undefined> {
    const [row] = await db
      .update(schema.videoProject)
      .set(data)
      .where(eq(schema.videoProject.id, id))
      .returning();
    return row;
  },

  async remove(id: string): Promise<boolean> {
    const rows = await db.delete(schema.videoProject).where(eq(schema.videoProject.id, id)).returning();
    return rows.length > 0;
  },
};
