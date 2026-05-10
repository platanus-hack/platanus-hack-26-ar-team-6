type RosterMember = {
  id: string
  display_name: string
  domain_summary?: string | null
}

type ApprovedTask = {
  id: string
  title: string
  priority: 'high' | 'medium' | 'low'
  status: 'open' | 'in progress' | 'done'
  context: string
  approvedAt: string
  ownerId: string
  ownerDisplayName: string
}

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
}

type ChatHistoryEntry = {
  id: string
  title: string
  savedAt: string
  sessionId: string | null
  messages: ChatMessage[]
}

type PersistedConversation = {
  sessionId: string | null
  messages: ChatMessage[]
}

type StorageLike = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

type ConversationStore = {
  loadConversation: (workspaceId: string) => Promise<PersistedConversation>
  saveConversation: (workspaceId: string, data: PersistedConversation) => Promise<void>
}

export type RailwaywiseDemoHydrationResult = {
  tasksWritten: boolean
  historyWritten: boolean
  activeConversationWritten: boolean
}

type TaskTemplate = {
  id: string
  title: string
  priority: ApprovedTask['priority']
  status: ApprovedTask['status']
  context: string
  ownerHints: string[]
}

const TASKS_STORAGE_PREFIX = 'relevo:tasks:v3:'
const CHAT_HISTORY_STORAGE_PREFIX = 'omni:chat-history:'
const DEMO_BASE_TIME = '2026-05-10T13:00:00.000Z'

const TASK_TEMPLATES: TaskTemplate[] = [
  {
    id: 'rw-task-01',
    title: 'Validate delay classifier thresholds',
    priority: 'high',
    status: 'in progress',
    context: 'False positive delay alerts are still noisy for the San Martin morning run.',
    ownerHints: ['data', 'ml', 'model', 'analytics']
  },
  {
    id: 'rw-task-02',
    title: 'Publish crew handoff checklist',
    priority: 'high',
    status: 'open',
    context: 'Operations needs a one-page handoff before adding the second dispatcher shift.',
    ownerHints: ['ops', 'operation', 'dispatch']
  },
  {
    id: 'rw-task-03',
    title: 'Wire incident feed retries',
    priority: 'high',
    status: 'open',
    context: 'The Belgrano Norte incident feed can drop webhooks during peak update bursts.',
    ownerHints: ['backend', 'api', 'platform']
  },
  {
    id: 'rw-task-04',
    title: 'Review station board contrast',
    priority: 'medium',
    status: 'done',
    context: 'Field testers flagged low contrast on platform tablets in outdoor light.',
    ownerHints: ['design', 'frontend', 'ui']
  },
  {
    id: 'rw-task-05',
    title: 'Confirm Retiro geofence radius',
    priority: 'medium',
    status: 'in progress',
    context: 'Arrival confidence changes materially when trains stack outside Retiro.',
    ownerHints: ['mobile', 'geo', 'field']
  },
  {
    id: 'rw-task-06',
    title: 'Reconcile maintenance outage imports',
    priority: 'high',
    status: 'open',
    context: 'Two outage windows from the maintenance spreadsheet overlap with published service.',
    ownerHints: ['data', 'integration', 'backend']
  },
  {
    id: 'rw-task-07',
    title: 'Draft passenger disruption copy',
    priority: 'medium',
    status: 'open',
    context: 'The comms team wants calmer wording for cascading delay notifications.',
    ownerHints: ['content', 'comms', 'product']
  },
  {
    id: 'rw-task-08',
    title: 'Add audit trail filters',
    priority: 'medium',
    status: 'in progress',
    context: 'Supervisors need to separate automatic recommendations from manual overrides.',
    ownerHints: ['frontend', 'ui', 'product']
  },
  {
    id: 'rw-task-09',
    title: 'Load-test live map fanout',
    priority: 'high',
    status: 'open',
    context: 'The demo route map should stay responsive with every stakeholder watching.',
    ownerHints: ['infra', 'platform', 'backend']
  },
  {
    id: 'rw-task-10',
    title: 'Close Mitre branch data gap',
    priority: 'medium',
    status: 'done',
    context: 'Historical headway data is missing for three afternoon trips on the Mitre branch.',
    ownerHints: ['data', 'analytics']
  },
  {
    id: 'rw-task-11',
    title: 'Test dispatcher escalation path',
    priority: 'high',
    status: 'in progress',
    context: 'Critical incidents must page the on-call coordinator within two minutes.',
    ownerHints: ['ops', 'qa', 'support']
  },
  {
    id: 'rw-task-12',
    title: 'Document simulation seed reset',
    priority: 'low',
    status: 'open',
    context: 'The demo team needs a quick reset path if rehearsal data gets messy.',
    ownerHints: ['docs', 'devops', 'infra']
  },
  {
    id: 'rw-task-13',
    title: 'Tune dwell-time anomaly cards',
    priority: 'medium',
    status: 'open',
    context: 'Station managers asked for fewer cards and clearer next actions.',
    ownerHints: ['product', 'design', 'analytics']
  },
  {
    id: 'rw-task-14',
    title: 'Verify SMS fallback numbers',
    priority: 'medium',
    status: 'done',
    context: 'Emergency notifications should still reach supervisors when push delivery fails.',
    ownerHints: ['ops', 'backend', 'support']
  },
  {
    id: 'rw-task-15',
    title: 'Patch train consist parser',
    priority: 'high',
    status: 'open',
    context: 'A malformed consist entry is blocking capacity estimates for two lines.',
    ownerHints: ['backend', 'data', 'integration']
  },
  {
    id: 'rw-task-16',
    title: 'Prepare demo recovery script',
    priority: 'low',
    status: 'open',
    context: 'The team needs one reliable script to restore the Railwaywise walkthrough state.',
    ownerHints: ['infra', 'devops', 'demo']
  },
  {
    id: 'rw-task-17',
    title: 'Summarize stakeholder decisions',
    priority: 'medium',
    status: 'in progress',
    context: 'Friday decisions about alert ownership should be visible before the next review.',
    ownerHints: ['product', 'pm', 'lead']
  }
]

function tasksStorageKey(projectId: string): string {
  return `${TASKS_STORAGE_PREFIX}${projectId}`
}

function chatHistoryStorageKey(projectId: string): string {
  return `${CHAT_HISTORY_STORAGE_PREFIX}${projectId}`
}

function normalizedText(value: string | null | undefined): string {
  return (value ?? '').toLowerCase()
}

function findOwner(roster: RosterMember[], hints: string[], index: number): RosterMember {
  if (roster.length === 0) {
    return { id: 'railwaywise-demo-owner', display_name: 'Railwaywise team', domain_summary: 'Demo team' }
  }

  const hinted = roster.find((member) => {
    const searchable = `${normalizedText(member.display_name)} ${normalizedText(member.domain_summary)}`
    return hints.some((hint) => searchable.includes(hint))
  })

  return hinted ?? roster[index % roster.length]
}

function buildApprovedTasks(roster: RosterMember[]): ApprovedTask[] {
  return TASK_TEMPLATES.map((template, index) => {
    const owner = findOwner(roster, template.ownerHints, index)
    return {
      id: template.id,
      title: template.title,
      priority: template.priority,
      status: template.status,
      context: template.context,
      approvedAt: new Date(Date.parse(DEMO_BASE_TIME) + index * 60_000).toISOString(),
      ownerId: owner.id,
      ownerDisplayName: owner.display_name
    }
  })
}

function mention(member: RosterMember | undefined): string {
  return member ? `@${member.display_name}` : '@team'
}

function buildActiveConversation(roster: RosterMember[]): PersistedConversation {
  const primary = roster[0]
  const secondary = roster[1]
  return {
    sessionId: 'railwaywise-demo-active',
    messages: [
      {
        id: 'rw-active-01',
        role: 'user',
        text: `What should I check before the Railwaywise operations review, especially with ${mention(primary)} and ${mention(secondary)}?`
      },
      {
        id: 'rw-active-02',
        role: 'assistant',
        text: 'Start with the delay classifier threshold change, the incident feed retry gap, and the dispatcher escalation path. Those three items connect the most demo risk across data, backend, and operations.'
      },
      {
        id: 'rw-active-03',
        role: 'user',
        text: 'Turn that into a crisp plan for the next hour.'
      },
      {
        id: 'rw-active-04',
        role: 'assistant',
        text: 'First, confirm the live map can tolerate the review audience. Second, ask the data owner to validate the San Martin threshold sample. Third, have operations walk through the escalation path with the latest passenger disruption copy open.'
      }
    ]
  }
}

function buildArchivedChats(roster: RosterMember[]): ChatHistoryEntry[] {
  const primary = roster[0]
  const secondary = roster[1]
  const tertiary = roster[2]
  return [
    {
      id: 'rw-archive-01',
      title: 'Incident feed retry plan',
      savedAt: '2026-05-10T12:30:00.000Z',
      sessionId: 'railwaywise-demo-archive-01',
      messages: [
        {
          id: 'rw-archive-01-user',
          role: 'user',
          text: `Ask ${mention(primary)} what can fail if the incident feed drops a webhook.`
        },
        {
          id: 'rw-archive-01-assistant',
          role: 'assistant',
          text: 'The risky path is duplicate suppression after a retry. Keep the retry idempotent, log the original incident id, and surface any event older than five minutes as stale.'
        }
      ]
    },
    {
      id: 'rw-archive-02',
      title: 'Passenger copy review',
      savedAt: '2026-05-10T11:45:00.000Z',
      sessionId: 'railwaywise-demo-archive-02',
      messages: [
        {
          id: 'rw-archive-02-user',
          role: 'user',
          text: `Compare the disruption copy with ${mention(secondary)}'s latest checklist.`
        },
        {
          id: 'rw-archive-02-assistant',
          role: 'assistant',
          text: 'The checklist asks for specific line, direction, estimated delay, and next update time. The current copy has the line and delay, but needs a clearer next update promise.'
        }
      ]
    },
    {
      id: 'rw-archive-03',
      title: 'Live map rehearsal notes',
      savedAt: '2026-05-10T10:55:00.000Z',
      sessionId: 'railwaywise-demo-archive-03',
      messages: [
        {
          id: 'rw-archive-03-user',
          role: 'user',
          text: `What did ${mention(tertiary)} flag in the map rehearsal?`
        },
        {
          id: 'rw-archive-03-assistant',
          role: 'assistant',
          text: 'The map stayed readable, but fanout needs a load-test pass and Retiro arrivals need a slightly wider geofence to avoid jitter near the terminal.'
        }
      ]
    }
  ]
}

export function isRailwaywiseDemoProject(projectName: string | null | undefined): boolean {
  return normalizedText(projectName).includes('railwaywise')
}

export function isMissingRailwaywiseDemoEndpointError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('404') && message.toLowerCase().includes('not found')
}

export function resolveRailwaywiseProjectId(
  responseBody: unknown,
  projects: Array<{ project_id: string; project_name: string }>
): string {
  const body = responseBody && typeof responseBody === 'object' ? (responseBody as Record<string, unknown>) : {}
  const candidates = [
    body.project_id,
    body.selected_project_id,
    body.project && typeof body.project === 'object' ? (body.project as Record<string, unknown>).project_id : undefined,
    body.project && typeof body.project === 'object' ? (body.project as Record<string, unknown>).id : undefined
  ]
  const fromResponse = candidates.find((value): value is string => typeof value === 'string' && value.trim().length > 0)
  if (fromResponse && projects.some((project) => project.project_id === fromResponse)) {
    return fromResponse
  }

  const byName = projects.find((project) => isRailwaywiseDemoProject(project.project_name))
  if (byName) {
    return byName.project_id
  }

  throw new Error('Railwaywise demo project was not returned by the server.')
}

export async function hydrateRailwaywiseDemoLocalData({
  projectId,
  roster,
  storage,
  conversationStore
}: {
  projectId: string
  roster: RosterMember[]
  storage: StorageLike
  conversationStore: ConversationStore
}): Promise<RailwaywiseDemoHydrationResult> {
  const tasksKey = tasksStorageKey(projectId)
  const historyKey = chatHistoryStorageKey(projectId)
  let tasksWritten = false
  let historyWritten = false
  let activeConversationWritten = false

  if (storage.getItem(tasksKey) === null) {
    storage.setItem(tasksKey, JSON.stringify({ approved: buildApprovedTasks(roster) }))
    tasksWritten = true
  }

  if (storage.getItem(historyKey) === null) {
    storage.setItem(historyKey, JSON.stringify(buildArchivedChats(roster)))
    historyWritten = true
  }

  const existingConversation = await conversationStore.loadConversation(projectId)
  if (existingConversation.messages.length === 0) {
    await conversationStore.saveConversation(projectId, buildActiveConversation(roster))
    activeConversationWritten = true
  }

  return {
    tasksWritten,
    historyWritten,
    activeConversationWritten
  }
}
