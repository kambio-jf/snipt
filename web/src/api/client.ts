// Typed client generated from the API's OpenAPI spec — `npm run gen:api` after
// changing any handler schema. Nothing here is hand-maintained.
import createClient from "openapi-fetch";
import type { paths } from "./schema.js";

export const api = createClient<paths>({ baseUrl: "" });
