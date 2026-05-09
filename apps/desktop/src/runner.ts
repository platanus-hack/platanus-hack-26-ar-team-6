import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";

import { runAgentNetwork, type UpdaterInput, type UserAgentInput } from "./agentGraph.js";
import {
  commitMemoryUpdate,
  createRetrieverMcpServer,
  createUpdaterMcpServer,
  createUserRetrieverMcpServer,
} from "./memoryTools.js";
import { buildLocalAssistantSystemPrompt } from "./prompt.js";
import type {
  ContextPacket,
  ConversationMessage,
  LocalAssistantEvent,
  MemoryUpdateOperation,
  MemoryUpdateResponse,
  RetrieverRequest,
  RunLocalAssistantOptions,
} from "./types.js";

export const USER_AGENT_ALLOWED_TOOLS = [
  "Task",
  "Bash",
  "BashOutput",
  "KillBash",
  "Glob",
  "Grep",
  "LS",
  "Read",
  "Edit",
  "MultiEdit",
  "Write",
  "NotebookEdit",
  "TodoRead",
  "TodoWrite",
  "mcp__relevo-user-retriever__ask_retriever",
] as const;

export const RETRIEVER_ALLOWED_TOOLS = [
  "mcp__relevo-memory__agent_ctx",
  "mcp__relevo-memory__global_ctx",
] as const;

export const UPDATER_ALLOWED_TOOLS = [
  "mcp__relevo-updater__commit_memory_update",
] as const;

async function resolveWorkingDirectory(cwd: string): Promise<string> {
  const resolved = resolve(cwd);
  const stats = await stat(resolved);
  if (!stats.isDirectory()) {
    throw new Error(`cwd must be a directory: ${resolved}`);
  }
  return resolved;
}

function buildSdkEnvironment(anthropicApiKey: string): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }

  delete env.ANTHROPIC_API_KEY;
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  env.ANTHROPIC_API_KEY = anthropicApiKey;
  return env;
}

function textFromAssistantMessage(message: SDKMessage): LocalAssistantEvent[] {
  if (message.type !== "assistant") {
    return [];
  }

  const events: LocalAssistantEvent[] = [];
  for (const block of message.message.content) {
    if (block.type === "text") {
      events.push({ type: "assistant_text", text: block.text });
      continue;
    }
    if (block.type === "tool_use") {
      events.push({
        type: "tool_call",
        toolName: block.name,
        toolUseId: block.id,
        input: block.input,
      });
    }
  }

  return events;
}

function stripAssistantTextEvents(events: LocalAssistantEvent[]): LocalAssistantEvent[] {
  return events.filter((event) => event.type !== "assistant_text");
}

function textFromPartialMessage(message: SDKMessage): LocalAssistantEvent[] {
  if (message.type !== "stream_event") {
    return [];
  }

  const event = message.event;
  if (
    event.type === "content_block_delta" &&
    event.delta.type === "text_delta" &&
    event.delta.text
  ) {
    return [{ type: "assistant_text", text: event.delta.text }];
  }

  return [];
}

function normalizeMemoryResults(rawResults: unknown): ContextPacket["results"] {
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

function parseContextPacket(value: unknown): ContextPacket | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const data = value as Record<string, unknown>;
  if (typeof data.query !== "string" || !Array.isArray(data.results)) {
    return null;
  }

  const scope = data.scope === "agent" ? "agent" : "global";
  const results = normalizeMemoryResults(data.results);
  return {
    query: data.query,
    scope,
    target_agent_id: typeof data.target_agent_id === "string" ? data.target_agent_id : undefined,
    context_exchange_id:
      typeof data.context_exchange_id === "string" ? data.context_exchange_id : undefined,
    results,
    insufficient_context:
      typeof data.insufficient_context === "boolean"
        ? data.insufficient_context
        : results.length === 0,
    summary: typeof data.summary === "string" ? data.summary : results.map((row) => row.content).join("\n"),
  };
}

function parseToolUseResult(toolUseResult: unknown): ContextPacket | { error: string } | null {
  if (!toolUseResult || typeof toolUseResult !== "object") {
    return null;
  }

  const data = toolUseResult as Record<string, unknown>;
  if (typeof data.error === "string") {
    return { error: data.error };
  }

  return parseContextPacket(data);
}

function toolResultFromUserMessage(message: SDKMessage): LocalAssistantEvent[] {
  if (message.type !== "user" || !message.parent_tool_use_id || !message.tool_use_result) {
    return [];
  }

  const parsedResult = parseToolUseResult(message.tool_use_result);
  if (!parsedResult) {
    return [];
  }

  if ("error" in parsedResult) {
    return [
      {
        type: "tool_result",
        toolUseId: message.parent_tool_use_id,
        errorMessage: parsedResult.error,
      },
    ];
  }

  return [
    {
      type: "tool_result",
      toolUseId: message.parent_tool_use_id,
      result: parsedResult,
    },
  ];
}

function normalizeSdkMessage(message: SDKMessage): LocalAssistantEvent[] {
  const partialEvents = textFromPartialMessage(message);
  if (partialEvents.length > 0) {
    return partialEvents;
  }

  const assistantEvents = textFromAssistantMessage(message);
  if (assistantEvents.length > 0) {
    return assistantEvents;
  }

  const toolResultEvents = toolResultFromUserMessage(message);
  if (toolResultEvents.length > 0) {
    return toolResultEvents;
  }

  if (message.type === "tool_progress") {
    return [
      {
        type: "tool_status",
        toolName: message.tool_name,
        toolUseId: message.tool_use_id,
        elapsedTimeSeconds: message.elapsed_time_seconds,
      },
    ];
  }

  if (message.type === "result" && message.subtype === "success") {
    return [
      {
        type: "result",
        result: message.result,
        sessionId: message.session_id,
      },
    ];
  }

  if (message.type === "result") {
    return [
      {
        type: "error",
        message: message.errors.join("\n"),
        sessionId: message.session_id,
      },
    ];
  }

  return [{ type: "raw", messageType: message.type, message }];
}

function packetFromText(text: string): ContextPacket | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }
  try {
    return parseContextPacket(JSON.parse(trimmed));
  } catch {
    return null;
  }
}

function formatPreflightContext(packet: ContextPacket | null): string {
  if (!packet) {
    return "No preflight context packet was available.";
  }

  return [
    "Preflight retriever context packet:",
    "```json",
    JSON.stringify(packet, null, 2),
    "```",
  ].join("\n");
}

function buildUserPrompt(prompt: string, packet: ContextPacket | null): string {
  return [formatPreflightContext(packet), "", "User message:", prompt].join("\n");
}

function buildRetrieverPrompt(userId: string, request: RetrieverRequest): string {
  const targetInstruction = request.target_agent_id
    ? `Call agent_ctx with agent_id="${request.target_agent_id}" and query="${request.query}".`
    : `Call global_ctx with query="${request.query}".`;

  return [
    "You are the Relevo retriever agent. You are not a router.",
    "Only use your server-backed context tools. Return one JSON ContextPacket and no prose.",
    `The asking agent id is ${userId}.`,
    request.reason ? `Reason: ${request.reason}` : "",
    targetInstruction,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildUpdaterPrompt(input: UpdaterInput, operations: MemoryUpdateOperation[]): string {
  return [
    "You are the Relevo updater agent.",
    "Call commit_memory_update exactly once with the suggested operations unless they are invalid.",
    "Do not call retrieval tools. Do not write prose before the tool call.",
    "",
    "Suggested commit payload:",
    "```json",
    JSON.stringify(
      {
        chat_session_id: input.chatSessionId,
        checkpoint_index: input.checkpointIndex,
        operations,
      },
      null,
      2,
    ),
    "```",
    "",
    "Finalized messages:",
    "```json",
    JSON.stringify(input.finalizedMessages, null, 2),
    "```",
  ].join("\n");
}

function compactText(text: string, maxLength = 1600): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function buildMemoryOperations(userId: string, input: UpdaterInput): MemoryUpdateOperation[] {
  const recentMessages = input.finalizedMessages.slice(-6);
  const recentTranscript = recentMessages
    .map((message) => `${message.role.toUpperCase()}: ${message.text}`)
    .join("\n\n");
  const operations: MemoryUpdateOperation[] = [
    {
      author_agent_id: userId,
      importance: "local",
      document_key: "chat-summary",
      event_content: compactText(`Checkpoint ${input.checkpointIndex}:\n${recentTranscript}`),
      canonical_content: compactText(`Recent working context:\n${recentTranscript}`),
      metadata: {
        source: "langgraph-updater",
      },
    },
  ];

  for (const packet of input.contextPackets) {
    if (packet.scope !== "agent" || !packet.target_agent_id || !packet.context_exchange_id) {
      continue;
    }
    operations.push({
      author_agent_id: packet.target_agent_id,
      importance: "local",
      document_key: `closure-${userId}`,
      event_content: compactText(
        `Agent ${userId} retrieved this context for "${packet.query}":\n${packet.summary}`,
      ),
      canonical_content: compactText(`Recent closure exchange with ${userId}:\n${packet.summary}`),
      context_exchange_id: packet.context_exchange_id,
      metadata: {
        source: "retriever-closure",
        asking_agent_id: userId,
      },
    });
  }

  return operations;
}

async function runRetrieverAgent(
  options: RunLocalAssistantOptions,
  cwd: string,
  anthropicApiKey: string,
  request: RetrieverRequest,
): Promise<ContextPacket> {
  const observedPackets: ContextPacket[] = [];
  const retrieverServer = createRetrieverMcpServer(
    {
      serverUrl: options.serverUrl,
      userId: options.userId,
      authToken: options.authToken,
      projectId: options.projectId,
    },
    (packet) => observedPackets.push(packet),
  );

  const sdkMessages = query({
    prompt: buildRetrieverPrompt(options.userId, request),
    options: {
      cwd,
      env: buildSdkEnvironment(anthropicApiKey),
      model: options.model,
      maxTurns: 3,
      includePartialMessages: false,
      systemPrompt:
        "You are the retriever agent. Use only agent_ctx and global_ctx. Return JSON only.",
      tools: [],
      allowedTools: [...RETRIEVER_ALLOWED_TOOLS],
      mcpServers: {
        "relevo-memory": retrieverServer,
      },
    },
  });

  let finalText = "";
  for await (const sdkMessage of sdkMessages) {
    if (sdkMessage.type === "result" && sdkMessage.subtype === "success") {
      finalText = sdkMessage.result;
    }
  }

  return packetFromText(finalText) ?? observedPackets.at(-1) ?? {
    query: request.query,
    scope: request.target_agent_id ? "agent" : "global",
    target_agent_id: request.target_agent_id,
    results: [],
    insufficient_context: true,
    summary: "The retriever did not return context.",
  };
}

async function runUserAgentTurn(
  options: RunLocalAssistantOptions,
  cwd: string,
  anthropicApiKey: string,
  systemPrompt: string,
  retrieve: (request: RetrieverRequest) => Promise<ContextPacket>,
  input: UserAgentInput,
): Promise<{ events: LocalAssistantEvent[]; finalAnswer: string; contextPackets: ContextPacket[] }> {
  const contextPackets: ContextPacket[] = [];
  const userRetrieverServer = createUserRetrieverMcpServer(async (request) => {
    const packet = await retrieve(request);
    contextPackets.push(packet);
    return packet;
  });

  const sdkMessages = query({
    prompt: buildUserPrompt(input.prompt, input.preflightContext),
    options: {
      cwd,
      env: buildSdkEnvironment(anthropicApiKey),
      model: options.model,
      maxTurns: options.maxTurns,
      includePartialMessages: true,
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: systemPrompt,
      },
      tools: {
        type: "preset",
        preset: "claude_code",
      },
      allowedTools: [...USER_AGENT_ALLOWED_TOOLS],
      mcpServers: {
        "relevo-user-retriever": userRetrieverServer,
      },
    },
  });

  const events: LocalAssistantEvent[] = [];
  let streamedAssistantText = false;
  let finalAnswer = "";

  for await (const sdkMessage of sdkMessages) {
    let normalizedEvents = normalizeSdkMessage(sdkMessage);

    if (sdkMessage.type === "stream_event") {
      streamedAssistantText =
        streamedAssistantText || normalizedEvents.some((event) => event.type === "assistant_text");
    }

    if (streamedAssistantText && sdkMessage.type === "assistant") {
      normalizedEvents = stripAssistantTextEvents(normalizedEvents);
    }

    for (const event of normalizedEvents) {
      if (event.type === "result") {
        finalAnswer = event.result;
      }
      events.push(event);
    }
  }

  return { events, finalAnswer, contextPackets };
}

async function runUpdaterAgent(
  options: RunLocalAssistantOptions,
  cwd: string,
  anthropicApiKey: string,
  input: UpdaterInput,
): Promise<MemoryUpdateResponse> {
  const operations = buildMemoryOperations(options.userId, input);
  const observedCommits: MemoryUpdateResponse[] = [];
  const updaterServer = createUpdaterMcpServer(
    {
      serverUrl: options.serverUrl,
      userId: options.userId,
      authToken: options.authToken,
      projectId: options.projectId,
    },
    (response) => observedCommits.push(response),
  );

  const sdkMessages = query({
    prompt: buildUpdaterPrompt(input, operations),
    options: {
      cwd,
      env: buildSdkEnvironment(anthropicApiKey),
      model: options.model,
      maxTurns: 2,
      includePartialMessages: false,
      systemPrompt:
        "You are the updater agent. You may only call commit_memory_update.",
      tools: [],
      allowedTools: [...UPDATER_ALLOWED_TOOLS],
      mcpServers: {
        "relevo-updater": updaterServer,
      },
    },
  });

  for await (const _sdkMessage of sdkMessages) {
    // The updater's useful side effect is captured by the MCP commit callback.
  }

  if (observedCommits.length > 0) {
    return observedCommits.at(-1)!;
  }

  return commitMemoryUpdate(
    {
      serverUrl: options.serverUrl,
      userId: options.userId,
      authToken: options.authToken,
    },
    {
      chat_session_id: input.chatSessionId,
      checkpoint_index: input.checkpointIndex,
      operations,
    },
  );
}

function initialConversation(options: RunLocalAssistantOptions): ConversationMessage[] {
  return options.conversationMessages ?? [{ role: "user", text: options.prompt }];
}

export async function* runLocalAssistant(
  options: RunLocalAssistantOptions,
): AsyncGenerator<LocalAssistantEvent> {
  const cwd = await resolveWorkingDirectory(options.cwd);
  const anthropicApiKey = options.anthropicApiKey?.trim();
  if (!anthropicApiKey) {
    throw new Error("Anthropic API key is not configured.");
  }

  const systemPrompt = await buildLocalAssistantSystemPrompt(options.bootstrap);
  const chatSessionId = options.chatSessionId ?? `session-${options.userId}`;

  const retrieve = (request: RetrieverRequest): Promise<ContextPacket> =>
    runRetrieverAgent(options, cwd, anthropicApiKey, request);

  yield* runAgentNetwork(
    {
      prompt: options.prompt,
      chatSessionId,
      conversationMessages: initialConversation(options),
    },
    {
      retrieve,
      runUserAgent: (input) =>
        runUserAgentTurn(options, cwd, anthropicApiKey, systemPrompt, retrieve, input),
      runUpdater: (input) => runUpdaterAgent(options, cwd, anthropicApiKey, input),
    },
  );
}
