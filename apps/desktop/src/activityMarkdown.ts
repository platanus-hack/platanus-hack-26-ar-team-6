import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export type ActivityToolEntry = {
  toolName: string
  toolUseId?: string
  input?: unknown
}

export type SaveActivityNoteOptions = {
  sessionId: string
  prompt: string
  toolTrace: ActivityToolEntry[]
  displayName: string
  email: string
  projectName: string
  projectFolderPath: string
}

export type ActivityNote = {
  id: string
  date: string
  user: string
  userEmail: string
  project: string
  title: string
  wikilinks: string[]
  filesChanged: string[]
}

const FILE_MODIFYING_TOOLS = /^(Write|Edit|MultiEdit|NotebookEdit|str_replace_based_edit_tool)$/i

function extractTitle(prompt: string): string {
  const firstLine = prompt.split('\n')[0]?.trim() ?? prompt.trim()
  if (firstLine.length <= 60) return firstLine
  const truncated = firstLine.slice(0, 60)
  const lastSpace = truncated.lastIndexOf(' ')
  return lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated
}

function extractChangedFiles(toolTrace: ActivityToolEntry[]): string[] {
  const files = new Set<string>()
  for (const entry of toolTrace) {
    if (!FILE_MODIFYING_TOOLS.test(entry.toolName)) continue
    const input = entry.input as Record<string, unknown> | null
    if (!input) continue
    if (typeof input['path'] === 'string') {
      files.add(input['path'])
    }
  }
  return [...files]
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export async function saveActivityNote(opts: SaveActivityNoteOptions): Promise<void> {
  const { sessionId, prompt, toolTrace, displayName, email, projectName, projectFolderPath } = opts
  const activityDir = join(projectFolderPath, '.relevo', 'activity')
  await mkdir(activityDir, { recursive: true })

  const date = todayIso()
  const title = extractTitle(prompt)
  const changedFiles = extractChangedFiles(toolTrace)
  const userWikilink = `[[users/${displayName}]]`
  const projectWikilink = `[[project/${projectName}]]`

  const frontmatter = [
    '---',
    `id: ${sessionId}`,
    `date: ${date}`,
    `user: ${displayName}`,
    `user_email: ${email}`,
    `project: ${projectName}`,
    '---'
  ].join('\n')

  const filesSection =
    changedFiles.length > 0
      ? `\n## Files changed\n${changedFiles.map((f) => `- ${f}`).join('\n')}`
      : ''

  const body = [
    `# ${title}`,
    filesSection,
    `\n## Links\n${userWikilink}\n${projectWikilink}`
  ].join('\n')

  const content = `${frontmatter}\n\n${body}\n`
  const fileName = `${date}-${sessionId}.md`
  await writeFile(join(activityDir, fileName), content, 'utf-8')
}

function parseFrontmatter(raw: string): Record<string, string> {
  const result: Record<string, string> = {}
  const parts = raw.split(/^---$/m)
  if (parts.length < 3) return result
  const fmBlock = parts[1] ?? ''
  for (const line of fmBlock.split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).trim()
    const value = line.slice(colonIdx + 1).trim()
    if (key) result[key] = value
  }
  return result
}

function extractWikilinks(text: string): string[] {
  const links: string[] = []
  const re = /\[\[([^\]]+)\]\]/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    if (match[1]) links.push(match[1])
  }
  return links
}

function extractTitle_fromBody(raw: string): string {
  const headingMatch = raw.match(/^#\s+(.+)$/m)
  return headingMatch?.[1]?.trim() ?? 'Untitled session'
}

function extractFilesChanged(raw: string): string[] {
  const sectionMatch = raw.match(/^## Files changed\n([\s\S]*?)(?=\n##|\n---|\s*$)/m)
  if (!sectionMatch?.[1]) return []
  return sectionMatch[1]
    .split('\n')
    .map((line) => line.replace(/^-\s*/, '').trim())
    .filter(Boolean)
}

export async function readActivityNotes(projectFolderPath: string): Promise<ActivityNote[]> {
  const activityDir = join(projectFolderPath, '.relevo', 'activity')
  let files: string[]
  try {
    files = await readdir(activityDir)
  } catch {
    return []
  }

  const notes: ActivityNote[] = []
  for (const file of files.filter((f) => f.endsWith('.md'))) {
    try {
      const raw = await readFile(join(activityDir, file), 'utf-8')
      const fm = parseFrontmatter(raw)
      notes.push({
        id: fm['id'] ?? file.replace('.md', ''),
        date: fm['date'] ?? '',
        user: fm['user'] ?? '',
        userEmail: fm['user_email'] ?? '',
        project: fm['project'] ?? '',
        title: extractTitle_fromBody(raw),
        wikilinks: extractWikilinks(raw),
        filesChanged: extractFilesChanged(raw)
      })
    } catch {
      // skip unreadable files
    }
  }
  return notes
}
