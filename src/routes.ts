import type { FastifyInstance } from "fastify";
import { Bench, HookNotFoundError } from "./store.js";

export interface BenchRoutesOpts {
  bench: Bench;
  maxBodyBytes: number;
}

function decodeBody(body: unknown, maxSize: number): {
  buffer: Buffer | null;
  size: number;
  truncated: boolean;
  text: string | null;
} {
  if (body === undefined || body === null) {
    return { buffer: null, size: 0, truncated: false, text: null };
  }
  let buffer: Buffer;
  if (Buffer.isBuffer(body)) {
    buffer = body;
  } else if (typeof body === "string") {
    buffer = Buffer.from(body, "utf8");
  } else {
    buffer = Buffer.from(JSON.stringify(body), "utf8");
  }
  const truncated = buffer.length > maxSize;
  const store = truncated ? buffer.subarray(0, maxSize) : buffer;
  const binary = store.includes(0);
  return {
    buffer: store,
    size: buffer.length,
    truncated,
    text: binary ? null : store.toString("utf8"),
  };
}

export function benchRoutes(app: FastifyInstance, opts: BenchRoutesOpts): void {
  const { bench, maxBodyBytes } = opts;
  const errorResponse = {
    type: "object",
    properties: { error: { type: "string" } },
    required: ["error"],
  } as const;

  app.post(
    "/hooks",
    {
      schema: {
        response: {
          201: {
            type: "object",
            properties: {
              id: { type: "string" },
              url: { type: "string" },
              createdAt: { type: "string" },
            },
            required: ["id", "url", "createdAt"],
          },
        },
      },
    },
    async (request, reply) => {
      const hook = bench.createHook();
      return reply.status(201).send({
        id: hook.id,
        url: `/hook/${hook.id}`,
        createdAt: hook.created_at,
      });
    }
  );

  app.get(
    "/hooks/:id/events",
    {
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!bench.getHook(id)) {
        return reply.status(404).send({ error: `hook "${id}" not found` });
      }
      const query = request.query as { limit?: string };
      const limit = Math.min(Number(query.limit) || 50, 100);
      const events = bench.listEvents(id, limit).map((e) => ({
        ...e,
        headers: JSON.parse(e.headers) as Record<string, string>,
      }));
      return reply.status(200).send({ count: bench.countEvents(id), events });
    }
  );

  app.get(
    "/hooks/:id/events/:eventId",
    {
    },
    async (request, reply) => {
      const { id, eventId } = request.params as { id: string; eventId: string };
      const event = bench.getEvent(id, Number(eventId));
      if (!event) {
        return reply
          .status(404)
          .send({ error: `event ${eventId} not found in hook "${id}"` });
      }
      const body = event.body;
      const binary = body ? body.includes(0) : false;
      return reply.status(200).send({
        ...event,
        headers: JSON.parse(event.headers) as Record<string, string>,
        body: body
          ? { size: event.body_size, text: binary ? null : body.toString("utf8"), base64: binary ? body.toString("base64") : null }
          : null,
      });
    }
  );

  app.delete(
    "/hooks/:id",
    {
      schema: {
        response: {
          200: {
            type: "object",
            properties: { deleted: { type: "boolean" } },
            required: ["deleted"],
          },
          404: errorResponse,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!bench.getHook(id)) {
        return reply.status(404).send({ error: `hook "${id}" not found` });
      }
      bench.deleteHook(id);
      return reply.status(200).send({ deleted: true });
    }
  );

  app.delete(
    "/hooks/:id/events",
    {
      schema: {
        response: {
          200: {
            type: "object",
            properties: { cleared: { type: "boolean" } },
            required: ["cleared"],
          },
          404: errorResponse,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!bench.getHook(id)) {
        return reply.status(404).send({ error: `hook "${id}" not found` });
      }
      bench.clearEvents(id);
      return reply.status(200).send({ cleared: true });
    }
  );

  app.post(
    "/hooks/:id/events/:eventId/replay",
    {
      schema: {
        body: {
          type: "object",
          required: ["target"],
          properties: {
            target: { type: "string" },
            headers: { type: "object", additionalProperties: { type: "string" } },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              delivered: { type: "boolean" },
              status: { type: ["number", "null"] },
              error: { type: ["string", "null"] },
            },
            required: ["delivered", "status", "error"],
          },
          400: errorResponse,
          404: errorResponse,
        },
      },
    },
    async (request, reply) => {
      const { id, eventId } = request.params as { id: string; eventId: string };
      const event = bench.getEvent(id, Number(eventId));
      if (!event) {
        return reply
          .status(404)
          .send({ error: `event ${eventId} not found in hook "${id}"` });
      }
      const body = request.body as {
        target: string;
        headers?: Record<string, string>;
      };
      if (!/^https?:\/\//.test(body.target)) {
        return reply
          .status(400)
          .send({ error: "target must be an http(s) url" });
      }

      const outboundHeaders: Record<string, string> = JSON.parse(event.headers);
      delete outboundHeaders.host;
      delete outboundHeaders["content-length"];
      delete outboundHeaders.connection;
      for (const [k, v] of Object.entries(body.headers ?? {})) {
        outboundHeaders[k.toLowerCase()] = v;
      }

      try {
        const res = await fetch(body.target, {
          method: event.method,
          headers: outboundHeaders,
          body:
            event.body && event.method !== "GET" && event.method !== "HEAD"
              ? event.body
              : undefined,
        });
        return reply.status(200).send({
          delivered: true,
          status: res.status,
          error: null,
        });
      } catch (err) {
        return reply.status(200).send({
          delivered: false,
          status: null,
          error: (err as Error).message.slice(0, 200),
        });
      }
    }
  );

  app.all(
    "/hook/:id",
    {
      schema: {
        response: {
          200: {
            type: "object",
            properties: { ok: { type: "boolean" } },
            required: ["ok"],
          },
          404: errorResponse,
          413: errorResponse,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!bench.getHook(id)) {
        return reply.status(404).send({ error: `hook "${id}" not found` });
      }

      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(request.headers)) {
        headers[key] = Array.isArray(value) ? value.join(", ") : String(value);
      }

      const decoded = decodeBody(request.body, maxBodyBytes);
      if (decoded.truncated) {
        return reply
          .status(413)
          .send({ error: `body too large (max ${maxBodyBytes} bytes)` });
      }

      bench.recordEvent({
        hookId: id,
        method: request.method,
        path: request.url.split("?")[0] ?? request.url,
        query: request.url.includes("?") ? request.url.split("?")[1]! : null,
        headers,
        body: decoded.buffer,
      });

      return reply.status(200).send({ ok: true });
    }
  );
}
