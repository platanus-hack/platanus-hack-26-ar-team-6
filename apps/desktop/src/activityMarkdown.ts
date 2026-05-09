import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'

export type ActivityToolEntry = {
  toolName: string
  toolUseId?: string
  input?: unknown
}

export type SaveActivityNoteOptions = {
  sessionId: string
  prompt: string
  finalAnswer?: string
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
  summary: string
  request: string
  wikilinks: string[]
  filesChanged: string[]
  toolsUsed: string[]
  createdAt: string
}

const FILE_MODIFYING_TOOLS = /^(Write|Edit|MultiEdit|NotebookEdit|str_replace_based_edit_tool)$/i
const FILE_INPUT_KEYS = ['path', 'file_path', 'notebook_path']
const TITLE_STOP_WORDS = new Set([
  'a',
  'about',
  'again',
  'all',
  'also',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'built',
  'can',
  'could',
  'do',
  'does',
  'dont',
  'find',
  'for',
  'from',
  'general',
  'get',
  'give',
  'have',
  'help',
  'how',
  'i',
  'in',
  'is',
  'it',
  'just',
  'look',
  'lot',
  'make',
  'me',
  'more',
  'my',
  'nice',
  'nicer',
  'of',
  'on',
  'or',
  'please',
  'put',
  'select',
  'selected',
  'so',
  'that',
  'the',
  'this',
  'to',
  'want',
  'way',
  'we',
  'when',
  'with',
  'you'
])

const TITLE_ACTION_WORDS = new Set([
  'add',
  'added',
  'adjust',
  'adjusted',
  'build',
  'change',
  'changed',
  'create',
  'created',
  'fix',
  'fixed',
  'implement',
  'implemented',
  'improve',
  'improved',
  'investigate',
  'investigated',
  'refactor',
  'refactored',
  'rework',
  'reworked',
  'update',
  'updated',
  'work',
  'worked'
])

const TITLE_ACRONYMS = new Set([
  'API',
  'CSS',
  'DB',
  'HTML',
  'ID',
  'IPC',
  'JSON',
  'MCP',
  'QA',
  'SQL',
  'SVG',
  'UI',
  'URL',
  'UX',
  'YAML'
])

function compactLine(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  const truncated = normalized.slice(0, maxLength)
  const lastSpace = truncated.lastIndexOf(' ')
  return `${(lastSpace > maxLength * 0.55 ? truncated.slice(0, lastSpace) : truncated).trim()}...`
}

function stripMarkdownPrefix(line: string): string {
  return line
    .replace(/^#+\s*/, '')
    .replace(/^[-*]\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .trim()
}

function extractSummary(finalAnswer?: string): string {
  if (!finalAnswer) return ''
  const firstUsefulLine = finalAnswer
    .split('\n')
    .map(stripMarkdownPrefix)
    .find((line) => line.length > 0)
  return firstUsefulLine ? compactLine(firstUsefulLine, 220) : ''
}

function normalizeChangedFile(filePath: string, projectFolderPath: string): string {
  if (!isAbsolute(filePath)) return filePath
  const rel = relative(projectFolderPath, filePath)
  if (rel && !rel.startsWith('..') && !rel.startsWith('/')) return rel
  return filePath
}

function extractChangedFiles(toolTrace: ActivityToolEntry[], projectFolderPath: string): string[] {
  const files = new Set<string>()
  for (const entry of toolTrace) {
    if (!FILE_MODIFYING_TOOLS.test(entry.toolName)) continue
    const input = entry.input as Record<string, unknown> | null
    if (!input) continue
    for (const key of FILE_INPUT_KEYS) {
      if (typeof input[key] === 'string') {
        files.add(normalizeChangedFile(input[key], projectFolderPath))
      }
    }
  }
  return [...files]
}

function extractToolsUsed(toolTrace: ActivityToolEntry[]): string[] {
  return [...new Set(toolTrace.map((entry) => entry.toolName).filter(Boolean))]
}

function humanizePath(filePath: string): string {
  const filename = filePath.split(/[\\/]/).pop() ?? filePath
  const withoutExt = filename.replace(/\.[^.]+$/, '')
  return withoutExt
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function describeChangedFiles(files: string[]): string {
  if (files.length === 0) return ''
  const labels = [...new Set(files.map(humanizePath))]
  if (labels.length === 1) return labels[0]!
  return `${labels[0]} + ${labels.length - 1} file${labels.length === 2 ? '' : 's'}`
}

function cleanTitleSource(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[[^\]]+\]\([^)]+\)/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/['’]/g, '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function titleCaseWord(word: string): string {
  const upper = word.toUpperCase()
  if (TITLE_ACRONYMS.has(upper)) return upper
  if (/^[A-Z0-9]{2,}$/.test(word)) return word
  return `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`
}

function titleWordsFromText(text: string, maxWords = 5): string[] {
  const words: string[] = []
  for (const rawWord of cleanTitleSource(text).split(' ')) {
    const lower = rawWord.toLowerCase()
    if (!lower || lower.length < 2) continue
    if (/^\d+$/.test(lower)) continue
    if (TITLE_STOP_WORDS.has(lower)) continue
    if (TITLE_ACTION_WORDS.has(lower)) continue
    const displayWord = lower === 'nodes' ? 'Node' : titleCaseWord(rawWord)
    if (words.some((word) => word.toLowerCase() === displayWord.toLowerCase())) continue
    words.push(displayWord)
    if (words.length >= maxWords) break
  }
  return words
}

function normalizeTitleWords(words: string[]): string[] {
  const lower = new Set(words.map((word) => word.toLowerCase()))
  if (lower.has('timeline') && lower.has('graph') && lower.has('node') && lower.has('titles')) {
    return ['Timeline', 'Graph', 'Node', 'Titles']
  }
  if (lower.has('activity') && lower.has('graph') && lower.has('node') && lower.has('titles')) {
    return ['Activity', 'Graph', 'Node', 'Titles']
  }
  return words
}

function titlePhraseFromText(text: string): string {
  const words = normalizeTitleWords(titleWordsFromText(text))
  return words.join(' ')
}

function buildActivityTitle(prompt: string, filesChanged: string[], summary: string): string {
  const phrase = titlePhraseFromText(`${prompt}\n${summary}`)
  if (phrase) return compactLine(phrase, 80)
  const fileScope = describeChangedFiles(filesChanged)
  if (fileScope) return compactLine(fileScope, 80)
  return 'Untitled session'
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export async function saveActivityNote(opts: SaveActivityNoteOptions): Promise<void> {
  const { sessionId, prompt, finalAnswer, toolTrace, displayName, email, projectName, projectFolderPath } = opts
  const activityDir = join(projectFolderPath, '.relevo', 'activity')
  await mkdir(activityDir, { recursive: true })

  const createdAt = new Date().toISOString()
  const date = todayIso()
  const summary = extractSummary(finalAnswer)
  const changedFiles = extractChangedFiles(toolTrace, projectFolderPath)
  const toolsUsed = extractToolsUsed(toolTrace)
  const title = buildActivityTitle(prompt, changedFiles, summary)
  const userWikilink = `[[users/${displayName}]]`
  const projectWikilink = `[[project/${projectName}]]`

  const frontmatter = [
    '---',
    `id: ${sessionId}`,
    `date: ${date}`,
    `created_at: ${createdAt}`,
    `user: ${displayName}`,
    `user_email: ${email}`,
    `project: ${projectName}`,
    '---'
  ].join('\n')

  const filesSection =
    changedFiles.length > 0
      ? `\n## Files changed\n${changedFiles.map((f) => `- ${f}`).join('\n')}`
      : ''

  const toolsSection =
    toolsUsed.length > 0
      ? `\n## Tools used\n${toolsUsed.map((tool) => `- ${tool}`).join('\n')}`
      : ''

  const summarySection = summary ? `\n## Summary\n${summary}` : ''

  const body = [
    `# ${title}`,
    `\n## Request\n${prompt.trim() || 'No request captured.'}`,
    summarySection,
    filesSection,
    toolsSection,
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
  return extractListSection(raw, 'Files changed')
}

function extractListSection(raw: string, heading: string): string[] {
  const content = extractSection(raw, heading)
  if (!content) return []
  return content
    .split('\n')
    .map((line) => line.replace(/^-\s*/, '').trim())
    .filter(Boolean)
}

function extractSection(raw: string, heading: string): string {
  const marker = `## ${heading}`
  const start = raw.indexOf(marker)
  if (start === -1) return ''
  const contentStart = raw.indexOf('\n', start)
  if (contentStart === -1) return ''
  const afterHeading = raw.slice(contentStart + 1)
  const nextHeading = afterHeading.search(/\n##\s+/)
  return (nextHeading === -1 ? afterHeading : afterHeading.slice(0, nextHeading)).trim()
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
        summary: extractSection(raw, 'Summary'),
        request: extractSection(raw, 'Request'),
        wikilinks: extractWikilinks(raw),
        filesChanged: extractFilesChanged(raw),
        toolsUsed: extractListSection(raw, 'Tools used'),
        createdAt: fm['created_at'] ?? fm['date'] ?? ''
      })
    } catch {
      // skip unreadable files
    }
  }
  return notes.sort((a, b) => (a.createdAt || a.date).localeCompare(b.createdAt || b.date))
}
