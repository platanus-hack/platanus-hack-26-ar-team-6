import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { BootstrapContext } from "./types.js";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(MODULE_DIR, "../../..");
const LOCAL_ASSISTANT_PROMPT = resolve(REPO_ROOT, "prompts/local_assistant_system.md");

export async function loadLocalAssistantPrompt(): Promise<string> {
  return readFile(LOCAL_ASSISTANT_PROMPT, "utf-8");
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
