import { useQuery } from '@tanstack/react-query'

type HealthResponse = {
  status?: string
  sha?: string
}

function TopBar(): React.JSX.Element {
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

  const { data, isError } = useQuery({
    queryKey: ['health', apiBaseUrl],
    queryFn: async (): Promise<HealthResponse> => {
      const response = await fetch(`${apiBaseUrl}/health`)

      if (!response.ok) {
        throw new Error('health request failed')
      }

      return response.json()
    }
  })

  const isHealthy = data?.status === 'ok' && !isError
  const healthText = isHealthy ? 'health: ok' : 'health: offline'

  return (
    <header className="topbar">
      <span>asker: demo</span>
      <span>workspace: main</span>
      <span className={`health-indicator ${isHealthy ? 'health-indicator--ok' : 'health-indicator--off'}`} />
      <span title={data?.sha || ''}>{healthText}</span>
    </header>
  )
}

export default TopBar
