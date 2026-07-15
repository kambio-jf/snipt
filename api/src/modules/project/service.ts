// Business rules for video_project. Throws domain errors; app.ts maps them to status codes.
import { NotFoundError } from "../../lib/errors.js";
import { videoProjectDao } from "./dao.js";
import type { CreateVideoProject, UpdateVideoProject, VideoProjectRow } from "./model.js";

export const videoProjectService = {
  async list(): Promise<VideoProjectRow[]> {
    return videoProjectDao.list();
  },

  async get(id: string): Promise<VideoProjectRow> {
    const row = await videoProjectDao.findById(id);
    if (!row) throw new NotFoundError("video_project", id);
    return row;
  },

  async create(data: CreateVideoProject): Promise<VideoProjectRow> {
    return videoProjectDao.create(data);
  },

  async update(id: string, data: UpdateVideoProject): Promise<VideoProjectRow> {
    const row = await videoProjectDao.update(id, data);
    if (!row) throw new NotFoundError("video_project", id);
    return row;
  },

  async remove(id: string): Promise<void> {
    const deleted = await videoProjectDao.remove(id);
    if (!deleted) throw new NotFoundError("video_project", id);
  },
};
