import { useQuery } from '@tanstack/react-query'

type HealthResponse = {
  status?: string
  sha?: string
}

type TopBarProps = {
  workspaceName: string
  onBack?: () => void
  bootstrapStatus?: 'live' | 'fallback'
  isDark: boolean
  onToggleTheme: () => void
  anthropicKeyConfigured?: boolean
  onSettings?: () => void
}

function SunIcon(): React.JSX.Element {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
      <circle cx="10" cy="10" r="3" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
      <path
        d="M10 2V3M10 17V18M18 10H17M3 10H2M15.66 4.34L14.95 5.05M5.05 14.95L4.34 15.66M15.66 15.66L14.95 14.95M5.05 5.05L4.34 4.34"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
    </svg>
  )
}

function MoonIcon(): React.JSX.Element {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
      <path
        d="M18 11.25C17.5 15.5 13.5 18.5 9.25 18C5 17.5 2 13.5 2.5 9.25C3 5 7 2 11.25 2.5C10 3.5 9.25 5.25 9.25 7.25C9.25 10.5 11.75 13 15 13C16.5 13 17.75 12.5 18.75 11.5C18.5 11.5 18.25 11.25 18 11.25Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  )
}

function TopBar({
  workspaceName,
  onBack,
  bootstrapStatus,
  isDark,
  onToggleTheme,
  anthropicKeyConfigured,
  onSettings
}: TopBarProps): React.JSX.Element {
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'https://platanus-hack-26-ar-team-6-production-75c7.up.railway.app'
  const isHealthcheckEnabled = import.meta.env.VITE_ENABLE_HEALTHCHECK === 'true'

  const { data, isError } = useQuery({
    queryKey: ['health', apiBaseUrl],
    enabled: isHealthcheckEnabled,
    queryFn: (): Promise<HealthResponse> => window.api.getHealth(apiBaseUrl)
  })

  const isHealthy = isHealthcheckEnabled && data?.status === 'ok' && !isError
  const healthText = isHealthy ? 'status: online' : 'status: offline'
  const isBootstrapLive = bootstrapStatus === 'live'

  return (
    <header className="topbar">
      <div className="topbar-group">
        {onBack && (
          <button className="topbar-back" type="button" onClick={onBack}>
            back
          </button>
        )}
        <span className="topbar-subtle">workspace: {workspaceName}</span>
      </div>
      <div className="topbar-group">
        {bootstrapStatus && (
          <div className="topbar-status">
            <span className={`health-indicator ${isBootstrapLive ? 'health-indicator--ok' : 'health-indicator--off'}`} />
            <span>bootstrap: {bootstrapStatus}</span>
          </div>
        )}
        {typeof anthropicKeyConfigured === 'boolean' && (
          <div className="topbar-status">
            <span
              className={`health-indicator ${anthropicKeyConfigured ? 'health-indicator--ok' : 'health-indicator--off'}`}
            />
            <span>ai: {anthropicKeyConfigured ? 'configured' : 'missing key'}</span>
          </div>
        )}
        <div className="topbar-status">
          <span className={`health-indicator ${isHealthy ? 'health-indicator--ok' : 'health-indicator--off'}`} />
          <span title={data?.sha || ''}>{healthText}</span>
        </div>
        {onSettings && (
          <button className="topbar-button" type="button" onClick={onSettings}>
            settings
          </button>
        )}
        <button className="theme-toggle" type="button" onClick={onToggleTheme}>
          {isDark ? <MoonIcon /> : <SunIcon />}
        </button>
      </div>
    </header>
  )
}

export default TopBar
