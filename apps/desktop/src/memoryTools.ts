import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import type {
  ContextPacket,
  MemoryResult,
  MemoryUpdateOperation,
  MemoryUpdateResponse,
  RetrieverRequest,
} from "./types.js";

export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export type MemoryClientOptions = {
  serverUrl: string;
  userId: string;
  authToken?: string;
  projectId?: string;
  fetchImpl?: FetchLike;
};

export type AgentContextInput = {
  agent_id: string;
  query: string;
  limit?: number;
  metadata?: Record<string, unknown>;
};

export type GlobalContextInput = {
  query: string;
  limit?: number;
  metadata?: Record<string, unknown>;
};

export type CommitMemoryUpdateInput = {
  chat_session_id: string;
  checkpoint_index: number;
  operations: MemoryUpdateOperation[];
};

export const retrieverRequestSchema = z.object({
  query: z.string().min(1),
  target_agent_id: z.string().min(1).optional(),
  reason: z.string().optional(),
});

const agentContextSchema = z.object({
  agent_id: z.string().min(1),
  query: z.string().min(1),
  limit: z.number().int().min(1).max(20).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const globalContextSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(20).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const memoryUpdateOperationSchema = z.object({
  author_agent_id: z.string().min(1),
  importance: z.enum(["local", "global"]),
  document_key: z.string().min(1),
  event_content: z.string(),
  canonical_content: z.string().optional(),
  context_exchange_id: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const commitMemoryUpdateSchema = z.object({
  chat_session_id: z.string().min(1),
  checkpoint_index: z.number().int().min(1),
  operations: z.array(memoryUpdateOperationSchema).min(1),
});

function endpointUrl(serverUrl: string, path: string): string {
  return new URL(path, serverUrl).toString();
}

function headersFor(options: MemoryClientOptions): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-relevo-user-id": options.userId,
  };

  if (options.authToken) {
    headers.authorization = `Bearer ${options.authToken}`;
  }
  if (options.projectId) {
    headers["x-project-id"] = options.projectId;
  }

  return headers;
}

async function postJson<T>(
  options: MemoryClientOptions,
  path: string,
  body: unknown,
  errorLabel: string,
): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(endpointUrl(options.serverUrl, path), {
    method: "POST",
    headers: headersFor(options),
    body: JSON.stringify(body),
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`${errorLabel} failed: ${response.status} ${response.statusText}: ${responseText}`);
  }

  return (responseText ? JSON.parse(responseText) : {}) as T;
}

function normalizeResults(rawResults: unknown): MemoryResult[] {
  if (!Array.isArray(rawResults)) {
    return [];
  }

  return rawResults
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .filter((item) => typeof item.id === "string" && typeof item.content === "string")
    .map((item) => ({
      id: String(item.id),
      kind: typeof item.kind === "string" ? item.kind : "memory",
      content: String(item.content),
      metadata:
        item.metadata && typeof item.metadata === "object"
          ? (item.metadata as Record<string, unknown>)
          : {},
      created_at: item.created_at,
    }));
}

function summarizeResults(results: MemoryResult[]): string {
  if (results.length === 0) {
    return "No stored context matched the query.";
  }

  return results
    .slice(0, 4)
    .map((result, index) => `${index + 1}. ${result.content.replace(/\s+/g, " ").trim()}`)
    .join("\n");
}

function normalizePacket(
  raw: unknown,
  request: RetrieverRequest,
  scope: "agent" | "global",
): ContextPacket {
  const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const results = normalizeResults(data.results);
  const contextExchangeId =
    typeof data.context_exchange_id === "string" ? data.context_exchange_id : undefined;

  return {
    query: request.query,
    scope,
    target_agent_id: scope === "agent" ? request.target_agent_id : undefined,
    context_exchange_id: contextExchangeId,
    results,
    insufficient_context:
      typeof data.insufficient_context === "boolean"
        ? data.insufficient_context
        : results.length === 0,
    summary: summarizeResults(results),
  };
}

export async function callAgentContext(
  options: MemoryClientOptions,
  input: AgentContextInput,
): Promise<ContextPacket> {
  const parsedInput = agentContextSchema.parse(input);
  const raw = await postJson<unknown>(options, "/agent-ctx", parsedInput, "agent_ctx");
  return normalizePacket(
    raw,
    { query: parsedInput.query, target_agent_id: parsedInput.agent_id },
    "agent",
  );
}

export async function callGlobalContext(
  options: MemoryClientOptions,
  input: GlobalContextInput,
): Promise<ContextPacket> {
  const parsedInput = globalContextSchema.parse(input);
  const raw = await postJson<unknown>(options, "/global-ctx", parsedInput, "global_ctx");
  return normalizePacket(raw, { query: parsedInput.query }, "global");
}

export async function commitMemoryUpdate(
  options: MemoryClientOptions,
  input: CommitMemoryUpdateInput,
): Promise<MemoryUpdateResponse> {
  const parsedInput = commitMemoryUpdateSchema.parse(input);
  const raw = await postJson<unknown>(
    options,
    "/memory-updates",
    parsedInput,
    "commit_memory_update",
  );
  const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    event_ids: Array.isArray(data.event_ids)
      ? data.event_ids.filter((item): item is string => typeof item === "string")
      : [],
    document_ids: Array.isArray(data.document_ids)
      ? data.document_ids.filter((item): item is string => typeof item === "string")
      : [],
  };
}

export function createUserRetrieverMcpServer(
  askRetriever: (input: RetrieverRequest) => Promise<ContextPacket>,
): ReturnType<typeof createSdkMcpServer> {
  return createSdkMcpServer({
    name: "relevo-user-retriever",
    version: "0.1.0",
    alwaysLoad: true,
    tools: [
      tool(
        "ask_retriever",
        "Ask the retriever agent for missing local, teammate, or global project context.",
        {
          query: z.string().min(1),
          target_agent_id: z.string().min(1).optional(),
          reason: z.string().optional(),
        },
        async (args) => {
          const result = await askRetriever(retrieverRequestSchema.parse(args));
          return {
            content: [{ type: "text", text: JSON.stringify(result) }],
          };
        },
        { alwaysLoad: true },
      ),
    ],
  });
}

export function createRetrieverMcpServer(
  options: MemoryClientOptions,
  onPacket?: (packet: ContextPacket) => void,
): ReturnType<typeof createSdkMcpServer> {
  return createSdkMcpServer({
    name: "relevo-memory",
    version: "0.1.0",
    alwaysLoad: true,
    tools: [
      tool(
        "agent_ctx",
        "Retrieve author-owned memory for one agent.",
        {
          agent_id: z.string().min(1),
          query: z.string().min(1),
          limit: z.number().int().min(1).max(20).optional(),
          metadata: z.record(z.string(), z.unknown()).optional(),
        },
        async (args) => {
          const packet = await callAgentContext(options, agentContextSchema.parse(args));
          onPacket?.(packet);
          return {
            content: [{ type: "text", text: JSON.stringify(packet) }],
          };
        },
        { alwaysLoad: true },
      ),
      tool(
        "global_ctx",
        "Retrieve project-global memory marked useful to everyone.",
        {
          query: z.string().min(1),
          limit: z.number().int().min(1).max(20).optional(),
          metadata: z.record(z.string(), z.unknown()).optional(),
        },
        async (args) => {
          const packet = await callGlobalContext(options, globalContextSchema.parse(args));
          onPacket?.(packet);
          return {
            content: [{ type: "text", text: JSON.stringify(packet) }],
          };
        },
        { alwaysLoad: true },
      ),
    ],
  });
}

export function createUpdaterMcpServer(
  options: MemoryClientOptions,
  onCommit?: (response: MemoryUpdateResponse) => void,
): ReturnType<typeof createSdkMcpServer> {
  return createSdkMcpServer({
    name: "relevo-updater",
    version: "0.1.0",
    alwaysLoad: true,
    tools: [
      tool(
        "commit_memory_update",
        "Commit append-plus-canonical memory updates for the chat checkpoint.",
        {
          chat_session_id: z.string().min(1),
          checkpoint_index: z.number().int().min(1),
          operations: z.array(memoryUpdateOperationSchema).min(1),
        },
        async (args) => {
          const response = await commitMemoryUpdate(options, commitMemoryUpdateSchema.parse(args));
          onCommit?.(response);
          return {
            content: [{ type: "text", text: JSON.stringify(response) }],
          };
        },
        { alwaysLoad: true },
      ),
    ],
  });
}
