/**
 * Where media lives. Local disk today, s3:// later — assets carry a `uri`, and this
 * is the only module that decides what a uri means.
 */
import { mkdir, stat, unlink } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { config } from "../config.js";

/** Strip anything path-ish out of a client-supplied filename. */
export function safeExtension(filename: string): string {
  const ext = extname(filename).toLowerCase();
  return /^\.[a-z0-9]{1,5}$/.test(ext) ? ext : ".mp4";
}

export async function projectDir(videoProjectId: string): Promise<string> {
  const dir = join(config.mediaRoot, videoProjectId);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function assetPath(videoProjectId: string, assetId: string, filename: string): Promise<string> {
  return join(await projectDir(videoProjectId), `${assetId}${safeExtension(filename)}`);
}

/**
 * Guard against a uri escaping mediaRoot before we ever open it — the DB is not a
 * trust boundary, and this path reaches the filesystem.
 */
export function isInsideMediaRoot(uri: string): boolean {
  const root = resolve(config.mediaRoot);
  const target = resolve(uri);
  return target === root || target.startsWith(root + sep);
}

export async function fileSize(uri: string): Promise<number> {
  return (await stat(uri)).size;
}

export async function removeFile(uri: string): Promise<void> {
  await unlink(uri).catch(() => {}); // already gone is fine
}
