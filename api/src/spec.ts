// Emit openapi.json without running the server — the web workspace generates its
// typed client from this, so the contract is single-sourced from the handlers.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildApp } from "./app.js";

const app = await buildApp();
await app.ready();

const out = resolve(import.meta.dirname, "..", "openapi.json");
writeFileSync(out, JSON.stringify(app.swagger(), null, 2));
console.log(`wrote ${out}`);

await app.close();
