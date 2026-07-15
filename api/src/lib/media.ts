// mediaRunner — ffprobe/ffmpeg wrappers. Async and non-blocking: cutlib's sync
// helpers are for the CLI; anything the server touches goes through here.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export interface MediaMetadata {
  durationS: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
}

/** Parse ffprobe's fps as the rational it is ("30000/1001"), not a float. */
function parseFps(rate: string | undefined): number | null {
  if (!rate) return null;
  const [num, den] = rate.split("/").map(Number);
  if (!num || !den) return null;
  return Math.round((num / den) * 1000) / 1000;
}

export async function probeMedia(file: string): Promise<MediaMetadata> {
  const { stdout } = await exec("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "format=duration:stream=width,height,avg_frame_rate",
    "-of", "json",
    file,
  ]);

  const probe = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: { width?: number; height?: number; avg_frame_rate?: string }[];
  };
  const stream = probe.streams?.[0];
  const duration = Number(probe.format?.duration);

  return {
    durationS: Number.isFinite(duration) ? duration : null,
    width: stream?.width ?? null,
    height: stream?.height ?? null,
    fps: parseFps(stream?.avg_frame_rate),
  };
}
