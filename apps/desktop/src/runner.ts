import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";

import { buildLocalAssistantSystemPrompt } from "./prompt.js";
import { createRequestContextMcpServer } from "./requestContextTool.js";
import type { LocalAssistantEvent, RequestContextResponse, RunLocalAssistantOptions } from "./types.js";

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

function parseToolUseResult(toolUseResult: unknown): RequestContextResponse | { error: string } | null {
  if (!toolUseResult || typeof toolUseResult !== "object") {
    return null;
  }

  const data = toolUseResult as Record<string, unknown>;
  if (typeof data.error === "string") {
    return { error: data.error };
  }

  if (typeof data.answer !== "string") {
    return null;
  }

  return {
    answer: data.answer,
    source_user_ids: Array.isArray(data.source_user_ids)
      ? data.source_user_ids.filter((item): item is string => typeof item === "string")
      : [],
    citations: Array.isArray(data.citations)
      ? data.citations.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      : [],
  };
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

export async function* runLocalAssistant(
  options: RunLocalAssistantOptions,
): AsyncGenerator<LocalAssistantEvent> {
  const cwd = await resolveWorkingDirectory(options.cwd);
  const anthropicApiKey = options.anthropicApiKey?.trim();
  if (!anthropicApiKey) {
    throw new Error("Anthropic API key is not configured.");
  }

  const systemPrompt = await buildLocalAssistantSystemPrompt(options.bootstrap);
  const requestContextServer = createRequestContextMcpServer({
    serverUrl: options.serverUrl,
    userId: options.userId,
    authToken: options.authToken,
    projectId: options.projectId,
  });

  const sdkMessages = query({
    prompt: options.prompt,
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
      allowedTools: ["mcp__relevo-context__request_context"],
      mcpServers: {
        "relevo-context": requestContextServer,
      },
    },
  });

  let streamedAssistantText = false;

  for await (const sdkMessage of sdkMessages) {
    let events = normalizeSdkMessage(sdkMessage);

    if (sdkMessage.type === "stream_event") {
      streamedAssistantText = streamedAssistantText || events.some((event) => event.type === "assistant_text");
    }

    if (streamedAssistantText && sdkMessage.type === "assistant") {
      events = stripAssistantTextEvents(events);
    }

    for (const event of events) {
      yield event;
    }
  }
}
