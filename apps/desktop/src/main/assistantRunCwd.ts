export function resolveAssistantRunCwd(selectedProjectFolderPath?: string | null): string {
  const cwd = selectedProjectFolderPath?.trim()
  if (!cwd) {
    throw new Error('Connect a project folder before running assistant.')
  }
  return cwd
}
