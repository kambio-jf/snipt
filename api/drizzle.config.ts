import { defineConfig } from "drizzle-kit";
import { resolve } from "node:path";

// drizzle-kit compiles this to CJS: it won't resolve NodeNext's ".js" specifiers
// (so no importing src/config.ts) and import.meta is empty (so cwd, which drizzle-kit
// sets to api/, stands in). Keep the default in sync with config.databaseUrl.
const databaseUrl = process.env.DATABASE_URL ?? resolve(process.cwd(), "..", "data", "video-tools.db");

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: databaseUrl },
});
