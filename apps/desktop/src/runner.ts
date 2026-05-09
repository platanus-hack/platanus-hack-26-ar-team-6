import { stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";

const requireFromRunner = createRequire(import.meta.url);

function resolveClaudeBinary(): string | undefined {
  if (process.env.RELEVO_CLAUDE_PATH) {
    return process.env.RELEVO_CLAUDE_PATH;
  }
  if (process.platform !== "linux") {
    return undefined;
  }
  try {
    const pkgJson = requireFromRunner.resolve(
      "@anthropic-ai/claude-agent-sdk-linux-x64/package.json",
    );
    return resolve(pkgJson, "..", "claude");
  } catch {
    return undefined;
  }
}

const CLAUDE_BINARY_OVERRIDE = resolveClaudeBinary();
const CLAUDE_BINARY_OPTIONS: { pathToClaudeCodeExecutable?: string } =
  CLAUDE_BINARY_OVERRIDE ? { pathToClaudeCodeExecutable: CLAUDE_BINARY_OVERRIDE } : {};

import { runAgentNetwork, type UpdaterInput, type UserAgentInput } from "./agentGraph.js";
import { createLogger, previewText as previewTextShared } from "./logger.js";
import {
  commitMemoryUpdate,
  createUserRetrieverMcpServer,
  retrieveContext,
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
  "mcp__relevo-user-retriever__set_activity_title",
] as const;

export const RETRIEVAL_CLIENT_ALLOWED_TOOLS = [] as const;

export const UPDATER_ALLOWED_TOOLS = [
  "mcp__relevo-updater__commit_memory_update",
] as const;

const previewText = previewTextShared;

const runnerLogger = createLogger("relevo.runner");
const RETRIEVE_CONTEXT_CLIENT_NAME = "retrieve-context-client";
const MEMORY_UPDATES_CLIENT_NAME = "memory-updates-client";

function logRunner(event: string, details: Record<string, unknown>): void {
  runnerLogger.info(event, details);
}

function summarizeSdkMessage(message: SDKMessage): Record<string, unknown> {
  const summary: Record<string, unknown> = { messageType: message.type };
  const subtype = (message as { subtype?: string }).subtype;
  if (typeof subtype === "string") summary.subtype = subtype;
  if (message.type === "stream_event") {
    summary.streamEventType = message.event?.type;
    if (message.event && "delta" in message.event) {
      const delta = (message.event as { delta?: { type?: string } }).delta;
      summary.deltaType = delta?.type;
    }
  }
  if (message.type === "result") {
    summary.sessionId = (message as { session_id?: string }).session_id;
    summary.numTurns = (message as { num_turns?: number }).num_turns;
  }
  return summary;
}

function summarizeAssistantEvent(event: LocalAssistantEvent): Record<string, unknown> {
  const base: Record<string, unknown> = { type: event.type };
  switch (event.type) {
    case "assistant_text":
      base.textPreview = previewText(event.text, 240);
      base.textLength = event.text.length;
      break;
    case "tool_call":
      base.toolName = event.toolName;
      base.toolUseId = event.toolUseId;
      base.input = event.input;
      break;
    case "tool_result":
      base.toolUseId = event.toolUseId;
      if ("errorMessage" in event && event.errorMessage) {
        base.errorMessage = event.errorMessage;
      }
      if ("result" in event && event.result) {
        const result = event.result;
        base.resultScope = result.scope;
        base.resultCount = result.results?.length ?? 0;
        base.insufficientContext = result.insufficient_context;
      }
      break;
    case "tool_status":
      base.toolName = event.toolName;
      base.toolUseId = event.toolUseId;
      base.elapsedTimeSeconds = event.elapsedTimeSeconds;
      break;
    case "result":
      base.sessionId = event.sessionId;
      base.resultPreview = previewText(event.result, 240);
      base.resultLength = event.result.length;
      break;
    case "error":
      base.sessionId = event.sessionId;
      base.message = event.message;
      break;
    case "raw":
      base.messageType = event.messageType;
      base.message = summarizeSdkMessage(event.message as SDKMessage);
      break;
    case "memory_update":
      base.status = event.status;
      if ("checkpointIndex" in event) base.checkpointIndex = event.checkpointIndex;
      if ("errorMessage" in event && event.errorMessage) {
        base.errorMessage = event.errorMessage;
      }
      break;
  }
  return base;
}

async function resolveWorkingDirectory(cwd: string): Promise<string> {
  const resolved = resolve(cwd);
  const stats = await stat(resolved);
  if (!stats.isDirectory()) {
    throw new Error(`cwd must be a directory: ${resolved}`);
  }
  logRunner("cwd:resolved", { cwd: resolved });
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

function isActivityTitleToolName(toolName: string): boolean {
  return toolName === "set_activity_title" || toolName.endsWith("__set_activity_title");
}

function isInternalActivityTitleEvent(event: LocalAssistantEvent): boolean {
  return "toolName" in event && isActivityTitleToolName(event.toolName);
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

function formatPreflightContext(packet: ContextPacket | null): string {
  if (!packet) {
    return "No preflight context packet was available.";
  }

  return [
    "Preflight retrieval context packet:",
    "```json",
    JSON.stringify(packet, null, 2),
    "```",
  ].join("\n");
}

function buildUserPrompt(prompt: string, packet: ContextPacket | null): string {
  return [formatPreflightContext(packet), "", "User message:", prompt].join("\n");
}

function createEventQueue<T>(): {
  push: (item: T) => void;
  close: () => void;
  fail: (error: unknown) => void;
  stream: () => AsyncGenerator<T>;
} {
  const items: T[] = [];
  const waiters: Array<{
    resolve: (result: IteratorResult<T>) => void;
    reject: (error: unknown) => void;
  }> = [];
  let closed = false;
  let failure: unknown = null;

  function settleNext(): void {
    const waiter = waiters.shift();
    if (!waiter) {
      return;
    }
    if (failure) {
      waiter.reject(failure);
      return;
    }
    const item = items.shift();
    if (item !== undefined) {
      waiter.resolve({ value: item, done: false });
      return;
    }
    if (closed) {
      waiter.resolve({ value: undefined, done: true });
      return;
    }
    waiters.unshift(waiter);
  }

  return {
    push: (item: T) => {
      if (closed || failure) {
        return;
      }
      const waiter = waiters.shift();
      if (waiter) {
        waiter.resolve({ value: item, done: false });
        return;
      }
      items.push(item);
    },
    close: () => {
      closed = true;
      while (waiters.length > 0) {
        settleNext();
      }
    },
    fail: (error: unknown) => {
      failure = error;
      while (waiters.length > 0) {
        settleNext();
      }
    },
    stream: async function* () {
      while (true) {
        if (failure) {
          throw failure;
        }
        const item = items.shift();
        if (item !== undefined) {
          yield item;
          continue;
        }
        if (closed) {
          return;
        }
        const next = await new Promise<IteratorResult<T>>((resolve, reject) => {
          waiters.push({ resolve, reject });
        });
        if (next.done) {
          return;
        }
        yield next.value;
      }
    },
  };
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
        source: "retrieval-closure",
        asking_agent_id: userId,
      },
    });
  }

  logRunner("updater:operations-built", {
    userId,
    chatSessionId: input.chatSessionId,
    checkpointIndex: input.checkpointIndex,
    operationCount: operations.length,
    operations: operations.map((operation) => ({
      authorAgentId: operation.author_agent_id,
      importance: operation.importance,
      documentKey: operation.document_key,
      contextExchangeId: operation.context_exchange_id,
      metadataKeys: Object.keys(operation.metadata ?? {}),
    })),
  });
  return operations;
}

async function runRetrievalClient(
  options: RunLocalAssistantOptions,
  request: RetrieverRequest,
): Promise<ContextPacket> {
  const clientStartMs = performance.now();
  logRunner("retrieval-client:start", {
    userId: options.userId,
    projectId: options.projectId,
    scope: request.target_agent_id ? "agent" : "global",
    targetAgentId: request.target_agent_id,
    queryPreview: previewText(request.query),
    reason: request.reason,
    model: RETRIEVE_CONTEXT_CLIENT_NAME,
    client: RETRIEVE_CONTEXT_CLIENT_NAME,
    endpoint: "/retrieve-context",
  });
  const packet = await retrieveContext(
    {
      serverUrl: options.serverUrl,
      userId: options.userId,
      authToken: options.authToken,
      projectId: options.projectId,
    },
    request,
  );
  logRunner("retrieval-client:done", {
    userId: options.userId,
    scope: packet.scope,
    targetAgentId: packet.target_agent_id,
    resultCount: packet.results.length,
    insufficientContext: packet.insufficient_context,
    contextExchangeId: packet.context_exchange_id,
    client: RETRIEVE_CONTEXT_CLIENT_NAME,
    endpoint: "/retrieve-context",
    observedPacketCount: 1,
    finalTextLength: packet.summary.length,
    timeToFirstSdkMessageMs: Math.round(performance.now() - clientStartMs),
    totalDurationMs: Math.round(performance.now() - clientStartMs),
  });
  return packet;
}

async function runUserAgentTurn(
  options: RunLocalAssistantOptions,
  cwd: string,
  anthropicApiKey: string,
  systemPrompt: string,
  retrieve: (request: RetrieverRequest) => Promise<ContextPacket>,
  input: UserAgentInput,
  onEvent?: (event: LocalAssistantEvent) => void,
): Promise<{
  events: LocalAssistantEvent[];
  finalAnswer: string;
  contextPackets: ContextPacket[];
  activityTitle?: string;
}> {
  const turnStartMs = performance.now();
  logRunner("user-agent:start", {
    userId: options.userId,
    projectId: options.projectId,
    promptPreview: previewText(input.prompt),
    preflightScope: input.preflightContext?.scope,
    preflightResults: input.preflightContext?.results.length ?? 0,
    conversationMessageCount: input.conversationMessages.length,
    model: options.model,
    maxTurns: options.maxTurns,
  });
  const contextPackets: ContextPacket[] = [];
  let activityTitle: string | undefined;
  const userRetrieverServer = createUserRetrieverMcpServer(
    async (request) => {
      logRunner("user-agent:ask-retrieval:start", {
        userId: options.userId,
        scope: request.target_agent_id ? "agent" : "global",
        targetAgentId: request.target_agent_id,
        queryPreview: previewText(request.query),
        reason: request.reason,
      });
      const packet = await retrieve(request);
      contextPackets.push(packet);
      logRunner("user-agent:ask-retrieval:done", {
        userId: options.userId,
        scope: packet.scope,
        targetAgentId: packet.target_agent_id,
        resultCount: packet.results.length,
        insufficientContext: packet.insufficient_context,
        contextExchangeId: packet.context_exchange_id,
      });
      return packet;
    },
    (title) => {
      activityTitle = title;
      logRunner("user-agent:activity-title", {
        userId: options.userId,
        titlePreview: previewText(title, 80),
      });
    },
  );

  const sdkMessages = query({
    prompt: buildUserPrompt(input.prompt, input.preflightContext),
    options: {
      ...CLAUDE_BINARY_OPTIONS,
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
  let firstSdkMessageMs: number | null = null;
  let firstAssistantTextMs: number | null = null;
  let toolCallCount = 0;
  let toolResultCount = 0;

  for await (const sdkMessage of sdkMessages) {
    if (firstSdkMessageMs === null) {
      firstSdkMessageMs = performance.now();
    }
    let normalizedEvents = normalizeSdkMessage(sdkMessage);

    if (sdkMessage.type === "stream_event") {
      streamedAssistantText =
        streamedAssistantText || normalizedEvents.some((event) => event.type === "assistant_text");
    }

    if (streamedAssistantText && sdkMessage.type === "assistant") {
      normalizedEvents = stripAssistantTextEvents(normalizedEvents);
    }

    for (const event of normalizedEvents) {
      if (isInternalActivityTitleEvent(event)) {
        continue;
      }
      if (event.type === "assistant_text" && firstAssistantTextMs === null) {
        firstAssistantTextMs = performance.now();
      }
      if (event.type === "tool_call") {
        toolCallCount += 1;
      }
      if (event.type === "tool_result") {
        toolResultCount += 1;
      }
      if (event.type === "result") {
        finalAnswer = event.result;
      }
      runnerLogger.debug("user-agent:event", {
        userId: options.userId,
        sdkMessage: summarizeSdkMessage(sdkMessage),
        event: summarizeAssistantEvent(event),
      });
      events.push(event);
      onEvent?.(event);
    }
  }

  logRunner("user-agent:done", {
    userId: options.userId,
    eventCount: events.length,
    finalAnswerLength: finalAnswer.length,
    contextPacketCount: contextPackets.length,
    hasActivityTitle: Boolean(activityTitle),
    timeToFirstSdkMessageMs:
      firstSdkMessageMs !== null ? Math.round(firstSdkMessageMs - turnStartMs) : null,
    timeToFirstAssistantTextMs:
      firstAssistantTextMs !== null ? Math.round(firstAssistantTextMs - turnStartMs) : null,
    totalDurationMs: Math.round(performance.now() - turnStartMs),
    toolCallCount,
    toolResultCount,
  });
  return { events, finalAnswer, contextPackets, activityTitle };
}

async function runUpdaterAgent(
  options: RunLocalAssistantOptions,
  _cwd: string,
  _anthropicApiKey: string,
  input: UpdaterInput,
): Promise<MemoryUpdateResponse> {
  const agentStartMs = performance.now();
  logRunner("updater-agent:start", {
    userId: options.userId,
    projectId: options.projectId,
    chatSessionId: input.chatSessionId,
    checkpointIndex: input.checkpointIndex,
    finalizedMessageCount: input.finalizedMessages.length,
    contextPacketCount: input.contextPackets.length,
    finalAnswerLength: input.finalAnswer.length,
    model: MEMORY_UPDATES_CLIENT_NAME,
    client: MEMORY_UPDATES_CLIENT_NAME,
    endpoint: "/memory-updates",
  });
  const operations = buildMemoryOperations(options.userId, input);
  const response = await commitMemoryUpdate(
    {
      serverUrl: options.serverUrl,
      userId: options.userId,
      authToken: options.authToken,
      projectId: options.projectId,
    },
    {
      chat_session_id: input.chatSessionId,
      checkpoint_index: input.checkpointIndex,
      operations,
    },
  );
  logRunner("updater-agent:done", {
    userId: options.userId,
    source: MEMORY_UPDATES_CLIENT_NAME,
    eventIds: response.event_ids,
    documentIds: response.document_ids,
    totalDurationMs: Math.round(performance.now() - agentStartMs),
  });
  return response;
}

function initialConversation(options: RunLocalAssistantOptions): ConversationMessage[] {
  return options.conversationMessages ?? [{ role: "user", text: options.prompt }];
}

export async function* runLocalAssistant(
  options: RunLocalAssistantOptions,
): AsyncGenerator<LocalAssistantEvent> {
  logRunner("local-assistant:start", {
    userId: options.userId,
    projectId: options.projectId,
    serverUrl: options.serverUrl,
    hasAuthToken: Boolean(options.authToken),
    promptPreview: previewText(options.prompt),
    model: options.model,
    maxTurns: options.maxTurns,
    providedConversationMessages: options.conversationMessages?.length ?? 0,
  });
  const cwd = await resolveWorkingDirectory(options.cwd);
  const anthropicApiKey = options.anthropicApiKey?.trim();
  if (!anthropicApiKey) {
    throw new Error("Anthropic API key is not configured.");
  }

  const systemPrompt = await buildLocalAssistantSystemPrompt(options.bootstrap);
  const chatSessionId = options.chatSessionId ?? `session-${options.userId}`;
  logRunner("local-assistant:ready", {
    userId: options.userId,
    projectId: options.projectId,
    chatSessionId,
    cwd,
    systemPromptLength: systemPrompt.length,
  });

  const retrieve = (request: RetrieverRequest): Promise<ContextPacket> =>
    runRetrievalClient(options, request);
  const eventQueue = createEventQueue<LocalAssistantEvent>();

  const stream = runAgentNetwork(
    {
      prompt: options.prompt,
      chatSessionId,
      conversationMessages: initialConversation(options),
      mentionedAgentIds: options.mentionedAgentIds ?? [],
    },
    {
      retrieve,
      runUserAgent: async (input) => {
        const output = await runUserAgentTurn(
          options,
          cwd,
          anthropicApiKey,
          systemPrompt,
          retrieve,
          input,
          (event) => eventQueue.push(event),
        );
        if (output.activityTitle) {
          eventQueue.push({ type: "activity_title", title: output.activityTitle });
        }
        return output;
      },
      runUpdater: (input) => runUpdaterAgent(options, cwd, anthropicApiKey, input),
    },
    { suppressUserAgentEvents: true },
  );
  const graphTask = (async () => {
    try {
      for await (const event of stream) {
        eventQueue.push(event);
      }
      eventQueue.close();
    } catch (error) {
      eventQueue.fail(error);
    }
  })();

  for await (const event of eventQueue.stream()) {
    runnerLogger.debug("local-assistant:event", {
      userId: options.userId,
      chatSessionId,
      event: summarizeAssistantEvent(event),
    });
    yield event;
  }
  await graphTask;
  logRunner("local-assistant:done", {
    userId: options.userId,
    chatSessionId,
  });
}
