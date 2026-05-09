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
  "preflightRetriever",
  "retriever",
  "userAgent",
  "updater",
] as const;

const CHECKPOINT_MIN_ELAPSED_MS = 3 * 60 * 1000;
const CHECKPOINT_MIN_NEW_MESSAGES = 2;
const CHECKPOINT_HARD_CAP_MESSAGES = 10;

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
    default: () => 0,
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

function shouldRunUpdater(state: AgentNetworkState, now: number): boolean {
  const messageCount = state.conversationMessages.length;
  const newMessages = messageCount - state.lastCheckpointMessageCount;
  if (newMessages < CHECKPOINT_MIN_NEW_MESSAGES) return false;
  if (newMessages >= CHECKPOINT_HARD_CAP_MESSAGES) return true;
  const elapsed = now - (state.lastCheckpointAt ?? state.conversationStartedAt);
  return elapsed >= CHECKPOINT_MIN_ELAPSED_MS;
}

export function createAgentNetworkGraph(dependencies: AgentNetworkDependencies): AgentNetworkGraph {
  return new StateGraph(AgentNetworkAnnotation)
    .addNode("preflightRetriever", async (state): Promise<AgentNetworkUpdate> => {
      const stageStartMs = performance.now();
      const targetAgentId = state.mentionedAgentIds[0] ?? undefined;
      const cleanedQuery = targetAgentId
        ? state.prompt.replace(/@\w+/g, "").replace(/\s{2,}/g, " ").trim()
        : state.prompt;
      logAgentNetwork("preflightRetriever:start", {
        chatSessionId: state.chatSessionId,
        promptPreview: previewText(state.prompt),
        messageCount: state.conversationMessages.length,
        targetAgentId,
        hasMention: Boolean(targetAgentId),
      });
      const result: AgentNetworkUpdate = {
        preflightRequest: {
          query: cleanedQuery || state.prompt,
          target_agent_id: targetAgentId,
          reason: "preflight before user-agent turn",
        },
      };
      logAgentNetwork("preflightRetriever:done", {
        chatSessionId: state.chatSessionId,
        stage: "preflightRetriever",
        durationMs: Math.round(performance.now() - stageStartMs),
      });
      return result;
    })
    .addNode("retriever", async (state): Promise<AgentNetworkUpdate> => {
      const stageStartMs = performance.now();
      if (!state.preflightRequest) {
        logAgentNetwork("retriever:skip", {
          chatSessionId: state.chatSessionId,
          reason: "missing preflight request",
          stage: "retriever",
          durationMs: Math.round(performance.now() - stageStartMs),
        });
        return {};
      }
      logAgentNetwork("retriever:start", {
        chatSessionId: state.chatSessionId,
        scope: state.preflightRequest.target_agent_id ? "agent" : "global",
        targetAgentId: state.preflightRequest.target_agent_id,
        queryPreview: previewText(state.preflightRequest.query),
        reason: state.preflightRequest.reason,
      });
      const packet = await dependencies.retrieve(state.preflightRequest);
      logAgentNetwork("retriever:success", {
        chatSessionId: state.chatSessionId,
        scope: packet.scope,
        targetAgentId: packet.target_agent_id,
        resultCount: packet.results.length,
        insufficientContext: packet.insufficient_context,
        contextExchangeId: packet.context_exchange_id,
        stage: "retriever",
        durationMs: Math.round(performance.now() - stageStartMs),
      });
      return {
        preflightContext: packet,
        contextPackets: [packet],
        events: [
          {
            type: "tool_result",
            toolUseId: "preflightRetriever",
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
    .addEdge(START, "preflightRetriever")
    .addEdge("preflightRetriever", "retriever")
    .addEdge("retriever", "userAgent")
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
    for (const update of Object.values(chunk)) {
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
