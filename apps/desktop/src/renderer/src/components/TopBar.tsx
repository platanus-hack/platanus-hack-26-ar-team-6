import { useQuery } from '@tanstack/react-query'

type HealthResponse = {
  status?: string
  sha?: string
}

type TopBarProps = {
  workspaceName: string
  onBack?: () => void
  bootstrapStatus?: 'live' | 'fallback'
  anthropicKeyConfigured?: boolean
  onSettings?: () => void
}

function TopBar({
  workspaceName,
  onBack,
  bootstrapStatus,
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
      {onBack && (
        <button className="topbar-back" type="button" onClick={onBack}>
          back
        </button>
      )}
      <span>relevo</span>
      <span>workspace: {workspaceName}</span>
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
      {onSettings && (
        <button className="topbar-button" type="button" onClick={onSettings}>
          settings
        </button>
      )}
    </header>
  )
}

export default TopBar
