import type { BootstrapContext } from "./types.js";

import LOCAL_ASSISTANT_PROMPT from "../../../prompts/local_assistant_system.md?raw";

export async function loadLocalAssistantPrompt(): Promise<string> {
  return LOCAL_ASSISTANT_PROMPT;
}

export async function buildLocalAssistantSystemPrompt(
  bootstrap: BootstrapContext,
): Promise<string> {
  const basePrompt = await loadLocalAssistantPrompt();
  return [
    basePrompt.trim(),
    "",
    "Session bootstrap context:",
    "```json",
    JSON.stringify(bootstrap, null, 2),
    "```",
  ].join("\n");
}
