import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

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

function checkpointIndexFor(messages: ConversationMessage[]): number {
  return Math.floor(messages.length / MEMORY_UPDATE_MESSAGE_THRESHOLD);
}

function shouldRunUpdater(messages: ConversationMessage[]): boolean {
  return messages.length > 0 && messages.length % MEMORY_UPDATE_MESSAGE_THRESHOLD === 0;
}

export function createAgentNetworkGraph(dependencies: AgentNetworkDependencies) {
  return new StateGraph(AgentNetworkAnnotation)
    .addNode("preflightRetriever", async (state): Promise<AgentNetworkUpdate> => {
      return {
        preflightRequest: {
          query: state.prompt,
          reason: "preflight before user-agent turn",
        },
      };
    })
    .addNode("retriever", async (state): Promise<AgentNetworkUpdate> => {
      if (!state.preflightRequest) {
        return {};
      }
      const packet = await dependencies.retrieve(state.preflightRequest);
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
      const output = await dependencies.runUserAgent({
        prompt: state.prompt,
        preflightContext: state.preflightContext,
        conversationMessages: state.conversationMessages,
      });
      const finalizedMessages = state.conversationMessages.concat({
        role: "assistant",
        text: output.finalAnswer,
      });
      return {
        conversationMessages: finalizedMessages,
        contextPackets: output.contextPackets,
        events: output.events,
        finalAnswer: output.finalAnswer,
        shouldUpdate: shouldRunUpdater(finalizedMessages),
        checkpointIndex: checkpointIndexFor(finalizedMessages),
      };
    })
    .addNode("updater", async (state): Promise<AgentNetworkUpdate> => {
      if (!state.shouldUpdate) {
        return {
          events: [{ type: "memory_update", status: "skipped" }],
        };
      }

      try {
        const response = await dependencies.runUpdater({
          chatSessionId: state.chatSessionId,
          checkpointIndex: state.checkpointIndex,
          finalizedMessages: state.conversationMessages,
          contextPackets: state.contextPackets,
          finalAnswer: state.finalAnswer,
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
  const graph = createAgentNetworkGraph(dependencies);
  const stream = await graph.stream(input, { streamMode: "updates" });

  for await (const chunk of stream) {
    for (const update of Object.values(chunk)) {
      const events = (update as Partial<AgentNetworkState>).events ?? [];
      for (const event of events) {
        yield event;
      }
    }
  }
}
