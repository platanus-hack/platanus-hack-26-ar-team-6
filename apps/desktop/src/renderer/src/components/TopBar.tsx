import { useQuery } from '@tanstack/react-query'
import { getProjectFolderDisplayName } from '../projectFolders'

type HealthResponse = {
  status?: string
  sha?: string
}

type TopBarProps = {
  workspaceName: string
  serverBaseUrl: string
  projects?: Array<{ project_id: string; project_name: string }>
  selectedProjectId?: string | null
  accountEmail?: string | null
  projectFolderPath?: string | null
  onBack?: () => void
  bootstrapStatus?: 'live' | 'loading' | 'error'
  anthropicKeyConfigured?: boolean
  onSettings?: () => void
  onProjectSelect?: (projectId: string) => void
  onChangeFolder?: () => void
  onLogout?: () => void
}

function TopBar({
  workspaceName,
  serverBaseUrl,
  projects = [],
  selectedProjectId,
  accountEmail,
  projectFolderPath,
  onBack,
  bootstrapStatus,
  anthropicKeyConfigured,
  onSettings,
  onProjectSelect,
  onChangeFolder,
  onLogout
}: TopBarProps): React.JSX.Element {
  const isHealthcheckEnabled = import.meta.env.VITE_ENABLE_HEALTHCHECK === 'true'

  const { data, isError } = useQuery({
    queryKey: ['health', serverBaseUrl],
    enabled: isHealthcheckEnabled,
    queryFn: (): Promise<HealthResponse> => window.api.getHealth(serverBaseUrl)
  })

  const isHealthy = isHealthcheckEnabled && data?.status === 'ok' && !isError
  const healthText = isHealthy ? 'status: online' : 'status: offline'
  const isBootstrapLive = bootstrapStatus === 'live'

  return (
    <header className="topbar">
      {onBack && (
        <button className="topbar-back" type="button" onClick={onBack}>
          projects
        </button>
      )}
      <span>relevo</span>
      <span>workspace: {workspaceName}</span>
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
      <span className="topbar-folder" title={projectFolderPath ?? ''}>
        folder: {projectFolderPath ? getProjectFolderDisplayName(projectFolderPath) : 'missing'}
      </span>
      {onChangeFolder && (
        <button className="topbar-button" type="button" onClick={onChangeFolder}>
          change folder
        </button>
      )}
      {bootstrapStatus && (
        <>
          <span className={`health-indicator ${isBootstrapLive ? 'health-indicator--ok' : 'health-indicator--off'}`} />
          <span>bootstrap: {bootstrapStatus}</span>
        </>
      )}
      {typeof anthropicKeyConfigured === 'boolean' && (
        <>
          <span className={`health-indicator ${anthropicKeyConfigured ? 'health-indicator--ok' : 'health-indicator--off'}`} />
          <span>ai: {anthropicKeyConfigured ? 'configured' : 'missing key'}</span>
        </>
      )}
      <span className={`health-indicator ${isHealthy ? 'health-indicator--ok' : 'health-indicator--off'}`} />
      <span title={data?.sha || ''}>{healthText}</span>
      {accountEmail && <span className="topbar-account">{accountEmail}</span>}
      {onSettings && (
        <button className="topbar-button" type="button" onClick={onSettings}>
          settings
        </button>
      )}
      {onLogout && (
        <button className="topbar-button" type="button" onClick={onLogout}>
          logout
        </button>
      )}
    </header>
  )
}

export default TopBar
