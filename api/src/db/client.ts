import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "../config.js";
import * as schema from "./schema.js";

mkdirSync(dirname(config.databaseUrl), { recursive: true });

const sqlite = new Database(config.databaseUrl);
sqlite.pragma("journal_mode = WAL"); // concurrent reads while a worker writes
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
export type Db = typeof db;
export { schema };
