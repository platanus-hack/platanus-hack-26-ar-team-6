/**
 * Team Pulse + Responsibilities client.
 *
 * The desktop owns the Anthropic key, so this module:
 *   1. fetches the cached pulse grid from the server to get the visible window,
 *   2. fetches raw events for that window,
 *   3. summarises them with Anthropic (or a cheap fallback when the key is
 *      missing or the bucket is small),
 *   4. regenerates the responsibility document (≤2000 words) for the calling
 *      user from the last `RESPONSIBILITY_WINDOW_DAYS` of events,
 *   5. POSTs everything back so other clients can read fresh data.
 *
 * This should only run from an explicit refresh action. Loading the views reads
 * cached server state and does not regenerate timeline or responsibility docs.
 */
import Anthropic from "@anthropic-ai/sdk";

const RESPONSIBILITY_WINDOW_DAYS = 30;
const RESPONSIBILITY_MAX_WORDS = 2000;
const PULSE_SUMMARY_MAX_CHARS = 280;
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

export type TeamPulseRawEventsQuery = {
  agentId?: string;
  since?: string;
  until?: string;
  bucketSize?: number;
  bucketCount?: number;
};

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

function promptEventText(event: TeamPulseRawEvent, max = 180): string {
  const userMatch = event.content.match(/USER:\s*([\s\S]*?)(?:\n\nASSISTANT:|\n\nCode changes:|$)/);
  const prompt = userMatch?.[1]?.trim();
  return truncateSummary(prompt || event.content, max);
}

function isPromptEvent(event: TeamPulseRawEvent): boolean {
  const source = event.metadata?.source;
  return (
    source === "claude_code_hook" ||
    source === "langgraph-updater" ||
    /^Checkpoint\s+\d+:/i.test(event.content.trim())
  );
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
  previousSummary: string | null,
): Promise<string> {
  if (events.length === 0) {
    throw new Error("summarizeBucket called with no events");
  }
  const fallback = truncateSummary(
    [previousSummary, ...events.map((event) => promptEventText(event))].filter(Boolean).join(" · "),
  );
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
      max_tokens: 140,
      system: `You maintain an hourly work checkpoint. Combine the previous checkpoint, if present, with every prompt event in this hour. Output ONE concrete past-tense description of the job done, max ${PULSE_SUMMARY_MAX_CHARS} characters. Output only the description, no quotes, no preamble.`,
      messages: [
        {
          role: "user",
          content: [
            previousSummary ? `Previous checkpoint for this hour:\n${previousSummary}` : "",
            `Prompt events in this hour:\n${transcript}`,
            "",
            "New hourly checkpoint:",
          ]
            .filter(Boolean)
            .join("\n\n"),
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
  displayName: string,
  apiKey: string | null | undefined,
): Promise<{ content: string; wordCount: number } | null> {
  // Important: we deliberately DO NOT pass the previous responsibility doc
  // to the model. Smaller Haiku-class models tend to anchor on prior text
  // and ignore newer events. Building from raw events each time keeps the
  // doc honest about what the engineer is actually working on right now.
  if (events.length === 0) {
    // No raw events means we have nothing new to assert. Skip the upsert
    // entirely. Any existing stale doc on the server is left in place so
    // the demo still has something to show; it will be replaced as soon
    // as new events land.
    return null;
  }
  if (!apiKey) {
    // Cheap fallback: synthesise a bullet list straight from events.
    const recent = events.slice(-12);
    const bullets = recent.map((event) => `- ${truncateSummary(event.content, 160)}`).join("\n");
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
    // Newest-first transcript. Mid-tier models pay more attention to the
    // top of the context window; biasing towards recent events fights the
    // "stale anchor" failure mode where the model keeps describing the
    // engineer's old area of ownership instead of what they did today.
    const ordered = [...events].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
    const transcript = ordered
      .map(
        (event, idx) =>
          `[${idx + 1}] ${new Date(event.created_at).toISOString()} :: ${event.content.replace(/\s+/g, " ").trim()}`,
      )
      .join("\n");
    const newestIso = ordered[0]?.created_at ?? "(unknown)";
    const oldestIso = ordered[ordered.length - 1]?.created_at ?? "(unknown)";
    const response = await client.messages.create({
      model: RESPONSIBILITY_MODEL,
      max_tokens: 3500,
      system: [
        "You write a markdown 'responsibility document' for a single engineer on a small team.",
        `The document MUST be at most ${RESPONSIBILITY_MAX_WORDS} words.`,
        "It must contain exactly two top-level sections, in this order:",
        "  ## General responsibility",
        "    - 1-3 short paragraphs describing the engineer's enduring area of ownership, INFERRED FROM THE EVENTS BELOW. Do not invent areas that aren't reflected in the events.",
        "  ## Recent implementations",
        "    - Bullet list of concrete recent work, most recent first. Each bullet ≤ 25 words.",
        "    - The MOST RECENT 5 events MUST appear as bullets if non-trivial. Older events are optional.",
        "Write in the third person using the engineer's display name.",
        "Be concrete: cite topics, files, modules, features, fixes, decisions when present in the events.",
        "If the most recent events show a clear topic shift (e.g. from feature A to feature B), reflect that shift in 'General responsibility' rather than describing only the older area.",
        "Never invent facts that are not supported by the events.",
        "Output only the markdown document. No preamble, no closing remarks.",
      ].join("\n"),
      messages: [
        {
          role: "user",
          content: [
            `Engineer: ${displayName}`,
            `Window: ${oldestIso} → ${newestIso}`,
            `Number of events: ${ordered.length}`,
            "",
            "Events (newest first; the top of this list is what the engineer is working on right now):",
            transcript,
            "",
            "Produce the responsibility document.",
          ].join("\n"),
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

export async function loadTeamPulse(opts: TeamPulseClientOptions): Promise<TeamPulseResponse> {
  const params = new URLSearchParams();
  if (opts.bucketSize) params.set("size", String(opts.bucketSize));
  if (opts.bucketCount) params.set("buckets", String(opts.bucketCount));
  const url = `${pulseUrl(opts, "team-pulse")}${params.toString() ? `?${params}` : ""}`;
  return fetchJson<TeamPulseResponse>(url, {
    headers: { Authorization: `Bearer ${opts.sessionToken}` },
  });
}

export async function loadResponsibilities(
  opts: Pick<TeamPulseClientOptions, "serverBaseUrl" | "sessionToken" | "projectId">,
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

export async function loadTeamPulseRawEvents(
  opts: TeamPulseClientOptions,
  query: TeamPulseRawEventsQuery = {},
): Promise<TeamPulseRawEvent[]> {
  const params: Record<string, string> = {};
  const bucketSize = query.bucketSize ?? opts.bucketSize;
  const bucketCount = query.bucketCount ?? opts.bucketCount;
  if (bucketSize) params.size = String(bucketSize);
  if (bucketCount) params.buckets = String(bucketCount);
  if (query.agentId) params.agent_id = query.agentId;
  if (query.since) params.since = query.since;
  if (query.until) params.until = query.until;
  return loadRawEvents(opts, params);
}

export async function refreshTeamPulse(
  opts: TeamPulseClientOptions,
): Promise<TeamPulseRefreshResult> {
  const bucketSize = opts.bucketSize ?? 3600;
  const bucketCount = opts.bucketCount ?? 24;

  // 1. Manual refresh scans from each member's last completed checkpoint to
  // the current open bucket. If the latest checkpoint is already in the open
  // bucket, we rebuild that bucket using the previous checkpoint plus all
  // prompt events from the bucket.
  const grid = await loadTeamPulse(opts);
  const nowMs = Date.now();
  const currentBucketIndex = Math.max(0, grid.bucket_starts.length - 1);

  type BucketTask = {
    agentId: string;
    bucketStart: string;
    previousSummary: string | null;
  };
  const bucketTasks: BucketTask[] = [];
  for (const member of grid.members.filter((m) => m.agent_id === opts.selfAgentId)) {
    let lastScannedIndex: number | null = null;
    member.cells.forEach((cell, index) => {
      if (cell?.summary) lastScannedIndex = index;
    });
    const startIndex =
      lastScannedIndex == null
        ? 0
        : lastScannedIndex >= currentBucketIndex
          ? currentBucketIndex
          : lastScannedIndex + 1;
    for (let index = startIndex; index <= currentBucketIndex; index += 1) {
      const startIso = grid.bucket_starts[index];
      if (!startIso) continue;
      bucketTasks.push({
        agentId: member.agent_id,
        bucketStart: isoBucketStart(startIso),
        previousSummary: member.cells[index]?.summary ?? null,
      });
    }
  }

  // 2. Fetch raw prompt events for the timeline scan. Responsibility generation
  // gets its own self-only history window when the timeline scan doesn't cover it.
  const timelineWindowStartMs = bucketTasks[0]
    ? Math.min(...bucketTasks.map((task) => new Date(task.bucketStart).getTime()))
    : grid.bucket_starts[0]
      ? new Date(grid.bucket_starts[0]).getTime()
      : nowMs - bucketSize * bucketCount * 1000;
  const responsibilityWindowStart = new Date(
    nowMs - RESPONSIBILITY_WINDOW_DAYS * 24 * 3600 * 1000,
  );
  const rawEvents = (
    await loadRawEvents(opts, {
      since: new Date(timelineWindowStartMs).toISOString(),
    })
  ).filter(isPromptEvent);
  const responsibilityWindowEvents =
    timelineWindowStartMs <= responsibilityWindowStart.getTime()
      ? rawEvents.filter((event) => {
          return (
            event.agent_id === opts.selfAgentId &&
            new Date(event.created_at).getTime() >= responsibilityWindowStart.getTime()
          );
        })
      : (
          await loadRawEvents(opts, {
            agent_id: opts.selfAgentId,
            since: responsibilityWindowStart.toISOString(),
          })
        ).filter(isPromptEvent);

  const eventsByAgentBucket = new Map<string, TeamPulseRawEvent[]>();
  for (const event of rawEvents) {
    const key = `${event.agent_id}:${isoBucketStart(event.bucket_start)}`;
    const existing = eventsByAgentBucket.get(key);
    if (existing) {
      existing.push(event);
    } else {
      eventsByAgentBucket.set(key, [event]);
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
    const events = eventsByAgentBucket.get(`${task.agentId}:${task.bucketStart}`) ?? [];
    if (events.length === 0) continue;
    const summary = await summarizeBucket(
      events,
      opts.anthropicApiKey ?? null,
      task.previousSummary,
    );
    summaries.push({
      agent_id: task.agentId,
      bucket_start: task.bucketStart,
      summary,
      event_count: events.length,
      event_ids: events.map((e) => e.id),
    });
  }

  // 4. Build responsibility document.
  const self = grid.members.find((m) => m.agent_id === opts.selfAgentId);
  const displayName = self?.display_name ?? "the engineer";
  const responsibilityDoc = await generateResponsibilityDoc(
    responsibilityWindowEvents,
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
    };
  }

  return fetchJson<TeamPulseRefreshResult>(pulseUrl(opts, "team-pulse/refresh"), {
    method: "POST",
    headers: authHeaders(opts),
    body: JSON.stringify(refreshBody),
  });
}
