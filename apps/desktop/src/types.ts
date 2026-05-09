export type RequestContextTarget = string;
export type RequestContextInput = {
  target: string;
  question: string;
};

export type RequestContextCitation = {
  claim?: string;
  context_entry_id?: string;
  [key: string]: unknown;
};

export type RequestContextResponse = {
  answer: string;
  source_user_ids: string[];
  citations: RequestContextCitation[];
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
      result?: RequestContextResponse;
      errorMessage?: string;
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
  anthropicApiKey?: string;
  bootstrap: BootstrapContext;
  model?: string;
  maxTurns?: number;
};
