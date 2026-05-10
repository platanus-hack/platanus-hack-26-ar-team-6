import { Annotation, END, START, StateGraph, type CompiledStateGraph } from "@langchain/langgraph";

import { createLogger, previewText as previewTextShared } from "./logger.js";
import type {
  ContextPacket,
  ConversationMessage,
  LocalAssistantEvent,
  MemoryUpdateResponse,
  RetrieverRequest,
} from "./types.js";

const agentNetworkLogger = createLogger("relevo.agent-network");

export const AGENT_NETWORK_NODE_ORDER = [
  "preflightRetrieval",
  "retrievalClient",
  "userAgent",
  "updater",
] as const;

// Demo-friendly defaults. The previous gate of 3 minutes was structurally
// unable to fire on the first checkpoint of a session because
// `conversationStartedAt` resets to `Date.now()` on every fresh
// `runLocalAssistant` invocation (each prompt creates a new graph instance).
// Two changes below:
//   1. The first checkpoint of a session ignores the elapsed-time gate
//      entirely. Once it fires, `lastCheckpointAt` is real and the time
//      rule applies again.
//   2. The elapsed threshold is lowered to a value that's reasonable for
//      both real use and demos.
const CHECKPOINT_MIN_ELAPSED_MS = 5000;
const CHECKPOINT_MIN_NEW_MESSAGES = 2;
const CHECKPOINT_HARD_CAP_MESSAGES = 10;
export const MEMORY_UPDATE_MESSAGE_THRESHOLD = CHECKPOINT_HARD_CAP_MESSAGES;
export const MEMORY_UPDATE_MIN_ELAPSED_MS = CHECKPOINT_MIN_ELAPSED_MS;
export const MEMORY_UPDATE_MIN_NEW_MESSAGES = CHECKPOINT_MIN_NEW_MESSAGES;

export type UserAgentInput = {
  prompt: string;
  preflightContext: ContextPacket | null;
  conversationMessages: ConversationMessage[];
};

export type UserAgentOutput = {
  events: LocalAssistantEvent[];
  finalAnswer: string;
  contextPackets: ContextPacket[];
  activityTitle?: string;
};

export type UpdaterInput = {
  chatSessionId: string;
  checkpointIndex: number;
  finalizedMessages: ConversationMessage[];
  contextPackets: ContextPacket[];
  finalAnswer: string;
};

export type AgentNetworkDependencies = {
  retrieve: (request: RetrieverRequest) => Promise<ContextPacket>;
  runUserAgent: (input: UserAgentInput) => Promise<UserAgentOutput>;
  runUpdater: (input: UpdaterInput) => Promise<MemoryUpdateResponse>;
};

const previewText = previewTextShared;

function logAgentNetwork(event: string, details: Record<string, unknown>): void {
  agentNetworkLogger.info(event, details);
}

const AgentNetworkAnnotation = Annotation.Root({
  prompt: Annotation<string>(),
  chatSessionId: Annotation<string>(),
  mentionedAgentIds: Annotation<string[]>({
    reducer: (_previous, next) => next,
    default: () => [],
  }),
  conversationMessages: Annotation<ConversationMessage[]>({
    reducer: (_previous, next) => next,
    default: () => [],
  }),
  preflightRequest: Annotation<RetrieverRequest | null>({
    reducer: (_previous, next) => next,
    default: () => null,
  }),
  preflightContext: Annotation<ContextPacket | null>({
    reducer: (_previous, next) => next,
    default: () => null,
  }),
  contextPackets: Annotation<ContextPacket[]>({
    reducer: (previous, next) => previous.concat(next),
    default: () => [],
  }),
  events: Annotation<LocalAssistantEvent[]>({
    reducer: (previous, next) => previous.concat(next),
    default: () => [],
  }),
  finalAnswer: Annotation<string>({
    reducer: (_previous, next) => next,
    default: () => "",
  }),
  shouldUpdate: Annotation<boolean>({
    reducer: (_previous, next) => next,
    default: () => false,
  }),
  checkpointIndex: Annotation<number>({
    reducer: (_previous, next) => next,
    default: () => 1,
  }),
  conversationStartedAt: Annotation<number>({
    reducer: (_previous, next) => next,
    default: () => Date.now(),
  }),
  lastCheckpointAt: Annotation<number | null>({
    reducer: (_previous, next) => next,
    default: () => null,
  }),
  lastCheckpointMessageCount: Annotation<number>({
    reducer: (_previous, next) => next,
    default: () => 0,
  }),
});

export type AgentNetworkState = typeof AgentNetworkAnnotation.State;
export type AgentNetworkUpdate = typeof AgentNetworkAnnotation.Update;
type AgentNetworkGraph = CompiledStateGraph<AgentNetworkState, AgentNetworkUpdate, string>;
export type RunAgentNetworkOptions = {
  suppressUserAgentEvents?: boolean;
};

export function shouldRunUpdater(state: AgentNetworkState, now: number): boolean {
  const messageCount = state.conversationMessages.length;
  const newMessages = messageCount - state.lastCheckpointMessageCount;
  if (newMessages < CHECKPOINT_MIN_NEW_MESSAGES) return false;
  if (newMessages >= CHECKPOINT_HARD_CAP_MESSAGES) return true;
  // First checkpoint of a session: skip the elapsed-time gate. Otherwise
  // the updater never fires, because `conversationStartedAt` is reset
  // every time the graph is recreated for a new prompt.
  if (state.lastCheckpointAt == null) return true;
  const elapsed = now - state.lastCheckpointAt;
  return elapsed >= CHECKPOINT_MIN_ELAPSED_MS;
}

export function createAgentNetworkGraph(dependencies: AgentNetworkDependencies): AgentNetworkGraph {
  return new StateGraph(AgentNetworkAnnotation)
    .addNode("preflightRetrieval", async (state): Promise<AgentNetworkUpdate> => {
      const stageStartMs = performance.now();
      const targetAgentId = state.mentionedAgentIds[0] ?? undefined;
      const cleanedQuery = targetAgentId
        ? state.prompt.replace(/@\w+/g, "").replace(/\s{2,}/g, " ").trim()
        : state.prompt;
      logAgentNetwork("preflightRetrieval:start", {
        chatSessionId: state.chatSessionId,
        promptPreview: previewText(state.prompt),
        messageCount: state.conversationMessages.length,
        targetAgentId,
        hasMention: Boolean(targetAgentId),
      });
      if (!targetAgentId) {
        logAgentNetwork("preflightRetrieval:done", {
          chatSessionId: state.chatSessionId,
          stage: "preflightRetrieval",
          durationMs: Math.round(performance.now() - stageStartMs),
          reason: "no mention",
        });
        return { preflightRequest: null };
      }
      const result: AgentNetworkUpdate = {
        preflightRequest: {
          query: cleanedQuery || state.prompt,
          target_agent_id: targetAgentId,
          reason: "preflight before user-agent turn",
        },
      };
      logAgentNetwork("preflightRetrieval:done", {
        chatSessionId: state.chatSessionId,
        stage: "preflightRetrieval",
        durationMs: Math.round(performance.now() - stageStartMs),
      });
      return result;
    })
    .addNode("retrievalClient", async (state): Promise<AgentNetworkUpdate> => {
      const stageStartMs = performance.now();
      if (!state.preflightRequest) {
        logAgentNetwork("retrievalClient:skip", {
          chatSessionId: state.chatSessionId,
          reason: "missing preflight request",
          stage: "retrievalClient",
          durationMs: Math.round(performance.now() - stageStartMs),
        });
        return {};
      }
      logAgentNetwork("retrievalClient:start", {
        chatSessionId: state.chatSessionId,
        scope: state.preflightRequest.target_agent_id ? "agent" : "global",
        targetAgentId: state.preflightRequest.target_agent_id,
        queryPreview: previewText(state.preflightRequest.query),
        reason: state.preflightRequest.reason,
      });
      const packet = await dependencies.retrieve(state.preflightRequest);
      logAgentNetwork("retrievalClient:success", {
        chatSessionId: state.chatSessionId,
        scope: packet.scope,
        targetAgentId: packet.target_agent_id,
        resultCount: packet.results.length,
        insufficientContext: packet.insufficient_context,
        contextExchangeId: packet.context_exchange_id,
        stage: "retrievalClient",
        durationMs: Math.round(performance.now() - stageStartMs),
      });
      return {
        preflightContext: packet,
        contextPackets: [packet],
        events: [
          {
            type: "tool_result",
            toolUseId: "preflightRetrieval",
            result: packet,
          },
        ],
      };
    })
    .addNode("userAgent", async (state): Promise<AgentNetworkUpdate> => {
      const stageStartMs = performance.now();
      logAgentNetwork("userAgent:start", {
        chatSessionId: state.chatSessionId,
        messageCount: state.conversationMessages.length,
        preflightScope: state.preflightContext?.scope,
        preflightResults: state.preflightContext?.results.length ?? 0,
      });
      const output = await dependencies.runUserAgent({
        prompt: state.prompt,
        preflightContext: state.preflightContext,
        conversationMessages: state.conversationMessages,
      });
      const finalizedMessages = state.conversationMessages.concat({
        role: "assistant",
        text: output.finalAnswer,
      });
      const now = Date.now();
      const updatedState = { ...state, conversationMessages: finalizedMessages };
      const shouldUpdate = shouldRunUpdater(updatedState, now);
      const checkpointIndex = state.checkpointIndex;
      logAgentNetwork("userAgent:success", {
        chatSessionId: state.chatSessionId,
        eventCount: output.events.length,
        contextPacketCount: output.contextPackets.length,
        finalAnswerLength: output.finalAnswer.length,
        hasActivityTitle: Boolean(output.activityTitle),
        finalizedMessageCount: finalizedMessages.length,
        shouldUpdate,
        checkpointIndex,
        stage: "userAgent",
        durationMs: Math.round(performance.now() - stageStartMs),
      });
      const events = output.activityTitle
        ? output.events.concat({ type: "activity_title", title: output.activityTitle })
        : output.events;
      return {
        conversationMessages: finalizedMessages,
        contextPackets: output.contextPackets,
        events,
        finalAnswer: output.finalAnswer,
        shouldUpdate,
        checkpointIndex,
      };
    })
    .addNode("updater", async (state): Promise<AgentNetworkUpdate> => {
      const stageStartMs = performance.now();
      if (!state.shouldUpdate) {
        logAgentNetwork("updater:skip", {
          chatSessionId: state.chatSessionId,
          messageCount: state.conversationMessages.length,
          checkpointIndex: state.checkpointIndex,
          stage: "updater",
          durationMs: Math.round(performance.now() - stageStartMs),
        });
        return {
          events: [{ type: "memory_update", status: "skipped" }],
        };
      }

      try {
        logAgentNetwork("updater:start", {
          chatSessionId: state.chatSessionId,
          checkpointIndex: state.checkpointIndex,
          finalizedMessageCount: state.conversationMessages.length,
          contextPacketCount: state.contextPackets.length,
        });
        const response = await dependencies.runUpdater({
          chatSessionId: state.chatSessionId,
          checkpointIndex: state.checkpointIndex,
          finalizedMessages: state.conversationMessages,
          contextPackets: state.contextPackets,
          finalAnswer: state.finalAnswer,
        });
        logAgentNetwork("updater:success", {
          chatSessionId: state.chatSessionId,
          checkpointIndex: state.checkpointIndex,
          eventIds: response.event_ids,
          documentIds: response.document_ids,
          stage: "updater",
          durationMs: Math.round(performance.now() - stageStartMs),
        });
        return {
          events: [
            {
              type: "memory_update",
              status: "succeeded",
              checkpointIndex: state.checkpointIndex,
              response,
            },
          ],
          checkpointIndex: state.checkpointIndex + 1,
          lastCheckpointAt: Date.now(),
          lastCheckpointMessageCount: state.conversationMessages.length,
        };
      } catch (error) {
        logAgentNetwork("updater:failed", {
          chatSessionId: state.chatSessionId,
          checkpointIndex: state.checkpointIndex,
          errorMessage: error instanceof Error ? error.message : String(error),
          stage: "updater",
          durationMs: Math.round(performance.now() - stageStartMs),
        });
        return {
          events: [
            {
              type: "memory_update",
              status: "failed",
              checkpointIndex: state.checkpointIndex,
              errorMessage: error instanceof Error ? error.message : String(error),
            },
          ],
        };
      }
    })
    .addEdge(START, "preflightRetrieval")
    .addEdge("preflightRetrieval", "retrievalClient")
    .addEdge("retrievalClient", "userAgent")
    .addConditionalEdges("userAgent", (state) => (state.shouldUpdate ? "updater" : END), [
      "updater",
      END,
    ])
    .addEdge("updater", END)
    .compile();
}

export async function* runAgentNetwork(
  input: {
    prompt: string;
    chatSessionId: string;
    conversationMessages: ConversationMessage[];
    mentionedAgentIds?: string[];
  },
  dependencies: AgentNetworkDependencies,
  options: RunAgentNetworkOptions = {},
): AsyncGenerator<LocalAssistantEvent> {
  const graphStartMs = performance.now();
  logAgentNetwork("graph:start", {
    chatSessionId: input.chatSessionId,
    messageCount: input.conversationMessages.length,
    promptPreview: previewText(input.prompt),
    mentionedAgentIds: input.mentionedAgentIds ?? [],
  });
  const graph = createAgentNetworkGraph(dependencies);
  const stream = await graph.stream(
    { ...input, mentionedAgentIds: input.mentionedAgentIds ?? [] },
    { streamMode: "updates" },
  );

  for await (const chunk of stream) {
    logAgentNetwork("graph:update", {
      chatSessionId: input.chatSessionId,
      nodes: Object.keys(chunk),
    });
    for (const [nodeName, update] of Object.entries(chunk)) {
      if (options.suppressUserAgentEvents && nodeName === "userAgent") {
        continue;
      }
      const events = (update as Partial<AgentNetworkState>).events ?? [];
      for (const event of events) {
        agentNetworkLogger.debug("graph:event", {
          chatSessionId: input.chatSessionId,
          eventType: event.type,
          toolName: "toolName" in event ? event.toolName : undefined,
          toolUseId: "toolUseId" in event ? event.toolUseId : undefined,
          status: "status" in event ? event.status : undefined,
          textPreview:
            event.type === "assistant_text" ? previewText(event.text, 200) : undefined,
        });
        yield event;
      }
    }
  }
  logAgentNetwork("graph:done", {
    chatSessionId: input.chatSessionId,
    totalDurationMs: Math.round(performance.now() - graphStartMs),
  });
}
