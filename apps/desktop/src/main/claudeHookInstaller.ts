import { app } from 'electron'
import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

type HookCommand = {
  type?: string
  command?: string
  [key: string]: unknown
}

type HookMatcher = {
  hooks?: HookCommand[]
  [key: string]: unknown
}

type ClaudeSettings = {
  hooks?: Record<string, HookMatcher[]>
  [key: string]: unknown
}

type InstallClaudeCodeHookOptions = {
  projectId: string
  projectFolderPath: string
  serverUrl: string
  authToken: string
}

export type ClaudeCodeHookStatus = {
  enabled: boolean
  active: boolean
  installed: boolean
  hasSettings: boolean
  hasHookScript: boolean
  hasConfig: boolean
  message: string
}

const RELEVO_HOOK_SCRIPT_PATH = '.claude/hooks/relevo_activity.py'
const RELEVO_HOOK_NAME = 'relevo_activity.py'

const RELEVO_ACTIVITY_HOOK_SCRIPT = String.raw`#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


DEFAULT_MAX_DIFF_CHARS = 60_000
STATE_DIR = ".relevo/claude-code"
DIFF_EXCLUDES = [
    ":(exclude).env",
    ":(exclude).env.*",
    ":(exclude)**/.env",
    ":(exclude)**/.env.*",
    ":(exclude).relevo/**",
    ":(exclude)**/.relevo/**",
    ":(exclude)secrets/**",
    ":(exclude).secrets/**",
    ":(exclude)**/*.pem",
    ":(exclude)**/*.key",
    ":(exclude)**/*.crt",
    ":(exclude)**/*.p12",
]
SENSITIVE_PARTS = {".git", ".relevo", "secrets", ".secrets", ".anthropic", ".railway"}
SENSITIVE_SUFFIXES = (".pem", ".key", ".crt", ".p12")


def debug(message: str) -> None:
    if os.environ.get("RELEVO_CLAUDE_HOOK_DEBUG"):
        print(f"[relevo-claude-hook] {message}", file=sys.stderr)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--config")
    args, _unknown = parser.parse_known_args()
    return args


def read_config(path: str | None) -> dict[str, Any]:
    if not path:
        return {}
    try:
        data = json.loads(Path(path).read_text("utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        debug(f"could not read config: {exc}")
        return {}
    return data if isinstance(data, dict) else {}


def config_value(config: dict[str, Any], key: str, *env_names: str) -> str:
    value = config.get(key)
    if isinstance(value, str) and value.strip():
        return value.strip()
    for name in env_names:
        env_value = os.environ.get(name, "").strip()
        if env_value:
            return env_value
    return ""


def max_diff_chars() -> int:
    raw = os.environ.get("RELEVO_CLAUDE_HOOK_MAX_DIFF_CHARS", "")
    if not raw:
        return DEFAULT_MAX_DIFF_CHARS
    try:
        return max(1_000, int(raw))
    except ValueError:
        return DEFAULT_MAX_DIFF_CHARS


def read_hook_input() -> dict[str, Any]:
    try:
        data = json.load(sys.stdin)
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def run_git(cwd: str, args: list[str], *, allow_statuses: set[int] | None = None) -> str:
    allowed = allow_statuses or {0}
    try:
        result = subprocess.run(
            ["git", *args],
            cwd=cwd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
        )
    except OSError as exc:
        debug(f"git unavailable: {exc}")
        return ""

    if result.returncode not in allowed:
        debug(f"git {' '.join(args)} failed: {result.stderr.strip()}")
        return ""
    return result.stdout


def git_root(cwd: str) -> str | None:
    output = run_git(cwd, ["rev-parse", "--show-toplevel"])
    root = output.strip()
    return root or None


def git_snapshot_ref(cwd: str) -> str | None:
    snapshot = run_git(cwd, ["stash", "create", "relevo-claude-code-pre-turn"]).strip()
    if snapshot:
        return snapshot

    head = run_git(cwd, ["rev-parse", "--verify", "HEAD"]).strip()
    return head or None


def is_sensitive_path(path: str) -> bool:
    normalized = path.replace("\\", "/").strip("/")
    if not normalized:
        return True
    parts = normalized.split("/")
    if any(part in SENSITIVE_PARTS for part in parts):
        return True
    name = parts[-1] or ""
    return (
        name == ".env"
        or name.startswith(".env.")
        or name.endswith(SENSITIVE_SUFFIXES)
        or name.endswith(".env")
    )


def untracked_files(cwd: str) -> list[str]:
    output = run_git(cwd, ["ls-files", "--others", "--exclude-standard", "--", "."])
    return sorted(
        line.strip()
        for line in output.splitlines()
        if line.strip() and not is_sensitive_path(line.strip())
    )


def tracked_changed_files(cwd: str, base_ref: str | None) -> list[str]:
    if not base_ref:
        return []
    output = run_git(
        cwd,
        ["diff", "--name-only", base_ref, "--", ".", *DIFF_EXCLUDES],
    )
    return sorted(
        line.strip()
        for line in output.splitlines()
        if line.strip() and not is_sensitive_path(line.strip())
    )


def truncate(text: str, limit: int) -> tuple[str, bool]:
    if len(text) <= limit:
        return text, False
    return f"{text[: limit - 33].rstrip()}\n...[truncated by Relevo hook]", True


def new_file_diff(cwd: str, rel_path: str) -> str:
    if is_sensitive_path(rel_path):
        return ""
    full_path = str(Path(cwd, rel_path))
    return run_git(
        cwd,
        ["diff", "--no-ext-diff", "--no-index", "--", os.devnull, full_path],
        allow_statuses={0, 1},
    )


def build_git_diff(
    cwd: str,
    base_ref: str | None,
    untracked_at_prompt: list[str],
) -> tuple[str, list[str], bool]:
    tracked_files = tracked_changed_files(cwd, base_ref)
    current_untracked = set(untracked_files(cwd))
    prior_untracked = set(untracked_at_prompt)
    new_untracked = sorted(current_untracked - prior_untracked)

    diff_parts: list[str] = []
    if base_ref:
        tracked_diff = run_git(
            cwd,
            ["diff", "--no-ext-diff", base_ref, "--", ".", *DIFF_EXCLUDES],
        )
        if tracked_diff.strip():
            diff_parts.append(tracked_diff.rstrip())

    for rel_path in new_untracked:
        file_diff = new_file_diff(cwd, rel_path)
        if file_diff.strip():
            diff_parts.append(file_diff.rstrip())

    diff, was_truncated = truncate("\n\n".join(diff_parts), max_diff_chars())
    changed_files = sorted(set(tracked_files) | set(new_untracked))
    return diff, changed_files, was_truncated


def safe_session_id(data: dict[str, Any]) -> str:
    session_id = str(data.get("session_id") or "").strip()
    if session_id:
        return session_id
    transcript_path = str(data.get("transcript_path") or "").strip()
    if transcript_path:
        return Path(transcript_path).stem
    return "unknown-session"


def state_path(repo_root: str, session_id: str) -> Path:
    safe_name = re.sub(r"[^A-Za-z0-9_.-]+", "_", session_id)[:160] or "unknown-session"
    return Path(repo_root, STATE_DIR, f"{safe_name}.json")


def read_state(repo_root: str, session_id: str) -> dict[str, Any]:
    path = state_path(repo_root, session_id)
    try:
        data = json.loads(path.read_text("utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def write_state(repo_root: str, session_id: str, state: dict[str, Any]) -> None:
    path = state_path(repo_root, session_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"{json.dumps(state, indent=2, sort_keys=True)}\n", "utf-8")


def text_from_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(filter(None, (text_from_content(item) for item in content)))
    if not isinstance(content, dict):
        return ""
    block_type = content.get("type")
    if block_type and block_type not in {"text", "message"}:
        return ""
    if isinstance(content.get("text"), str):
        return content["text"]
    return text_from_content(content.get("content"))


def transcript_entries(transcript_path: str | None) -> list[dict[str, Any]]:
    if not transcript_path:
        return []
    path = Path(transcript_path)
    try:
        lines = path.read_text("utf-8").splitlines()
    except OSError as exc:
        debug(f"could not read transcript: {exc}")
        return []

    entries: list[dict[str, Any]] = []
    for line in lines:
        if not line.strip():
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(entry, dict):
            entries.append(entry)
    return entries


def message_role(entry: dict[str, Any]) -> str:
    message = entry.get("message")
    if isinstance(message, dict) and isinstance(message.get("role"), str):
        return message["role"]
    entry_type = entry.get("type")
    return entry_type if isinstance(entry_type, str) else ""


def entry_text(entry: dict[str, Any]) -> str:
    message = entry.get("message")
    if isinstance(message, dict):
        return text_from_content(message.get("content")).strip()
    return text_from_content(entry.get("content") or entry.get("text")).strip()


def final_assistant_answer(transcript_path: str | None) -> str:
    answer = ""
    for entry in transcript_entries(transcript_path):
        if message_role(entry) == "assistant":
            text = entry_text(entry)
            if text:
                answer = text
    return answer


def last_user_prompt(transcript_path: str | None) -> str:
    prompt = ""
    for entry in transcript_entries(transcript_path):
        if message_role(entry) == "user":
            text = entry_text(entry)
            if text:
                prompt = text
    return prompt


def post_activity(config: dict[str, Any], payload: dict[str, Any]) -> None:
    server_url = config_value(config, "serverUrl", "RELEVO_SERVER_URL", "VITE_API_BASE_URL").rstrip("/")
    auth_token = config_value(config, "authToken", "RELEVO_AUTH_TOKEN", "RELEVO_SESSION_TOKEN")
    project_id = config_value(config, "projectId", "RELEVO_PROJECT_ID")
    if not server_url or not auth_token or not project_id:
        debug("missing serverUrl, authToken, or projectId; skipping post")
        return

    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        f"{server_url}/claude-code/activity",
        data=body,
        headers={
            "authorization": f"Bearer {auth_token}",
            "content-type": "application/json",
            "x-project-id": project_id,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            response.read()
    except urllib.error.HTTPError as exc:
        debug(f"server rejected activity: {exc.code} {exc.read().decode('utf-8', 'replace')}")
    except OSError as exc:
        debug(f"could not post activity: {exc}")


def handle_prompt_submit(data: dict[str, Any], repo_root: str, session_id: str) -> None:
    state = read_state(repo_root, session_id)
    checkpoint_index = int(state.get("checkpoint_index") or 0) + 1
    state.update(
        {
            "session_id": session_id,
            "cwd": repo_root,
            "prompt": str(data.get("prompt") or ""),
            "base_ref": git_snapshot_ref(repo_root),
            "untracked_at_prompt": untracked_files(repo_root),
            "checkpoint_index": checkpoint_index,
        }
    )
    write_state(repo_root, session_id, state)


def handle_stop(config: dict[str, Any], data: dict[str, Any], repo_root: str, session_id: str) -> None:
    state = read_state(repo_root, session_id)
    transcript_path = str(data.get("transcript_path") or "")
    prompt = str(state.get("prompt") or "") or last_user_prompt(transcript_path)
    answer = final_assistant_answer(transcript_path)
    diff, changed_files, diff_truncated = build_git_diff(
        repo_root,
        str(state.get("base_ref") or "") or None,
        list(state.get("untracked_at_prompt") or []),
    )

    if not changed_files and not diff.strip():
        debug("no file changes detected; skipping post")
        return

    post_activity(
        config,
        {
            "session_id": session_id,
            "checkpoint_index": int(state.get("checkpoint_index") or 1),
            "cwd": repo_root,
            "prompt": prompt,
            "final_answer": answer,
            "diff": diff,
            "changed_files": changed_files,
            "transcript_path": transcript_path or None,
            "hook_event_name": str(data.get("hook_event_name") or ""),
            "metadata": {
                "diff_truncated": diff_truncated,
                "base_ref": state.get("base_ref"),
            },
        },
    )


def main() -> int:
    args = parse_args()
    config = read_config(args.config)
    data = read_hook_input()
    cwd = str(data.get("cwd") or os.getcwd())
    repo_root = git_root(cwd)
    if not repo_root:
        debug("not inside a git repository; skipping")
        return 0

    session_id = safe_session_id(data)
    event = str(data.get("hook_event_name") or "")
    try:
        if event == "UserPromptSubmit":
            handle_prompt_submit(data, repo_root, session_id)
        elif event == "Stop":
            handle_stop(config, data, repo_root, session_id)
    except Exception as exc:
        debug(f"unexpected hook error: {exc}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
`

function claudeSettingsPath(projectFolderPath: string): string {
  return join(projectFolderPath, '.claude', 'settings.json')
}

function claudeHookScriptPath(projectFolderPath: string): string {
  return join(projectFolderPath, RELEVO_HOOK_SCRIPT_PATH)
}

function hookConfigPath(projectId: string): string {
  return join(app.getPath('userData'), 'claude-hooks', `${projectId}.json`)
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

async function readClaudeSettings(settingsPath: string): Promise<ClaudeSettings> {
  try {
    const raw = await readFile(settingsPath, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as ClaudeSettings) : {}
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return {}
    }
    if (error instanceof SyntaxError) {
      await writeFile(`${settingsPath}.relevo-backup-${Date.now()}`, await readFile(settingsPath, 'utf-8'), 'utf-8')
      return {}
    }
    throw error
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path)
    return true
  } catch {
    return false
  }
}

function hookCommandIsRelevo(hook: HookCommand): boolean {
  return hook.type === 'command' && Boolean(hook.command?.includes(RELEVO_HOOK_NAME))
}

function eventHasRelevoHook(settings: ClaudeSettings, eventName: string): boolean {
  const matchers = settings.hooks?.[eventName]
  if (!Array.isArray(matchers)) return false
  return matchers.some((matcher) => Array.isArray(matcher.hooks) && matcher.hooks.some(hookCommandIsRelevo))
}

function matcherHasOnlyEmptyRelevoScaffold(matcher: HookMatcher): boolean {
  const nonHookKeys = Object.keys(matcher).filter((key) => key !== 'hooks')
  if (nonHookKeys.length === 0) return true
  return nonHookKeys.length === 1 && nonHookKeys[0] === 'matcher' && !matcher.matcher
}

function withoutRelevoHook(settings: ClaudeSettings): ClaudeSettings {
  const hooks = { ...(settings.hooks ?? {}) }
  for (const eventName of ['UserPromptSubmit', 'Stop']) {
    const existingMatchers = Array.isArray(hooks[eventName]) ? hooks[eventName] : []
    const nextMatchers: HookMatcher[] = existingMatchers
      .map((matcher) => ({
        ...matcher,
        hooks: Array.isArray(matcher.hooks) ? matcher.hooks.filter((hook) => !hookCommandIsRelevo(hook)) : []
      }))
      .filter((matcher) => (matcher.hooks?.length ?? 0) > 0 || !matcherHasOnlyEmptyRelevoScaffold(matcher))
    if (nextMatchers.length > 0) {
      hooks[eventName] = nextMatchers
    } else {
      delete hooks[eventName]
    }
  }
  return { ...settings, hooks }
}

function withRelevoHook(settings: ClaudeSettings, command: string): ClaudeSettings {
  const nextSettings = withoutRelevoHook(settings)
  const hooks = { ...(nextSettings.hooks ?? {}) }
  for (const eventName of ['UserPromptSubmit', 'Stop']) {
    const nextMatchers: HookMatcher[] = Array.isArray(hooks[eventName]) ? hooks[eventName] : []
    nextMatchers.push({
      matcher: '',
      hooks: [{ type: 'command', command }]
    })
    hooks[eventName] = nextMatchers
  }
  return { ...nextSettings, hooks }
}

async function writePrivateConfig(path: string, data: Record<string, string>): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 })
  await chmod(path, 0o600).catch(() => undefined)
}

export async function installClaudeCodeHook(options: InstallClaudeCodeHookOptions): Promise<void> {
  const configPath = hookConfigPath(options.projectId)
  const command = `python3 ${RELEVO_HOOK_SCRIPT_PATH} --config ${shellQuote(configPath)}`
  const settingsPath = claudeSettingsPath(options.projectFolderPath)
  const scriptPath = claudeHookScriptPath(options.projectFolderPath)

  await writePrivateConfig(configPath, {
    serverUrl: options.serverUrl,
    authToken: options.authToken,
    projectId: options.projectId
  })

  await mkdir(dirname(scriptPath), { recursive: true })
  await writeFile(scriptPath, RELEVO_ACTIVITY_HOOK_SCRIPT, { encoding: 'utf-8', mode: 0o755 })
  await chmod(scriptPath, 0o755).catch(() => undefined)

  const settings = await readClaudeSettings(settingsPath)
  const nextSettings = withRelevoHook(settings, command)
  await mkdir(dirname(settingsPath), { recursive: true })
  await writeFile(settingsPath, `${JSON.stringify(nextSettings, null, 2)}\n`, 'utf-8')
}

export async function removeClaudeCodeHook(projectFolderPath: string): Promise<void> {
  const settingsPath = claudeSettingsPath(projectFolderPath)
  if (!(await fileExists(settingsPath))) {
    return
  }
  const settings = await readClaudeSettings(settingsPath)
  const nextSettings = withoutRelevoHook(settings)
  await mkdir(dirname(settingsPath), { recursive: true })
  await writeFile(settingsPath, `${JSON.stringify(nextSettings, null, 2)}\n`, 'utf-8')
}

export async function removeClaudeCodeHookConfig(projectId: string): Promise<void> {
  await unlink(hookConfigPath(projectId)).catch(() => undefined)
}

export async function getClaudeCodeHookStatus(
  projectFolderPath: string | null,
  projectId: string | null,
  enabled: boolean
): Promise<ClaudeCodeHookStatus> {
  if (!projectFolderPath || !projectId) {
    return {
      enabled,
      active: false,
      installed: false,
      hasSettings: false,
      hasHookScript: false,
      hasConfig: false,
      message: 'Connect a project folder to use Claude Code hooks.'
    }
  }

  const settingsPath = claudeSettingsPath(projectFolderPath)
  const scriptPath = claudeHookScriptPath(projectFolderPath)
  const configPath = hookConfigPath(projectId)
  const hasSettings = await fileExists(settingsPath)
  const hasHookScript = await fileExists(scriptPath)
  const hasConfig = await fileExists(configPath)
  const settings = hasSettings ? await readClaudeSettings(settingsPath) : {}
  const hasHookCommands = eventHasRelevoHook(settings, 'UserPromptSubmit') && eventHasRelevoHook(settings, 'Stop')
  const installed = hasHookCommands && hasHookScript && hasConfig
  const active = enabled && installed

  let message = 'Claude Code hook is active for this project folder.'
  if (!enabled) {
    message = 'Claude Code hook tracking is disabled.'
  } else if (!installed) {
    message = 'Claude Code hook is not installed for this project folder.'
  }

  return {
    enabled,
    active,
    installed,
    hasSettings,
    hasHookScript,
    hasConfig,
    message
  }
}
