import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import type { RequestContextInput, RequestContextResponse } from "./types.js";

export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export type RequestContextClientOptions = {
  serverUrl: string;
  userId: string;
  authToken?: string;
  fetchImpl?: FetchLike;
};

const targetSchema = z.string().min(1);

export const requestContextInputSchema = z.object({
  target: targetSchema.describe("Target teammate user_id (UUID)."),
  question: z.string().min(1).describe("Specific natural-language question for the target context."),
});

function requestContextUrl(serverUrl: string): string {
  return new URL("/request-context", serverUrl).toString();
}

function headersFor(options: RequestContextClientOptions): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-relevo-user-id": options.userId,
  };

  if (options.authToken) {
    headers.authorization = `Bearer ${options.authToken}`;
  }

  return headers;
}

function normalizeResponse(raw: unknown): RequestContextResponse {
  if (!raw || typeof raw !== "object") {
    throw new Error("request_context returned a non-object response");
  }

  const data = raw as Record<string, unknown>;
  if (typeof data.answer !== "string") {
    throw new Error("request_context response is missing string field answer");
  }

  const sourceUserIds = Array.isArray(data.source_user_ids)
    ? data.source_user_ids.filter((item): item is string => typeof item === "string")
    : [];

  const citations = Array.isArray(data.citations)
    ? data.citations.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    : [];

  return {
    answer: data.answer,
    source_user_ids: sourceUserIds,
    citations,
  };
}

export async function callRequestContext(
  options: RequestContextClientOptions,
  input: RequestContextInput,
): Promise<RequestContextResponse> {
  const parsedInput = requestContextInputSchema.parse(input);
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(requestContextUrl(options.serverUrl), {
    method: "POST",
    headers: headersFor(options),
    body: JSON.stringify(parsedInput),
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(
      `request_context failed: ${response.status} ${response.statusText}: ${responseText}`,
    );
  }

  const rawBody = responseText ? JSON.parse(responseText) : {};
  return normalizeResponse(rawBody);
}

export function createRequestContextMcpServer(options: RequestContextClientOptions) {
  return createSdkMcpServer({
    name: "relevo-context",
    version: "0.1.0",
    alwaysLoad: true,
    tools: [
      tool(
        "request_context",
        "Request missing teammate context from the shared Relevo server.",
        {
          target: targetSchema,
          question: z.string().min(1),
        },
        async (args) => {
          const result = await callRequestContext(options, args);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result),
              },
            ],
          };
        },
        {
          alwaysLoad: true,
        },
      ),
    ],
  });
}
