import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import Sidebar, { type SidebarAgent } from './components/Sidebar'
import SettingsPanel from './components/SettingsPanel'
import type { TabKey } from './components/Tabs'
import TopBar from './components/TopBar'
import { getProjectFolderDisplayName } from './projectFolders'
import ChatView from './views/ChatView'
import PoolView from './views/PoolView'
import TasksView from './views/TasksView'
import TimelineView from './views/TimelineView'

type BootstrapResponse = Awaited<ReturnType<typeof window.api.getBootstrap>>
type DesktopSettings = Awaited<ReturnType<typeof window.api.getSettings>>
type DesktopProject = DesktopSettings['projects'][number]

type RunnerBootstrapPayload = {
  user_summary: BootstrapResponse['user']
  project_context: {
    project: BootstrapResponse['project']
    roster: BootstrapResponse['roster']
    recent_entries: BootstrapResponse['recent_entries']
    project_context: BootstrapResponse['project_context']
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function LoginScreen({
  authMessage,
  onSettingsChange
}: {
  authMessage: string | null
  onSettingsChange: (settings: DesktopSettings) => void
}): React.JSX.Element {
  const [status, setStatus] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const displayStatus = authMessage ?? status

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setIsSubmitting(true)
    setStatus(null)

    try {
      const nextSettings = await window.api.startGoogleLogin()
      onSettingsChange(nextSettings)
      setStatus('Browser sign-in opened')
    } catch (error) {
      setStatus(`Login failed: ${toErrorMessage(error)}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <h1 className="auth-panel__title">omni</h1>
        <form className="auth-form" onSubmit={handleSubmit}>
          <button className="settings-form__button settings-form__button--primary" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'opening...' : 'Sign in with Google'}
          </button>
        </form>
        {displayStatus && <div className="auth-status">{displayStatus}</div>}
      </section>
    </main>
  )
}

function ProjectSelection({
  settings,
  selectedProjectId,
  onSettingsChange,
  onProjectEntered,
  isCreateOpen,
  onCreateOpenChange
}: {
  settings: DesktopSettings
  selectedProjectId: string | null
  onSettingsChange: (settings: DesktopSettings) => void
  onProjectEntered: () => void
  isCreateOpen: boolean
  onCreateOpenChange: (isOpen: boolean) => void
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [domainSummary, setDomainSummary] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null)
  const [leavingProjectId, setLeavingProjectId] = useState<string | null>(null)
  const [connectingProjectId, setConnectingProjectId] = useState<string | null>(null)

  async function connectProjectFolder(projectId: string): Promise<DesktopSettings> {
    setConnectingProjectId(projectId)
    try {
      const nextSettings = await window.api.chooseProjectFolder(projectId)
      onSettingsChange(nextSettings)
      return nextSettings
    } finally {
      setConnectingProjectId(null)
    }
  }

  async function handleSelect(projectId: string): Promise<void> {
    setStatus(null)
    try {
      let settingsWithFolder = settings
      if (!settingsWithFolder.projectFolders[projectId]) {
        settingsWithFolder = await connectProjectFolder(projectId)
        if (!settingsWithFolder.projectFolders[projectId]) {
          setStatus('Connect a local folder before entering this project')
          return
        }
      }

      const nextSettings = await window.api.selectProject(projectId)
      onSettingsChange(nextSettings)
      onProjectEntered()
    } catch (error) {
      setStatus(`Project selection failed: ${toErrorMessage(error)}`)
    }
  }

  async function handleDelete(project: DesktopProject): Promise<void> {
    if (project.role !== 'leader') {
      setStatus('Only project leaders can delete projects')
      return
    }
    const confirmed = window.confirm(`Delete "${project.project_name}"? This cannot be undone.`)
    if (!confirmed) {
      return
    }

    setDeletingProjectId(project.project_id)
    setStatus(null)
    try {
      const nextSettings = await window.api.deleteProject(project.project_id)
      onSettingsChange(nextSettings)
      setStatus(`Deleted ${project.project_name}`)
    } catch (error) {
      setStatus(`Delete failed: ${toErrorMessage(error)}`)
    } finally {
      setDeletingProjectId(null)
    }
  }

  async function handleLeave(project: DesktopProject): Promise<void> {
    if (project.role === 'leader') {
      setStatus('Project leaders must delete the project instead of leaving')
      return
    }
    const confirmed = window.confirm(`Leave "${project.project_name}"?`)
    if (!confirmed) {
      return
    }

    setLeavingProjectId(project.project_id)
    setStatus(null)
    try {
      const nextSettings = await window.api.leaveProject(project.project_id)
      onSettingsChange(nextSettings)
      setStatus(`Left ${project.project_name}`)
    } catch (error) {
      setStatus(`Leave failed: ${toErrorMessage(error)}`)
    } finally {
      setLeavingProjectId(null)
    }
  }

  async function handleCreate(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!name.trim()) {
      setStatus('Enter a project name')
      return
    }

    setIsSaving(true)
    setStatus(null)
    try {
      const nextSettings = await window.api.createProject({
        name,
        description: description || null,
        domainSummary: domainSummary || null
      })
      const projectId = nextSettings.selectedProjectId
      let settingsWithFolder = nextSettings
      if (projectId) {
        settingsWithFolder = await connectProjectFolder(projectId)
      }
      onSettingsChange(settingsWithFolder)
      setName('')
      setDescription('')
      setDomainSummary('')
      onCreateOpenChange(false)
      if (projectId && settingsWithFolder.projectFolders[projectId]) {
        onProjectEntered()
      } else {
        setStatus('Project created. Connect a local folder before entering it')
      }
    } catch (error) {
      setStatus(`Create failed: ${toErrorMessage(error)}`)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <main className="project-page">
      <section className="project-panel">
        {settings.projects.length > 0 ? (
          <div className="project-list">
            {settings.projects.map((project) => {
              const projectFolder = settings.projectFolders[project.project_id] ?? null
              const isConnectingFolder = connectingProjectId === project.project_id
              return (
              <div
                className={`project-list__item ${
                  project.project_id === selectedProjectId ? 'project-list__item--selected' : ''
                }`}
                key={project.project_id}
              >
                <button className="project-list__select" type="button" onClick={() => void handleSelect(project.project_id)}>
                  <span className="project-list__name-block">
                    <span className="project-list__name">{project.project_name}</span>
                    <span className="project-list__folder" title={projectFolder ?? undefined}>
                      folder: {projectFolder ? getProjectFolderDisplayName(projectFolder) : 'not connected'}
                    </span>
                  </span>
                </button>
                <div className="project-list__actions">
                  <span className="project-list__meta">{project.role}</span>
                  <button
                    className="project-list__folder-button"
                    type="button"
                    onClick={() => void connectProjectFolder(project.project_id)}
                    disabled={isConnectingFolder}
                  >
                    {isConnectingFolder ? 'choosing...' : projectFolder ? 'change folder' : 'connect folder'}
                  </button>
                  {project.role === 'leader' && (
                    <button
                      className="project-list__delete"
                      type="button"
                      onClick={() => void handleDelete(project)}
                      disabled={deletingProjectId === project.project_id}
                    >
                      {deletingProjectId === project.project_id ? 'deleting...' : 'delete'}
                    </button>
                  )}
                  {project.role !== 'leader' && (
                    <button
                      className="project-list__delete"
                      type="button"
                      onClick={() => void handleLeave(project)}
                      disabled={leavingProjectId === project.project_id}
                    >
                      {leavingProjectId === project.project_id ? 'leaving...' : 'leave'}
                    </button>
                  )}
                </div>
              </div>
              )
            })}
          </div>
        ) : (
          <div className="project-empty">
            <h2>No projects yet</h2>
            <p>Create a project when you are ready.</p>
          </div>
        )}

        {isCreateOpen && (
          <form className="project-create-form" onSubmit={handleCreate}>
            <label className="settings-form__label" htmlFor="project-name">
              New project
            </label>
            <input
              id="project-name"
              className="settings-form__input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Project name"
            />
            <input
              className="settings-form__input"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Description"
            />
            <textarea
              className="settings-form__input"
              rows={3}
              value={domainSummary}
              onChange={(event) => setDomainSummary(event.target.value)}
              placeholder="Your role in this project"
            />
            <button className="settings-form__button settings-form__button--primary" type="submit" disabled={isSaving}>
              {isSaving ? 'creating...' : 'create project'}
            </button>
          </form>
        )}

        {status && <div className="auth-status">{status}</div>}
      </section>
    </main>
  )
}

function MemberManagement({
  project,
  onMemberAdded
}: {
  project: DesktopProject
  onMemberAdded: () => Promise<void>
}): React.JSX.Element | null {
  const [email, setEmail] = useState('')
  const [domainSummary, setDomainSummary] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  if (project.role !== 'leader') {
    return null
  }

  async function handleAddMember(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!email.trim() || !domainSummary.trim()) {
      setStatus('Enter an email and role summary')
      return
    }

    setIsSaving(true)
    setStatus(null)
    try {
      await window.api.addProjectMember({
        projectId: project.project_id,
        email,
        domainSummary
      })
      setEmail('')
      setDomainSummary('')
      setStatus('Member added')
      await onMemberAdded()
    } catch (error) {
      setStatus(`Add member failed: ${toErrorMessage(error)}`)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <form className="member-management" onSubmit={handleAddMember}>
      <span className="member-management__title">Add member</span>
      <input
        className="member-management__input"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="email"
      />
      <input
        className="member-management__input"
        value={domainSummary}
        onChange={(event) => setDomainSummary(event.target.value)}
        placeholder="role summary"
      />
      <button className="settings-form__button member-management__button" type="submit" disabled={isSaving}>
        {isSaving ? 'adding...' : 'add'}
      </button>
      {status && <span className="member-management__status">{status}</span>}
    </form>
  )
}

function App(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<TabKey>('chat')
  const [isDark, setIsDark] = useState(true)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isProjectSelectorOpen, setIsProjectSelectorOpen] = useState(true)
  const [authMessage, setAuthMessage] = useState<string | null>(null)
  const [isProjectCreateOpen, setIsProjectCreateOpen] = useState(false)
  const [folderMessage, setFolderMessage] = useState<string | null>(null)

  const settingsQuery = useQuery({
    queryKey: ['desktop-settings'],
    queryFn: (): Promise<DesktopSettings> => window.api.getSettings()
  })

  const desktopSettings = settingsQuery.data
  const selectedProjectId = desktopSettings?.selectedProjectId ?? null
  const bootstrapQuery = useQuery({
    queryKey: ['bootstrap', selectedProjectId],
    enabled: Boolean(desktopSettings?.isLoggedIn && selectedProjectId),
    queryFn: (): Promise<BootstrapResponse> => window.api.getBootstrap()
  })

  useEffect(() => {
    return window.api.onAuthEvent((event) => {
      if ('settings' in event) {
        queryClient.setQueryData(['desktop-settings'], event.settings)
      }
      if (event.type === 'login:pending') {
        setAuthMessage('Completing Google sign-in...')
      } else if (event.type === 'login:failed') {
        setAuthMessage(event.message)
      } else if (event.type === 'login:succeeded') {
        setAuthMessage(null)
        setIsProjectSelectorOpen(true)
      } else if (event.type === 'logout:succeeded') {
        setIsProjectSelectorOpen(false)
      }
    })
  }, [queryClient])

  function handleSettingsChange(nextSettings: DesktopSettings): void {
    queryClient.setQueryData(['desktop-settings'], nextSettings)
  }

  async function handleProjectRefresh(): Promise<void> {
    try {
      const nextSettings = await window.api.refreshProjects()
      queryClient.setQueryData(['desktop-settings'], nextSettings)
    } catch {
      // refresh failed silently
    }
  }

  async function handleLogout(): Promise<void> {
    const nextSettings = await window.api.logout()
    queryClient.setQueryData(['desktop-settings'], nextSettings)
    queryClient.removeQueries({ queryKey: ['bootstrap'] })
    setActiveTab('chat')
    setFolderMessage(null)
    setIsProjectSelectorOpen(false)
  }

  async function handleProjectSelect(projectId: string): Promise<void> {
    setFolderMessage(null)
    let settingsWithFolder = desktopSettings

    if (!settingsWithFolder?.projectFolders[projectId]) {
      settingsWithFolder = await window.api.chooseProjectFolder(projectId)
      queryClient.setQueryData(['desktop-settings'], settingsWithFolder)
      if (!settingsWithFolder.projectFolders[projectId]) {
        setFolderMessage('Connect a local folder before entering this project')
        return
      }
    }

    const nextSettings = await window.api.selectProject(projectId)
    queryClient.setQueryData(['desktop-settings'], nextSettings)
    setActiveTab('chat')
    setIsProjectSelectorOpen(false)
  }

  function handleProjectEntered(): void {
    setActiveTab('chat')
    setFolderMessage(null)
    setIsProjectSelectorOpen(false)
  }

  async function handleChooseProjectFolder(projectId: string): Promise<void> {
    setFolderMessage(null)
    try {
      const nextSettings = await window.api.chooseProjectFolder(projectId)
      queryClient.setQueryData(['desktop-settings'], nextSettings)
      if (!nextSettings.projectFolders[projectId]) {
        setFolderMessage('Project folder was not changed')
      }
    } catch (error) {
      setFolderMessage(`Folder selection failed: ${toErrorMessage(error)}`)
    }
  }

  if (settingsQuery.isError) {
    return <div className="content-status">settings failed: {toErrorMessage(settingsQuery.error)}</div>
  }

  if (settingsQuery.isLoading || !desktopSettings) {
    return <div className="content-status">loading settings...</div>
  }

  if (!desktopSettings.isLoggedIn) {
    return (
      <>
        <LoginScreen authMessage={authMessage} onSettingsChange={handleSettingsChange} />
        {isSettingsOpen && (
          <SettingsPanel
            settings={desktopSettings}
            onClose={() => setIsSettingsOpen(false)}
            onSettingsChange={handleSettingsChange}
          />
        )}
      </>
    )
  }

  const selectedProject = desktopSettings.projects.find((project) => project.project_id === selectedProjectId) ?? null

  if (!selectedProjectId || !selectedProject || isProjectSelectorOpen) {
    return (
      <div className={`app-shell ${isDark ? 'app-shell--dark' : 'app-shell--light'}`}>
        <TopBar
          workspaceName="projects"
          serverBaseUrl={desktopSettings.serverBaseUrl}
          accountEmail={desktopSettings.account?.email}
          showProjectsButton
          isDark={isDark}
          onToggleTheme={() => setIsDark((value) => !value)}
          anthropicKeyConfigured={desktopSettings.hasAnthropicApiKey}
          onSettings={() => setIsSettingsOpen(true)}
          onLogout={() => void handleLogout()}
          onNewProject={() => setIsProjectCreateOpen((v) => !v)}
          isProjectCreateOpen={isProjectCreateOpen}
          onRefresh={() => void handleProjectRefresh()}
        />
        <ProjectSelection
          settings={desktopSettings}
          selectedProjectId={selectedProjectId}
          onSettingsChange={handleSettingsChange}
          onProjectEntered={handleProjectEntered}
          isCreateOpen={isProjectCreateOpen}
          onCreateOpenChange={setIsProjectCreateOpen}
        />
        {isSettingsOpen && (
          <SettingsPanel
            settings={desktopSettings}
            onClose={() => setIsSettingsOpen(false)}
            onSettingsChange={handleSettingsChange}
          />
        )}
      </div>
    )
  }

  const workspaceName = selectedProject.project_name
  const bootstrapStatus: 'live' | 'loading' | 'error' = bootstrapQuery.isError
    ? 'error'
    : bootstrapQuery.data
      ? 'live'
      : 'loading'
  const bootstrapError = bootstrapQuery.error instanceof Error ? `bootstrap failed: ${bootstrapQuery.error.message}` : null
  const roster: SidebarAgent[] =
    bootstrapQuery.data?.roster.map((user) => ({
      id: user.id,
      display_name: user.display_name,
      domain_summary: user.domain_summary
    })) ?? []
  const hasAnthropicApiKey = Boolean(desktopSettings.hasAnthropicApiKey)
  const activeUserId = bootstrapQuery.data?.user.id ?? selectedProject.user_id
  const selectedProjectFolderPath = desktopSettings.selectedProjectFolderPath

  const runnerBootstrap: RunnerBootstrapPayload | null = bootstrapQuery.data
    ? {
        user_summary: bootstrapQuery.data.user,
        project_context: {
          project: bootstrapQuery.data.project,
          roster: bootstrapQuery.data.roster,
          recent_entries: bootstrapQuery.data.recent_entries,
          project_context: bootstrapQuery.data.project_context
        }
      }
    : null

  let activeView: React.JSX.Element = <div className="content-panel">loading project...</div>
  if (bootstrapQuery.isError) {
    activeView = <div className="content-panel">Project bootstrap failed.</div>
  } else if (activeTab === 'chat' && runnerBootstrap) {
    activeView = (
      <ChatView
        workspaceId={selectedProjectId}
        userId={activeUserId}
        bootstrap={runnerBootstrap}
        isAssistantConfigured={hasAnthropicApiKey}
        onConfigureAssistant={() => setIsSettingsOpen(true)}
        projectFolderPath={selectedProjectFolderPath}
        onReconnectFolder={() => void handleChooseProjectFolder(selectedProjectId)}
      />
    )
  } else if (activeTab === 'pool') {
    activeView = <PoolView />
  } else if (activeTab === 'timeline') {
    activeView = <TimelineView projectFolderPath={selectedProjectFolderPath} />
  } else if (activeTab === 'tasks') {
    activeView = <TasksView />
  }

  return (
    <div className={`app-shell ${isDark ? 'app-shell--dark' : 'app-shell--light'}`}>
      <TopBar
        workspaceName={workspaceName}
        serverBaseUrl={desktopSettings.serverBaseUrl}
        projects={desktopSettings.projects}
        selectedProjectId={selectedProjectId}
        accountEmail={desktopSettings.account?.email}
        projectFolderPath={selectedProjectFolderPath}
        bootstrapStatus={bootstrapStatus}
        isDark={isDark}
        onToggleTheme={() => setIsDark((value) => !value)}
        anthropicKeyConfigured={hasAnthropicApiKey}
        onBack={() => setIsProjectSelectorOpen(true)}
        onProjectSelect={(projectId) => void handleProjectSelect(projectId)}
        onChangeFolder={() => void handleChooseProjectFolder(selectedProjectId)}
        onSettings={() => setIsSettingsOpen(true)}
        onLogout={() => void handleLogout()}
      />

      <div className="app-body">
        <Sidebar 
          agents={roster} 
          currentUserId={activeUserId} 
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />

        <main className="main-pane">
          {bootstrapError && <div className="content-status">{bootstrapError}</div>}
          {folderMessage && <div className="content-status">{folderMessage}</div>}
          {selectedProject && (
            <MemberManagement project={selectedProject} onMemberAdded={() => bootstrapQuery.refetch().then(() => undefined)} />
          )}
          {activeView}
        </main>
      </div>

      {isSettingsOpen && (
        <SettingsPanel
          settings={desktopSettings}
          onClose={() => setIsSettingsOpen(false)}
          onSettingsChange={handleSettingsChange}
        />
      )}
    </div>
  )
}

export default App
