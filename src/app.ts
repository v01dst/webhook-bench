import Fastify, { type FastifyInstance } from "fastify";
import { openDb, type Db } from "./db.js";
import { Bench } from "./store.js";
import { DEFAULT_CONFIG, type Config } from "./config.js";
import { benchRoutes } from "./routes.js";

export interface AppOptions {
  config?: Partial<Config>;
  db?: Db;
  logger?: boolean;
}

export function createApp(opts: AppOptions = {}): FastifyInstance {
  const config: Config = { ...DEFAULT_CONFIG, ...opts.config };
  const db = opts.db ?? openDb(":memory:");
  const bench = new Bench(db);
  const startedAt = Date.now();

  const app = Fastify({
    logger: opts.logger ?? false,
    bodyLimit: config.maxBodyBytes + 16 * 1024,
  });

  app.addContentTypeParser("*", { parseAs: "buffer" }, (_req, body, done) => {
    done(null, body);
  });

  app.get("/", async () => ({
    service: "webhook-bench",
    version: "1.0.0",
    author: "v01dst",
  }));

  app.get("/health", async () => ({
    status: "ok",
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
  }));

  app.register((instance, _o, done) => {
    benchRoutes(instance, { bench, maxBodyBytes: config.maxBodyBytes });
    done();
  });

  app.addHook("onClose", async () => {
    if (!opts.db) db.close();
  });

  return app;
}
