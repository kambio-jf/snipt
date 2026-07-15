import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { resolve } from "node:path";
import { config } from "../config.js";
import { db } from "./client.js";

migrate(db, { migrationsFolder: resolve(import.meta.dirname, "..", "..", "drizzle") });
console.log(`migrated ${config.databaseUrl}`);
