export type MemoryResult = {
  id: string;
  kind: string;
  content: string;
  metadata: Record<string, unknown>;
  created_at: unknown;
};

export type RetrieverRequest = {
  query: string;
  target_agent_id?: string;
  reason?: string;
};

export type ContextPacket = {
  query: string;
  scope: "agent" | "global";
  target_agent_id?: string;
  context_exchange_id?: string;
  results: MemoryResult[];
  insufficient_context: boolean;
  summary: string;
};

export type MemoryUpdateOperation = {
  author_agent_id: string;
  importance: "local" | "global";
  document_key: string;
  event_content: string;
  canonical_content?: string;
  context_exchange_id?: string;
  metadata?: Record<string, unknown>;
};

export type MemoryUpdateResponse = {
  event_ids: string[];
  document_ids: string[];
};

export type ConversationMessage = {
  role: "user" | "assistant";
  text: string;
};

export type BootstrapContext = {
  user_summary: unknown;
  project_context: unknown;
};

export type LocalAssistantEvent =
  | {
      type: "assistant_text";
      text: string;
    }
  | {
      type: "tool_call";
      toolName: string;
      toolUseId?: string;
      input?: unknown;
    }
  | {
      type: "tool_status";
      toolName: string;
      toolUseId?: string;
      elapsedTimeSeconds?: number;
    }
  | {
      type: "tool_result";
      toolUseId: string;
      result?: ContextPacket;
      errorMessage?: string;
    }
  | {
      type: "memory_update";
      status: "skipped" | "succeeded" | "failed";
      checkpointIndex?: number;
      response?: MemoryUpdateResponse;
      errorMessage?: string;
    }
  | {
      type: "activity_title";
      title: string;
    }
  | {
      type: "result";
      result: string;
      sessionId?: string;
    }
  | {
      type: "error";
      message: string;
      sessionId?: string;
    }
  | {
      type: "raw";
      messageType: string;
      message: unknown;
    };

export type RunLocalAssistantOptions = {
  prompt: string;
  cwd: string;
  userId: string;
  serverUrl: string;
  authToken?: string;
  projectId?: string;
  anthropicApiKey?: string;
  bootstrap: BootstrapContext;
  chatSessionId?: string;
  conversationMessages?: ConversationMessage[];
  mentionedAgentIds?: string[];
  model?: string;
  retrieverModel?: string;
  maxTurns?: number;
  resumeSessionId?: string;
};

export type PersistedConversation = {
  sessionId: string | null;
  messages: Array<{ id: string; role: 'user' | 'assistant'; text: string }>;
};
