// Zod schemas + domain types for the project module.
// These live at the handler boundary and auto-generate the OpenAPI spec; request
// shapes (DTOs) are mapped to domain types here and never reach service/dao.
import { z } from "zod";

export const videoProjectIdParam = z.object({
  videoProjectId: z.string().uuid(),
});

export const createVideoProjectBody = z.object({
  name: z.string().min(1).max(200),
});

export const updateVideoProjectBody = z
  .object({
    name: z.string().min(1).max(200),
  })
  .partial();

export const videoProjectResponse = z.object({
  id: z.string().uuid(),
  name: z.string(),
  userId: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const videoProjectListResponse = z.object({
  items: z.array(videoProjectResponse),
});

export const errorResponse = z.object({
  code: z.string(),
  message: z.string(),
});

/** 204 — every response needs a Zod schema for the provider to build the spec. */
export const noContentResponse = z.null();

export type CreateVideoProject = z.infer<typeof createVideoProjectBody>;
export type UpdateVideoProject = z.infer<typeof updateVideoProjectBody>;
export type VideoProjectResponse = z.infer<typeof videoProjectResponse>;

/** Row shape as the DAO returns it. */
export interface VideoProjectRow {
  id: string;
  name: string;
  userId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Domain row → wire DTO. The only place Dates become strings. */
export const toVideoProjectResponse = (row: VideoProjectRow): VideoProjectResponse => ({
  id: row.id,
  name: row.name,
  userId: row.userId,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
