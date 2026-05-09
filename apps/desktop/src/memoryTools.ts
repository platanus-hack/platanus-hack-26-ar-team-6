import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import { createLogger, serializeError } from "./logger.js";
import type {
  ContextPacket,
  MemoryResult,
  MemoryUpdateOperation,
  MemoryUpdateResponse,
  RetrieverRequest,
} from "./types.js";

const memoryLogger = createLogger("relevo.memory-tools");

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

const activityTitleSchema = z.object({
  title: z.string().min(3).max(80),
});

function previewText(text: string, maxLength = 120): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function logMemoryTool(event: string, details: Record<string, unknown>): void {
  memoryLogger.info(event, details);
}

function clientSummary(options: MemoryClientOptions): Record<string, unknown> {
  return {
    serverUrl: options.serverUrl,
    userId: options.userId,
    projectId: options.projectId,
    hasAuthToken: Boolean(options.authToken),
  };
}

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
  summary: Record<string, unknown>,
): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = endpointUrl(options.serverUrl, path);
  const requestBody = JSON.stringify(body);
  const startedAt = performance.now();
  memoryLogger.info("http:request", {
    ...clientSummary(options),
    method: "POST",
    path,
    url,
    summary,
    requestBytes: requestBody.length,
    requestBodyPreview: previewText(requestBody, 600),
  });
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: headersFor(options),
      body: requestBody,
    });
  } catch (error) {
    memoryLogger.error("http:transport-error", {
      ...clientSummary(options),
      path,
      url,
      elapsedMs: Math.round(performance.now() - startedAt),
      error: serializeError(error),
    });
    throw error;
  }

  const headersReceivedAtMs = performance.now();
  const responseText = await response.text();
  const bodyReadAtMs = performance.now();
  const elapsedMs = Math.round(bodyReadAtMs - startedAt);
  const headersMs = Math.round(headersReceivedAtMs - startedAt);
  const bodyReadMs = Math.round(bodyReadAtMs - headersReceivedAtMs);
  if (!response.ok) {
    memoryLogger.error("http:failed", {
      ...clientSummary(options),
      path,
      url,
      status: response.status,
      statusText: response.statusText,
      elapsedMs,
      headersMs,
      bodyReadMs,
      responseBytes: responseText.length,
      responseBody: previewText(responseText, 1200),
    });
    throw new Error(`${errorLabel} failed: ${response.status} ${response.statusText}: ${responseText}`);
  }

  memoryLogger.info("http:success", {
    ...clientSummary(options),
    path,
    status: response.status,
    elapsedMs,
    headersMs,
    bodyReadMs,
    responseBytes: responseText.length,
    responseBodyPreview: previewText(responseText, 600),
  });
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
  const raw = await postJson<unknown>(options, "/agent-ctx", parsedInput, "agent_ctx", {
    agentId: parsedInput.agent_id,
    queryPreview: previewText(parsedInput.query),
    limit: parsedInput.limit,
    metadataKeys: Object.keys(parsedInput.metadata ?? {}),
  });
  const packet = normalizePacket(
    raw,
    { query: parsedInput.query, target_agent_id: parsedInput.agent_id },
    "agent",
  );
  logMemoryTool("agent_ctx:packet", {
    ...clientSummary(options),
    targetAgentId: packet.target_agent_id,
    resultCount: packet.results.length,
    insufficientContext: packet.insufficient_context,
    contextExchangeId: packet.context_exchange_id,
  });
  return packet;
}

export async function callGlobalContext(
  options: MemoryClientOptions,
  input: GlobalContextInput,
): Promise<ContextPacket> {
  const parsedInput = globalContextSchema.parse(input);
  const raw = await postJson<unknown>(options, "/global-ctx", parsedInput, "global_ctx", {
    queryPreview: previewText(parsedInput.query),
    limit: parsedInput.limit,
    metadataKeys: Object.keys(parsedInput.metadata ?? {}),
  });
  const packet = normalizePacket(raw, { query: parsedInput.query }, "global");
  logMemoryTool("global_ctx:packet", {
    ...clientSummary(options),
    resultCount: packet.results.length,
    insufficientContext: packet.insufficient_context,
    contextExchangeId: packet.context_exchange_id,
  });
  return packet;
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
    {
      chatSessionId: parsedInput.chat_session_id,
      checkpointIndex: parsedInput.checkpoint_index,
      operationCount: parsedInput.operations.length,
      operations: parsedInput.operations.map((operation) => ({
        authorAgentId: operation.author_agent_id,
        importance: operation.importance,
        documentKey: operation.document_key,
        hasCanonicalContent: Boolean(operation.canonical_content),
        contextExchangeId: operation.context_exchange_id,
        metadataKeys: Object.keys(operation.metadata ?? {}),
      })),
    },
  );
  const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const response = {
    event_ids: Array.isArray(data.event_ids)
      ? data.event_ids.filter((item): item is string => typeof item === "string")
      : [],
    document_ids: Array.isArray(data.document_ids)
      ? data.document_ids.filter((item): item is string => typeof item === "string")
      : [],
  };
  logMemoryTool("commit_memory_update:response", {
    ...clientSummary(options),
    eventIds: response.event_ids,
    documentIds: response.document_ids,
  });
  return response;
}

export function createUserRetrieverMcpServer(
  askRetriever: (input: RetrieverRequest) => Promise<ContextPacket>,
  onActivityTitle?: (title: string) => void,
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
          const request = retrieverRequestSchema.parse(args);
          logMemoryTool("ask_retriever:called", {
            scope: request.target_agent_id ? "agent" : "global",
            targetAgentId: request.target_agent_id,
            queryPreview: previewText(request.query),
            reason: request.reason,
          });
          const result = await askRetriever(request);
          logMemoryTool("ask_retriever:result", {
            scope: result.scope,
            targetAgentId: result.target_agent_id,
            resultCount: result.results.length,
            insufficientContext: result.insufficient_context,
            contextExchangeId: result.context_exchange_id,
          });
          return {
            content: [{ type: "text", text: JSON.stringify(result) }],
          };
        },
        { alwaysLoad: true },
      ),
      tool(
        "set_activity_title",
        "Set the private graph node title for this user turn. The title must be a self-contained 3-6 word noun phrase, not a sentence.",
        {
          title: z.string().min(3).max(80),
        },
        async (args) => {
          const parsedArgs = activityTitleSchema.parse(args);
          const title = parsedArgs.title.trim();
          logMemoryTool("set_activity_title:called", {
            titlePreview: previewText(title, 80),
          });
          onActivityTitle?.(title);
          return {
            content: [{ type: "text", text: JSON.stringify({ ok: true, title }) }],
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
          const parsedArgs = agentContextSchema.parse(args);
          logMemoryTool("mcp.agent_ctx:called", {
            ...clientSummary(options),
            agentId: parsedArgs.agent_id,
            queryPreview: previewText(parsedArgs.query),
          });
          const packet = await callAgentContext(options, parsedArgs);
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
          const parsedArgs = globalContextSchema.parse(args);
          logMemoryTool("mcp.global_ctx:called", {
            ...clientSummary(options),
            queryPreview: previewText(parsedArgs.query),
          });
          const packet = await callGlobalContext(options, parsedArgs);
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
          const parsedArgs = commitMemoryUpdateSchema.parse(args);
          logMemoryTool("mcp.commit_memory_update:called", {
            ...clientSummary(options),
            chatSessionId: parsedArgs.chat_session_id,
            checkpointIndex: parsedArgs.checkpoint_index,
            operationCount: parsedArgs.operations.length,
          });
          const response = await commitMemoryUpdate(options, parsedArgs);
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
