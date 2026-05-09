import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";

import { buildLocalAssistantSystemPrompt } from "./prompt.js";
import { createRequestContextMcpServer } from "./requestContextTool.js";
import type { LocalAssistantEvent, RunLocalAssistantOptions } from "./types.js";

async function resolveWorkingDirectory(cwd: string): Promise<string> {
  const resolved = resolve(cwd);
  const stats = await stat(resolved);
  if (!stats.isDirectory()) {
    throw new Error(`cwd must be a directory: ${resolved}`);
  }
  return resolved;
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

function normalizeSdkMessage(message: SDKMessage): LocalAssistantEvent[] {
  const assistantEvents = textFromAssistantMessage(message);
  if (assistantEvents.length > 0) {
    return assistantEvents;
  }

  const partialEvents = textFromPartialMessage(message);
  if (partialEvents.length > 0) {
    return partialEvents;
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
  const systemPrompt = await buildLocalAssistantSystemPrompt(options.bootstrap);
  const requestContextServer = createRequestContextMcpServer({
    serverUrl: options.serverUrl,
    userId: options.userId,
    authToken: options.authToken,
  });

  const sdkMessages = query({
    prompt: options.prompt,
    options: {
      cwd,
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

  for await (const sdkMessage of sdkMessages) {
    for (const event of normalizeSdkMessage(sdkMessage)) {
      yield event;
    }
  }
}
