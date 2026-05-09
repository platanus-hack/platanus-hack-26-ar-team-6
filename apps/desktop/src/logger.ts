import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const ENV_LEVEL = (process.env.RELEVO_LOG_LEVEL ?? "info").toLowerCase();
const MIN_LEVEL: number = LEVELS[ENV_LEVEL as LogLevel] ?? LEVELS.info;
const VERBOSE = process.env.RELEVO_LOG_VERBOSE === "1";
const FILE_DISABLED = process.env.RELEVO_LOG_DISABLE_FILE === "1";

const STRING_LIMIT = VERBOSE ? 8000 : 800;
const ARRAY_LIMIT = VERBOSE ? 200 : 50;

const SENSITIVE_KEYS = new Set(
  [
    "authToken",
    "auth_token",
    "authorization",
    "anthropicApiKey",
    "anthropic_api_key",
    "ANTHROPIC_API_KEY",
    "session_token",
    "sessionToken",
    "access_token",
    "accessToken",
    "refresh_token",
    "refreshToken",
    "code",
    "client_secret",
    "clientSecret",
  ].map((key) => key.toLowerCase()),
);

const LOG_DIR = process.env.RELEVO_LOG_DIR ?? join(homedir(), ".relevo", "logs");

let cachedLogFilePath: string | null | undefined;

function ensureLogFile(): string | null {
  if (FILE_DISABLED) {
    return null;
  }
  if (cachedLogFilePath !== undefined) {
    return cachedLogFilePath;
  }
  try {
    if (!existsSync(LOG_DIR)) {
      mkdirSync(LOG_DIR, { recursive: true });
    }
    const today = new Date().toISOString().slice(0, 10);
    cachedLogFilePath = join(LOG_DIR, `relevo-${today}.log`);
    return cachedLogFilePath;
  } catch (error) {
    console.warn("[relevo.logger] failed to create log dir", error);
    cachedLogFilePath = null;
    return null;
  }
}

export function previewText(text: string, maxLength = 200): string {
  const normalized = String(text).replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const out: Record<string, unknown> = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
    const cause = (error as { cause?: unknown }).cause;
    if (cause !== undefined) {
      out.cause = serializeError(cause);
    }
    return out;
  }
  return { value: redact(error) };
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth-cut]";
  if (value === null || value === undefined) return value;
  const type = typeof value;
  if (type === "string") {
    const text = value as string;
    if (text.length > STRING_LIMIT) {
      return `${text.slice(0, STRING_LIMIT)}…[+${text.length - STRING_LIMIT} chars]`;
    }
    return text;
  }
  if (type === "number" || type === "boolean" || type === "bigint") return value;
  if (type !== "object") return String(value);
  if (value instanceof Error) return serializeError(value);
  if (Array.isArray(value)) {
    const trimmed = value.slice(0, ARRAY_LIMIT).map((item) => redact(item, depth + 1));
    if (value.length > ARRAY_LIMIT) {
      trimmed.push(`[+${value.length - ARRAY_LIMIT} more items]`);
    }
    return trimmed;
  }

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      if (typeof child === "string" && child.length > 0) {
        out[key] = `[redacted ${child.length} chars]`;
      } else if (child === null || child === undefined) {
        out[key] = child;
      } else {
        out[key] = "[redacted]";
      }
      continue;
    }
    out[key] = redact(child, depth + 1);
  }
  return out;
}

function emit(
  level: LogLevel,
  scope: string,
  event: string,
  details: Record<string, unknown>,
): void {
  if (LEVELS[level] < MIN_LEVEL) return;
  const safeDetails = redact(details) as Record<string, unknown>;
  const ts = new Date().toISOString();
  const record = { ts, level, scope, event, ...safeDetails };

  const consoleFn =
    level === "error" ? console.error : level === "warn" ? console.warn : console.info;
  consoleFn(`[${scope}]`, event, safeDetails);

  const file = ensureLogFile();
  if (file) {
    try {
      appendFileSync(file, JSON.stringify(record) + "\n", "utf-8");
    } catch (error) {
      console.warn("[relevo.logger] failed to append log", error);
    }
  }
}

export type Logger = {
  debug(event: string, details?: Record<string, unknown>): void;
  info(event: string, details?: Record<string, unknown>): void;
  warn(event: string, details?: Record<string, unknown>): void;
  error(event: string, details?: Record<string, unknown>): void;
  scope: string;
};

export function createLogger(scope: string): Logger {
  return {
    scope,
    debug: (event, details = {}) => emit("debug", scope, event, details),
    info: (event, details = {}) => emit("info", scope, event, details),
    warn: (event, details = {}) => emit("warn", scope, event, details),
    error: (event, details = {}) => emit("error", scope, event, details),
  };
}

export function getLogFilePath(): string | null {
  return ensureLogFile();
}

export function isVerboseLogging(): boolean {
  return VERBOSE;
}
