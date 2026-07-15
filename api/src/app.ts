import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { config } from "./config.js";
import { AppError } from "./lib/errors.js";
import { videoProjectRoutes } from "./modules/project/handler.js";

export async function buildApp() {
  const app = Fastify({ logger: { level: config.logLevel } }).withTypeProvider<ZodTypeProvider>();

  // Zod drives both runtime validation and the generated spec
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cors, { origin: true });

  await app.register(swagger, {
    openapi: {
      info: { title: "Video Tools API", version: "0.1.0" },
      servers: [{ url: `http://${config.host}:${config.port}` }],
      tags: [
        { name: "project", description: "Video projects" },
        { name: "video", description: "Video assets + rendering" },
        { name: "transcript", description: "Transcripts, edits, correction rules" },
        { name: "short", description: "Shorts, layouts, cues, keyframes" },
        { name: "processor", description: "Processing jobs" },
      ],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({ code: err.code, message: err.message });
    }
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.code(400).send({
        code: "BAD_REQUEST",
        message: err.validation.map((v) => `${v.instancePath || "(root)"} ${v.message}`).join("; "),
      });
    }
    app.log.error(err);
    return reply.code(500).send({ code: "INTERNAL", message: "Internal server error" });
  });

  app.get("/health", { schema: { hide: true } }, async () => ({ ok: true }));

  await app.register(videoProjectRoutes);
  // modules/video, transcript, short, processor register here as they land

  return app;
}
