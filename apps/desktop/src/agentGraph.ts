import { Annotation, END, START, StateGraph, type CompiledStateGraph } from "@langchain/langgraph";

import type {
  ContextPacket,
  ConversationMessage,
  LocalAssistantEvent,
  MemoryUpdateResponse,
  RetrieverRequest,
} from "./types.js";

export const AGENT_NETWORK_NODE_ORDER = [
  "preflightRetriever",
  "retriever",
  "userAgent",
  "updater",
] as const;

export const MEMORY_UPDATE_MESSAGE_THRESHOLD = 6;

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

function previewText(text: string, maxLength = 120): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function logAgentNetwork(event: string, details: Record<string, unknown>): void {
  console.info("[relevo.agent-network]", event, details);
}

const AgentNetworkAnnotation = Annotation.Root({
  prompt: Annotation<string>(),
  chatSessionId: Annotation<string>(),
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
});

export type AgentNetworkState = typeof AgentNetworkAnnotation.State;
export type AgentNetworkUpdate = typeof AgentNetworkAnnotation.Update;
type AgentNetworkGraph = CompiledStateGraph<AgentNetworkState, AgentNetworkUpdate, string>;

function checkpointIndexFor(messages: ConversationMessage[]): number {
  return Math.floor(messages.length / MEMORY_UPDATE_MESSAGE_THRESHOLD);
}

function shouldRunUpdater(messages: ConversationMessage[]): boolean {
  return messages.length > 0 && messages.length % MEMORY_UPDATE_MESSAGE_THRESHOLD === 0;
}

export function createAgentNetworkGraph(dependencies: AgentNetworkDependencies): AgentNetworkGraph {
  return new StateGraph(AgentNetworkAnnotation)
    .addNode("preflightRetriever", async (state): Promise<AgentNetworkUpdate> => {
      logAgentNetwork("preflightRetriever:start", {
        chatSessionId: state.chatSessionId,
        promptPreview: previewText(state.prompt),
        messageCount: state.conversationMessages.length,
      });
      return {
        preflightRequest: {
          query: state.prompt,
          reason: "preflight before user-agent turn",
        },
      };
    })
    .addNode("retriever", async (state): Promise<AgentNetworkUpdate> => {
      if (!state.preflightRequest) {
        logAgentNetwork("retriever:skip", {
          chatSessionId: state.chatSessionId,
          reason: "missing preflight request",
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
      const shouldUpdate = shouldRunUpdater(finalizedMessages);
      const checkpointIndex = checkpointIndexFor(finalizedMessages);
      logAgentNetwork("userAgent:success", {
        chatSessionId: state.chatSessionId,
        eventCount: output.events.length,
        contextPacketCount: output.contextPackets.length,
        finalAnswerLength: output.finalAnswer.length,
        hasActivityTitle: Boolean(output.activityTitle),
        finalizedMessageCount: finalizedMessages.length,
        shouldUpdate,
        checkpointIndex,
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
      if (!state.shouldUpdate) {
        logAgentNetwork("updater:skip", {
          chatSessionId: state.chatSessionId,
          messageCount: state.conversationMessages.length,
          checkpointIndex: state.checkpointIndex,
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
        };
      } catch (error) {
        logAgentNetwork("updater:failed", {
          chatSessionId: state.chatSessionId,
          checkpointIndex: state.checkpointIndex,
          errorMessage: error instanceof Error ? error.message : String(error),
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
  },
  dependencies: AgentNetworkDependencies,
): AsyncGenerator<LocalAssistantEvent> {
  logAgentNetwork("graph:start", {
    chatSessionId: input.chatSessionId,
    messageCount: input.conversationMessages.length,
    promptPreview: previewText(input.prompt),
  });
  const graph = createAgentNetworkGraph(dependencies);
  const stream = await graph.stream(input, { streamMode: "updates" });

  for await (const chunk of stream) {
    logAgentNetwork("graph:update", {
      chatSessionId: input.chatSessionId,
      nodes: Object.keys(chunk),
    });
    for (const update of Object.values(chunk)) {
      const events = (update as Partial<AgentNetworkState>).events ?? [];
      for (const event of events) {
        logAgentNetwork("graph:event", {
          chatSessionId: input.chatSessionId,
          eventType: event.type,
          toolName: "toolName" in event ? event.toolName : undefined,
          status: "status" in event ? event.status : undefined,
        });
        yield event;
      }
    }
  }
  logAgentNetwork("graph:done", {
    chatSessionId: input.chatSessionId,
  });
}
