/**
 * Team Pulse + Responsibilities client.
 *
 * The desktop owns the Anthropic key, so this module:
 *   1. fetches the cached pulse grid from the server,
 *   2. fetches raw events for buckets that need a summary,
 *   3. summarises them with Anthropic (or a cheap fallback when the key is
 *      missing or the bucket is small),
 *   4. regenerates the responsibility document (≤2000 words) for the calling
 *      user from the last `RESPONSIBILITY_WINDOW_DAYS` of events,
 *   5. POSTs everything back so other clients can read fresh data.
 */
import Anthropic from "@anthropic-ai/sdk";

const RESPONSIBILITY_WINDOW_DAYS = 30;
const RESPONSIBILITY_MAX_WORDS = 2000;
const PULSE_SUMMARY_MAX_CHARS = 80;
// Cheap fast model. `claude-3-5-haiku-20241022` reached end-of-life and now
// returns 404 from /v1/messages. Use `claude-haiku-4-5` (the current Haiku
// alias) until we plumb a model name through settings.
const SUMMARY_MODEL = "claude-haiku-4-5";
const RESPONSIBILITY_MODEL = "claude-haiku-4-5";

export type TeamPulseCell = {
  summary: string | null;
  event_count: number;
  updated_at?: string | null;
};

export type TeamPulseMember = {
  agent_id: string;
  display_name: string;
  cells: TeamPulseCell[];
};

export type TeamPulseResponse = {
  bucket_size_seconds: number;
  bucket_starts: string[];
  members: TeamPulseMember[];
};

export type TeamPulseRawEvent = {
  id: string;
  agent_id: string;
  bucket_start: string;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

type RawEventsResponse = { events: TeamPulseRawEvent[] };

export type ResponsibilityMember = {
  agent_id: string;
  display_name: string;
  content: string | null;
  updated_at: string | null;
  word_count: number | null;
};

export type ResponsibilitiesResponse = { members: ResponsibilityMember[] };

export type TeamPulseRefreshResult = {
  pulse_doc_ids: string[];
  responsibility_doc_ids: string[];
  skipped_responsibility_agent_ids: string[];
};

export type TeamPulseClientOptions = {
  serverBaseUrl: string;
  sessionToken: string;
  projectId: string;
  selfAgentId: string;
  anthropicApiKey?: string | null;
  /** seconds; default 3600 */
  bucketSize?: number;
  /** count; default 24 */
  bucketCount?: number;
};

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }
  return response.json() as Promise<T>;
}

function authHeaders(opts: TeamPulseClientOptions): HeadersInit {
  return {
    Authorization: `Bearer ${opts.sessionToken}`,
    "Content-Type": "application/json",
  };
}

function pulseUrl(opts: TeamPulseClientOptions, path: string): string {
  return `${normalizeBaseUrl(opts.serverBaseUrl)}/projects/${opts.projectId}/${path}`;
}

function truncateSummary(text: string, max = PULSE_SUMMARY_MAX_CHARS): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  const cut = collapsed.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  const safe = lastSpace >= max * 0.55 ? cut.slice(0, lastSpace) : cut;
  return `${safe.replace(/[\s.,;:-]+$/, "")}...`;
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function clampWords(text: string, max = RESPONSIBILITY_MAX_WORDS): string {
  const words = text.split(/\s+/);
  if (words.length <= max) return text;
  return `${words.slice(0, max).join(" ")}\n\n_(truncated to ${max} words)_`;
}

function isoBucketStart(value: string): string {
  // Server bucket timestamps are tz-aware; normalise to "...Z" for stable
  // comparison + payload symmetry.
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const iso = date.toISOString();
  return iso.replace(/\.\d{3}Z$/, "Z");
}

// ---------------------------------------------------------------------------
// LLM helpers
// ---------------------------------------------------------------------------

let cachedClient: Anthropic | null = null;
let cachedKey: string | null = null;

function getAnthropic(apiKey: string): Anthropic {
  if (!cachedClient || cachedKey !== apiKey) {
    cachedClient = new Anthropic({ apiKey });
    cachedKey = apiKey;
  }
  return cachedClient;
}

function extractText(message: Anthropic.Message): string {
  return message.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();
}

async function summarizeBucket(
  events: TeamPulseRawEvent[],
  apiKey: string | null | undefined,
): Promise<string> {
  if (events.length === 0) {
    throw new Error("summarizeBucket called with no events");
  }
  const latest = events[events.length - 1]!;
  const fallback = truncateSummary(latest.content);
  if (events.length <= 2 || !apiKey) {
    return fallback;
  }
  try {
    const client = getAnthropic(apiKey);
    const transcript = events
      .map((event, idx) => `${idx + 1}. ${event.content.replace(/\s+/g, " ").trim()}`)
      .join("\n");
    const response = await client.messages.create({
      model: SUMMARY_MODEL,
      max_tokens: 80,
      system:
        "You compress a list of work events into ONE short past-tense sentence (max 80 characters) describing what the user worked on. Output only the sentence, no quotes, no preamble.",
      messages: [
        {
          role: "user",
          content: `Events in this hour:\n${transcript}\n\nOne-sentence summary:`,
        },
      ],
    });
    const text = extractText(response).replace(/^["']+|["']+$/g, "");
    if (!text) return fallback;
    return truncateSummary(text);
  } catch (error) {
    console.error("[team-pulse] summarizeBucket failed; using fallback", error);
    return fallback;
  }
}

async function generateResponsibilityDoc(
  events: TeamPulseRawEvent[],
  previousContent: string | null,
  displayName: string,
  apiKey: string | null | undefined,
): Promise<{ content: string; wordCount: number } | null> {
  if (events.length === 0 && !previousContent) {
    return null;
  }
  if (!apiKey) {
    // Cheap fallback: synthesise a simple bullet list. Better than nothing.
    const recent = events.slice(-12);
    const bullets = recent
      .map((event) => `- ${truncateSummary(event.content, 160)}`)
      .join("\n");
    const content = [
      `## General responsibility`,
      `(no model available; synthesised from recent events)`,
      ``,
      `## Recent implementations`,
      bullets || "_(no recent events)_",
    ].join("\n");
    return { content, wordCount: countWords(content) };
  }
  try {
    const client = getAnthropic(apiKey);
    const transcript = events
      .map(
        (event, idx) =>
          `[${idx + 1}] ${new Date(event.created_at).toISOString()} :: ${event.content
            .replace(/\s+/g, " ")
            .trim()}`,
      )
      .join("\n");
    const previousBlock = previousContent
      ? `Previous responsibility document (use only as a hint; rewrite from scratch using the events as ground truth):\n${previousContent}\n\n`
      : "";
    const response = await client.messages.create({
      model: RESPONSIBILITY_MODEL,
      max_tokens: 3500,
      system: [
        "You write a markdown 'responsibility document' for a single engineer on a small team.",
        `The document MUST be at most ${RESPONSIBILITY_MAX_WORDS} words.`,
        "It must contain exactly two top-level sections, in this order:",
        "  ## General responsibility",
        "    - 1-3 short paragraphs describing the engineer's enduring area of ownership.",
        "  ## Recent implementations",
        "    - bullet list of concrete recent work; most recent first; each bullet ≤ 25 words.",
        "Write in the third person using the engineer's display name.",
        "Be concrete: cite files, modules, features, fixes, decisions when present in the events.",
        "Never invent facts that are not supported by the events.",
        "Output only the markdown document. No preamble, no closing remarks.",
      ].join("\n"),
      messages: [
        {
          role: "user",
          content: `Engineer: ${displayName}\n\n${previousBlock}Recent events (oldest first):\n${transcript || "_(no events)_"}\n\nProduce the responsibility document.`,
        },
      ],
    });
    let content = extractText(response).trim();
    if (!content) return null;
    content = clampWords(content);
    return { content, wordCount: countWords(content) };
  } catch (error) {
    console.error("[team-pulse] generateResponsibilityDoc failed", error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Server interactions
// ---------------------------------------------------------------------------

export async function loadTeamPulse(
  opts: TeamPulseClientOptions,
): Promise<TeamPulseResponse> {
  const params = new URLSearchParams();
  if (opts.bucketSize) params.set("size", String(opts.bucketSize));
  if (opts.bucketCount) params.set("buckets", String(opts.bucketCount));
  const url = `${pulseUrl(opts, "team-pulse")}${params.toString() ? `?${params}` : ""}`;
  return fetchJson<TeamPulseResponse>(url, {
    headers: { Authorization: `Bearer ${opts.sessionToken}` },
  });
}

export async function loadResponsibilities(
  opts: Pick<
    TeamPulseClientOptions,
    "serverBaseUrl" | "sessionToken" | "projectId"
  >,
): Promise<ResponsibilitiesResponse> {
  const url = `${normalizeBaseUrl(opts.serverBaseUrl)}/projects/${opts.projectId}/responsibilities`;
  return fetchJson<ResponsibilitiesResponse>(url, {
    headers: { Authorization: `Bearer ${opts.sessionToken}` },
  });
}

async function loadRawEvents(
  opts: TeamPulseClientOptions,
  params: Record<string, string>,
): Promise<TeamPulseRawEvent[]> {
  const search = new URLSearchParams(params);
  const url = `${pulseUrl(opts, "team-pulse/raw-events")}?${search.toString()}`;
  const response = await fetchJson<RawEventsResponse>(url, {
    headers: { Authorization: `Bearer ${opts.sessionToken}` },
  });
  return response.events;
}

export async function refreshTeamPulse(
  opts: TeamPulseClientOptions,
): Promise<TeamPulseRefreshResult> {
  const bucketSize = opts.bucketSize ?? 3600;
  const bucketCount = opts.bucketCount ?? 24;

  // 1. Find which of the caller's own buckets are missing or for the
  // current open hour (always recompute).
  const grid = await loadTeamPulse(opts);
  const self = grid.members.find((m) => m.agent_id === opts.selfAgentId);
  const nowMs = Date.now();
  const openBucketStart = Math.floor(nowMs / 1000 / bucketSize) * bucketSize * 1000;

  type BucketTask = { bucketStart: string };
  const bucketTasks: BucketTask[] = [];
  if (self) {
    grid.bucket_starts.forEach((startIso, index) => {
      const cell = self.cells[index];
      const startMs = new Date(startIso).getTime();
      const isOpen = startMs >= openBucketStart;
      if (!cell) return;
      if (cell.summary == null || isOpen) {
        bucketTasks.push({ bucketStart: isoBucketStart(startIso) });
      }
    });
  } else {
    // Roster doesn't know about us yet. Refresh all buckets in window.
    grid.bucket_starts.forEach((startIso) => {
      bucketTasks.push({ bucketStart: isoBucketStart(startIso) });
    });
  }

  // 2. Fetch raw events for the whole window in one call (cheap).
  const windowStartMs = grid.bucket_starts[0]
    ? new Date(grid.bucket_starts[0]).getTime()
    : nowMs - bucketSize * bucketCount * 1000;
  const responsibilityWindowStart = new Date(
    nowMs - RESPONSIBILITY_WINDOW_DAYS * 24 * 3600 * 1000,
  ).toISOString();
  const responsibilityWindowEvents = await loadRawEvents(opts, {
    agent_id: opts.selfAgentId,
    since: responsibilityWindowStart,
  });

  // Sub-list scoped to the visible pulse window.
  const pulseWindowEvents = responsibilityWindowEvents.filter(
    (event) => new Date(event.created_at).getTime() >= windowStartMs,
  );

  const eventsByBucket = new Map<string, TeamPulseRawEvent[]>();
  for (const event of pulseWindowEvents) {
    const key = isoBucketStart(event.bucket_start);
    const existing = eventsByBucket.get(key);
    if (existing) {
      existing.push(event);
    } else {
      eventsByBucket.set(key, [event]);
    }
  }

  // 3. Build summaries for buckets that have events.
  const summaries: Array<{
    agent_id: string;
    bucket_start: string;
    summary: string;
    event_count: number;
    event_ids: string[];
  }> = [];
  for (const task of bucketTasks) {
    const events = eventsByBucket.get(task.bucketStart) ?? [];
    if (events.length === 0) continue;
    const summary = await summarizeBucket(events, opts.anthropicApiKey ?? null);
    summaries.push({
      agent_id: opts.selfAgentId,
      bucket_start: task.bucketStart,
      summary,
      event_count: events.length,
      event_ids: events.map((e) => e.id),
    });
  }

  // 4. Build responsibility document.
  const previous = await loadResponsibilities({
    serverBaseUrl: opts.serverBaseUrl,
    sessionToken: opts.sessionToken,
    projectId: opts.projectId,
  });
  const selfPrevious = previous.members.find((m) => m.agent_id === opts.selfAgentId);
  const displayName = selfPrevious?.display_name ?? "the engineer";
  const responsibilityDoc = await generateResponsibilityDoc(
    responsibilityWindowEvents,
    selfPrevious?.content ?? null,
    displayName,
    opts.anthropicApiKey ?? null,
  );

  const refreshBody = {
    size: bucketSize,
    buckets: bucketCount,
    summaries,
    responsibilities: responsibilityDoc
      ? [
          {
            agent_id: opts.selfAgentId,
            content: responsibilityDoc.content,
            word_count: responsibilityDoc.wordCount,
          },
        ]
      : [],
  };

  if (refreshBody.summaries.length === 0 && refreshBody.responsibilities.length === 0) {
    return {
      pulse_doc_ids: [],
      responsibility_doc_ids: [],
      skipped_responsibility_agent_ids: [],
    };
  }

  return fetchJson<TeamPulseRefreshResult>(pulseUrl(opts, "team-pulse/refresh"), {
    method: "POST",
    headers: authHeaders(opts),
    body: JSON.stringify(refreshBody),
  });
}
