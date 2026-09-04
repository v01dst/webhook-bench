import { describe, expect, it, afterAll } from "vitest";
import { createApp } from "../src/app.js";

const app = createApp();
afterAll(() => app.close());

async function makeHook() {
  const res = await app.inject({ method: "POST", url: "/hooks" });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string; url: string; createdAt: string };
}

describe("hook lifecycle", () => {
  it("creates hooks with catch-all urls", async () => {
    const hook = await makeHook();
    expect(hook.id).toMatch(/^[a-z0-9]{12}$/);
    expect(hook.url).toBe(`/hook/${hook.id}`);
  });

  it("catches json webhooks", async () => {
    const hook = await makeHook();
    const send = await app.inject({
      method: "POST",
      url: `/hook/${hook.id}`,
      payload: { event: "payment.succeeded", amount: 42 },
    });
    expect(send.statusCode).toBe(200);

    const list = await app.inject({ url: `/hooks/${hook.id}/events` });
    const body = list.json();
    expect(body.count).toBe(1);
    expect(body.events[0].method).toBe("POST");
    const detail = await app.inject({
      url: `/hooks/${hook.id}/events/${body.events[0].id}`,
    });
    expect(detail.json().body.text).toContain("payment.succeeded");
  });

  it("catches any method and path", async () => {
    const hook = await makeHook();
    for (const method of ["GET", "PUT", "PATCH", "DELETE"]) {
      const res = await app.inject({
        method: method as "GET",
        url: `/hook/${hook.id}?source=ci&run=42`,
      });
      expect(res.statusCode).toBe(200);
    }
    const list = await app.inject({ url: `/hooks/${hook.id}/events` });
    const body = list.json();
    expect(body.count).toBe(4);
    expect(body.events[0].query).toBe("source=ci&run=42");
    const methods = body.events.map((e: { method: string }) => e.method);
    expect(methods).toContain("DELETE");
    expect(methods).toContain("PATCH");
  });

  it("stores raw bodies as text and binary safely", async () => {
    const hook = await makeHook();
    await app.inject({
      method: "POST",
      url: `/hook/${hook.id}`,
      payload: Buffer.from([0, 1, 2, 255]),
      headers: { "content-type": "application/octet-stream" },
    });
    await app.inject({
      method: "POST",
      url: `/hook/${hook.id}`,
      payload: "plain text body",
      headers: { "content-type": "text/plain" },
    });

    const list = await app.inject({ url: `/hooks/${hook.id}/events` });
    const ids = list.json().events.map((e: { id: number }) => e.id);

    const bin = await app.inject({ url: `/hooks/${hook.id}/events/${ids[1]}` });
    expect(bin.json().body.text).toBeNull();
    expect(bin.json().body.base64).toBe("AAEC/w==");

    const txt = await app.inject({ url: `/hooks/${hook.id}/events/${ids[0]}` });
    expect(txt.json().body.text).toBe("plain text body");
  });

  it("records headers", async () => {
    const hook = await makeHook();
    await app.inject({
      method: "POST",
      url: `/hook/${hook.id}`,
      headers: { "x-github-event": "push", "user-agent": "GitHub-Hookshot/1" },
    });
    const list = await app.inject({ url: `/hooks/${hook.id}/events` });
    const event = list.json().events[0];
    expect(event.headers["x-github-event"]).toBe("push");
    expect(event.headers["user-agent"]).toBe("GitHub-Hookshot/1");
  });

  it("clears events", async () => {
    const hook = await makeHook();
    await app.inject({ method: "POST", url: `/hook/${hook.id}`, payload: "x" });
    await app.inject({ method: "DELETE", url: `/hooks/${hook.id}/events` });
    const list = await app.inject({ url: `/hooks/${hook.id}/events` });
    expect(list.json().count).toBe(0);
  });

  it("deletes hooks", async () => {
    const hook = await makeHook();
    await app.inject({ method: "POST", url: `/hook/${hook.id}`, payload: "x" });
    const del = await app.inject({ method: "DELETE", url: `/hooks/${hook.id}` });
    expect(del.json().deleted).toBe(true);
    const list = await app.inject({ url: `/hooks/${hook.id}/events` });
    expect(list.statusCode).toBe(404);
    const hookAgain = await app.inject({
      method: "POST",
      url: `/hook/${hook.id}`,
      payload: "x",
    });
    expect(hookAgain.statusCode).toBe(404);
  });

  it("404s unknown hooks", async () => {
    const res = await app.inject({ method: "POST", url: "/hook/nope123", payload: "x" });
    expect(res.statusCode).toBe(404);
    const list = await app.inject({ url: "/hooks/nope123/events" });
    expect(list.statusCode).toBe(404);
  });
});

describe("meta", () => {
  it("health works", async () => {
    const res = await app.inject({ url: "/health" });
    expect(res.json().status).toBe("ok");
  });

  it("root describes service", async () => {
    const res = await app.inject({ url: "/" });
    expect(res.json().service).toBe("webhook-bench");
  });
});

describe("replay", () => {
  it("replays a captured event to a live local target", async () => {
    const app2 = createApp({ config: {} });
    await app2.listen({ port: 0, host: "127.0.0.1" });
    const addr = app2.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;

    const target = await app2.inject({ method: "POST", url: "/hooks" });
    const targetId = target.json().id;

    const source = await app2.inject({ method: "POST", url: "/hooks" });
    const sourceId = source.json().id;
    await app2.inject({
      method: "POST",
      url: `/hook/${sourceId}`,
      payload: { kind: "payment", amount: 7 },
    });
    const list = await app2.inject({ url: `/hooks/${sourceId}/events` });
    const eventId = list.json().events[0].id;

    const replay = await app2.inject({
      method: "POST",
      url: `/hooks/${sourceId}/events/${eventId}/replay`,
      payload: { target: `http://127.0.0.1:${port}/hook/${targetId}` },
    });
    expect(replay.statusCode).toBe(200);
    const body = replay.json();
    expect(body.delivered).toBe(true);
    expect(body.status).toBe(200);

    const delivered = await app2.inject({ url: `/hooks/${targetId}/events` });
    expect(delivered.json().count).toBe(1);
    const detail = await app2.inject({
      url: `/hooks/${targetId}/events/${delivered.json().events[0].id}`,
    });
    expect(detail.json().body.text).toContain("payment");
    await app2.close();
  });

  it("rejects non-http targets", async () => {
    const app2 = createApp({ config: {} });
    const source = await app2.inject({ method: "POST", url: "/hooks" });
    const sourceId = source.json().id;
    await app2.inject({ method: "POST", url: `/hook/${sourceId}`, payload: "x" });
    const list = await app2.inject({ url: `/hooks/${sourceId}/events` });
    const eventId = list.json().events[0].id;

    const replay = await app2.inject({
      method: "POST",
      url: `/hooks/${sourceId}/events/${eventId}/replay`,
      payload: { target: "ftp://nope" },
    });
    expect(replay.statusCode).toBe(400);
    await app2.close();
  });

  it("reports unreachable targets without throwing", async () => {
    const app2 = createApp({ config: {} });
    const source = await app2.inject({ method: "POST", url: "/hooks" });
    const sourceId = source.json().id;
    await app2.inject({ method: "POST", url: `/hook/${sourceId}`, payload: "x" });
    const list = await app2.inject({ url: `/hooks/${sourceId}/events` });
    const eventId = list.json().events[0].id;

    const replay = await app2.inject({
      method: "POST",
      url: `/hooks/${sourceId}/events/${eventId}/replay`,
      payload: { target: "http://127.0.0.1:9/unreachable" },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().delivered).toBe(false);
    expect(replay.json().error).toBeTruthy();
    await app2.close();
  });

  it("404s unknown events", async () => {
    const app2 = createApp({ config: {} });
    const source = await app2.inject({ method: "POST", url: "/hooks" });
    const sourceId = source.json().id;
    const replay = await app2.inject({
      method: "POST",
      url: `/hooks/${sourceId}/events/999/replay`,
      payload: { target: "http://localhost/x" },
    });
    expect(replay.statusCode).toBe(404);
    await app2.close();
  });
});
