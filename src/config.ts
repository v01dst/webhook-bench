export interface Config {
  port: number;
  host: string;
  dbPath: string;
  maxBodyBytes: number;
  retentionHours: number;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}

export const DEFAULT_CONFIG: Config = {
  port: 3000,
  host: "0.0.0.0",
  dbPath: "./data/webhooks.db",
  maxBodyBytes: 256 * 1024,
  retentionHours: 24,
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: intEnv("PORT", DEFAULT_CONFIG.port),
    host: env.HOST ?? DEFAULT_CONFIG.host,
    dbPath: env.DB_PATH ?? DEFAULT_CONFIG.dbPath,
    maxBodyBytes: intEnv("MAX_BODY_BYTES", DEFAULT_CONFIG.maxBodyBytes),
    retentionHours: intEnv("RETENTION_HOURS", DEFAULT_CONFIG.retentionHours),
  };
}
