import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import Sidebar, { type SidebarAgent } from './components/Sidebar'
import Tabs, { type TabKey } from './components/Tabs'
import TopBar from './components/TopBar'
import agents from './fixtures/agents.json'
import useWorkspaceStore from './stores/workspaceStore'
import ChatView from './views/ChatView'
import PoolView from './views/PoolView'
import TasksView from './views/TasksView'
import TimelineView from './views/TimelineView'

type BootstrapResponse = Awaited<ReturnType<typeof window.api.getBootstrap>>

type RunnerBootstrapPayload = {
  user_summary: BootstrapResponse['user']
  project_context: {
    project: BootstrapResponse['project']
    roster: BootstrapResponse['roster']
    recent_entries: BootstrapResponse['recent_entries']
    project_context: BootstrapResponse['project_context']
  }
}

const fixtureRoster: SidebarAgent[] = (agents as Array<{ id: string; display_name: string; domain?: { primary?: string } }>).map(
  (agent) => ({
    id: agent.id,
    display_name: agent.display_name,
    domain_summary: agent.domain?.primary ?? 'team member'
  })
)

function App(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<TabKey>('chat')
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'https://platanus-hack-26-ar-team-6-production-75c7.up.railway.app'
  const authToken = import.meta.env.VITE_AUTH_TOKEN || ''
  const userId = import.meta.env.VITE_USER_ID || 'user1'
  const workspaces = useWorkspaceStore((state) => state.workspaces)
  const currentWorkspaceId = useWorkspaceStore((state) => state.currentWorkspaceId)
  const goHome = useWorkspaceStore((state) => state.goHome)

  const bootstrapQuery = useQuery({
    queryKey: ['bootstrap', apiBaseUrl, authToken, userId],
    enabled: authToken.trim().length > 0,
    queryFn: (): Promise<BootstrapResponse> => window.api.getBootstrap({ apiBaseUrl, authToken, userId })
  })

  const workspaceName =
    workspaces.find((workspace) => workspace.id === currentWorkspaceId)?.name ?? bootstrapQuery.data?.project?.name ?? 'main'
  const bootstrapStatus: 'live' | 'fallback' = bootstrapQuery.data ? 'live' : 'fallback'
  const bootstrapError =
    bootstrapQuery.error instanceof Error ? `bootstrap failed: ${bootstrapQuery.error.message}` : null
  const roster: SidebarAgent[] =
    bootstrapQuery.data?.roster.map((user) => ({
      id: user.id,
      display_name: user.display_name,
      domain_summary: user.domain_summary
    })) ?? fixtureRoster

  const runnerBootstrap: RunnerBootstrapPayload = bootstrapQuery.data
    ? {
        user_summary: bootstrapQuery.data.user,
        project_context: {
          project: bootstrapQuery.data.project,
          roster: bootstrapQuery.data.roster,
          recent_entries: bootstrapQuery.data.recent_entries,
          project_context: bootstrapQuery.data.project_context
        }
      }
    : {
        user_summary: {
          id: userId,
          display_name: userId,
          domain_summary: 'local desktop user',
          profile: {}
        },
        project_context: {
          project: {
            id: 'fixture-project',
            name: 'main',
            description: 'fixture fallback project'
          },
          roster: fixtureRoster.map((agent) => ({
            id: agent.id,
            display_name: agent.display_name,
            domain_summary: agent.domain_summary || 'team member',
            profile: {}
          })),
          recent_entries: [],
          project_context: []
        }
      }

  let activeView: React.JSX.Element = (
    <ChatView
      apiBaseUrl={apiBaseUrl}
      authToken={authToken}
      bootstrap={runnerBootstrap}
    />
  )

  if (activeTab === 'pool') {
    activeView = <PoolView />
  } else if (activeTab === 'timeline') {
    activeView = <TimelineView />
  } else if (activeTab === 'tasks') {
    activeView = <TasksView />
  }

  return (
    <div className="app-shell">
      <TopBar workspaceName={workspaceName} onBack={goHome} bootstrapStatus={bootstrapStatus} />

      <div className="app-body">
        <Sidebar agents={roster} currentUserId={userId} />

        <main className="main-pane">
          {bootstrapError && <div className="content-status">{bootstrapError}</div>}
          <Tabs activeTab={activeTab} onTabChange={setActiveTab} />
          {activeView}
        </main>
      </div>
    </div>
  )
}

export default App
