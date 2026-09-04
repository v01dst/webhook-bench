import { randomBytes } from "node:crypto";
import type { Db } from "./db.js";

export class HookNotFoundError extends Error {
  constructor(id: string) {
    super(`hook "${id}" not found`);
    this.name = "HookNotFoundError";
  }
}

export interface EventRow {
  id: number;
  hook_id: string;
  received_at: string;
  method: string;
  path: string;
  query: string | null;
  headers: string;
  body: Buffer | null;
  body_size: number;
}

export interface HookRow {
  id: string;
  created_at: string;
}

function id(len = 12): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return out;
}

export class Bench {
  constructor(private readonly db: Db) {}

  createHook(): HookRow {
    const hookId = id();
    this.db.prepare("INSERT INTO hooks (id) VALUES (?)").run(hookId);
    return this.getHook(hookId)!;
  }

  getHook(hookId: string): HookRow | undefined {
    return this.db.prepare("SELECT * FROM hooks WHERE id = ?").get(hookId) as
      | HookRow
      | undefined;
  }

  deleteHook(hookId: string): boolean {
    const info = this.db.prepare("DELETE FROM hooks WHERE id = ?").run(hookId);
    return info.changes > 0;
  }

  clearEvents(hookId: string): void {
    this.db.prepare("DELETE FROM events WHERE hook_id = ?").run(hookId);
  }

  recordEvent(input: {
    hookId: string;
    method: string;
    path: string;
    query: string | null;
    headers: Record<string, string>;
    body: Buffer | null;
  }): EventRow {
    const headersJson = JSON.stringify(input.headers);
    const bodySize = input.body ? input.body.length : 0;
    const info = this.db
      .prepare(
        "INSERT INTO events (hook_id, method, path, query, headers, body, body_size) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        input.hookId,
        input.method,
        input.path,
        input.query,
        headersJson,
        input.body,
        bodySize
      );
    return this.getEvent(input.hookId, Number(info.lastInsertRowid))!;
  }

  getEvent(hookId: string, eventId: number): EventRow | undefined {
    return this.db
      .prepare("SELECT * FROM events WHERE hook_id = ? AND id = ?")
      .get(hookId, eventId) as EventRow | undefined;
  }

  listEvents(hookId: string, limit = 50): Omit<EventRow, "body">[] {
    return this.db
      .prepare(
        `SELECT id, hook_id, received_at, method, path, query, headers, body_size
         FROM events WHERE hook_id = ? ORDER BY id DESC LIMIT ?`
      )
      .all(hookId, limit) as Omit<EventRow, "body">[];
  }

  countEvents(hookId: string): number {
    return (
      this.db
        .prepare("SELECT COUNT(*) AS n FROM events WHERE hook_id = ?")
        .get(hookId) as { n: number }
    ).n;
  }

  pruneOldEvents(hours: number): number {
    const info = this.db
      .prepare(
        `DELETE FROM events WHERE received_at < datetime('now', ?)`
      )
      .run(`-${hours} hours`);
    return info.changes;
  }

  close(): void {
    this.db.close();
  }
}
