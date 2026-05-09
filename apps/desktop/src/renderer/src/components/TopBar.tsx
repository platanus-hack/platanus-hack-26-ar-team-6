import { useQuery } from '@tanstack/react-query'

type HealthResponse = {
  status?: string
  sha?: string
}

type TopBarProps = {
  workspaceName: string
  onBack: () => void
}

function TopBar({ workspaceName, onBack }: TopBarProps): React.JSX.Element {
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'https://creative-possibility-production-f2af.up.railway.app'
  const isHealthcheckEnabled = import.meta.env.VITE_ENABLE_HEALTHCHECK === 'true'

  const { data, isError } = useQuery({
    queryKey: ['health', apiBaseUrl],
    enabled: isHealthcheckEnabled,
    queryFn: (): Promise<HealthResponse> => window.api.getHealth(apiBaseUrl)
  })

  const isHealthy = isHealthcheckEnabled && data?.status === 'ok' && !isError
  const healthText = isHealthy ? 'status: online' : 'status: offline'

  return (
    <header className="topbar">
      <button className="topbar-back" type="button" onClick={onBack}>
        back
      </button>
      <span>relevo</span>
      <span>workspace: {workspaceName}</span>
      <span className={`health-indicator ${isHealthy ? 'health-indicator--ok' : 'health-indicator--off'}`} />
      <span title={data?.sha || ''}>{healthText}</span>
    </header>
  )
}

export default TopBar
