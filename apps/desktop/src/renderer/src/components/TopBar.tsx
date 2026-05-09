import {
  ArrowLeft,
  Folder,
  LogOut,
  Moon,
  Plus,
  RefreshCw,
  Settings,
  Sun,
  X
} from 'lucide-react'

type TopBarProps = {
  workspaceName: string
  serverBaseUrl: string
  projects?: Array<{ project_id: string; project_name: string }>
  selectedProjectId?: string | null
  accountEmail?: string | null
  projectFolderPath?: string | null
  onBack?: () => void
  showProjectsButton?: boolean
  bootstrapStatus?: 'live' | 'loading' | 'error'
  isDark: boolean
  onToggleTheme: () => void
  anthropicKeyConfigured?: boolean
  onSettings?: () => void
  onProjectSelect?: (projectId: string) => void
  onChangeFolder?: () => void
  onLogout?: () => void
  onNewProject?: () => void
  isProjectCreateOpen?: boolean
  onRefresh?: () => void
}

const ICON_SIZE = 18

function TopBar({
  workspaceName: _workspaceName,
  projects = [],
  selectedProjectId,
  accountEmail,
  projectFolderPath: _projectFolderPath,
  onBack,
  showProjectsButton = false,
  isDark,
  onToggleTheme,
  onSettings,
  onProjectSelect,
  onChangeFolder,
  onLogout,
  onNewProject,
  isProjectCreateOpen,
  onRefresh
}: TopBarProps): React.JSX.Element {
  return (
    <header className="topbar">
      <div className="topbar-group">
        {(showProjectsButton || onBack) && (
          <button
            className="topbar-icon"
            type="button"
            onClick={onBack}
            aria-label="back to projects"
            title="projects"
          >
            <ArrowLeft size={ICON_SIZE} />
          </button>
        )}
        {projects.length > 0 && selectedProjectId && onProjectSelect && (
          <select
            className="topbar-select"
            value={selectedProjectId}
            onChange={(event) => onProjectSelect(event.target.value)}
            aria-label="Project"
          >
            {projects.map((project) => (
              <option key={project.project_id} value={project.project_id}>
                {project.project_name}
              </option>
            ))}
          </select>
        )}
        {onNewProject && (
          <button
            className="topbar-icon"
            type="button"
            onClick={onNewProject}
            aria-label={isProjectCreateOpen ? 'cancel' : 'new project'}
            title={isProjectCreateOpen ? 'cancel' : 'new project'}
          >
            {isProjectCreateOpen ? <X size={ICON_SIZE} /> : <Plus size={ICON_SIZE} />}
          </button>
        )}
        {onRefresh && (
          <button
            className="topbar-icon"
            type="button"
            onClick={onRefresh}
            aria-label="refresh"
            title="refresh"
          >
            <RefreshCw size={ICON_SIZE} />
          </button>
        )}
        {onChangeFolder && (
          <button
            className="topbar-icon"
            type="button"
            onClick={onChangeFolder}
            aria-label="change folder"
            title="change folder"
          >
            <Folder size={ICON_SIZE} />
          </button>
        )}
      </div>
      <div className="topbar-group">
        {accountEmail && <span className="topbar-account">{accountEmail}</span>}
        {onSettings && (
          <button
            className="topbar-icon"
            type="button"
            onClick={onSettings}
            aria-label="settings"
            title="settings"
          >
            <Settings size={ICON_SIZE} />
          </button>
        )}
        {onLogout && (
          <button
            className="topbar-icon"
            type="button"
            onClick={onLogout}
            aria-label="logout"
            title="logout"
          >
            <LogOut size={ICON_SIZE} />
          </button>
        )}
        <button
          className="topbar-icon"
          type="button"
          onClick={onToggleTheme}
          aria-label={isDark ? 'switch to light' : 'switch to dark'}
          title={isDark ? 'switch to light' : 'switch to dark'}
        >
          {isDark ? <Moon size={ICON_SIZE} /> : <Sun size={ICON_SIZE} />}
        </button>
      </div>
    </header>
  )
}

export default TopBar
