import { runLocalAssistant } from "../src/index.js";

async function main(): Promise<void> {
  const hasClaudeAuth = Boolean(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN);

  if (!hasClaudeAuth) {
    console.log("SKIP: ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN is required for the live local runner smoke.");
    return;
  }

  const cwd = process.argv[2] ?? process.env.RELEVO_RUNNER_CWD ?? process.cwd();
  const serverUrl = process.env.RELEVO_SERVER_URL ?? "http://localhost:8000";
  const userId = process.env.RELEVO_USER_ID ?? "user1";

  for await (const event of runLocalAssistant({
    prompt: "Reply with exactly: relevo runner ok",
    cwd,
    userId,
    serverUrl,
    authToken: process.env.RELEVO_AUTH_TOKEN,
    maxTurns: 1,
    bootstrap: {
      user_summary: {
        display_name: "Smoke user",
        summary: "Live smoke run for local assistant startup.",
      },
      project_context: {
        roster: [
          {
            user_id: userId,
            display_name: "Smoke user",
            owns: "Local runner startup and request-context tool registration.",
          },
        ],
      },
    },
  })) {
    if (event.type === "assistant_text") {
      process.stdout.write(event.text);
    } else if (event.type === "result") {
      process.stdout.write("\n");
      console.log(`result: ${event.result}`);
    } else if (event.type === "error") {
      console.error(event.message);
      process.exitCode = 1;
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
