import type { ToolTraceEntry } from '../stores/chatStore'
import logoSrc from './logo/Group 45.svg'

function formatToolName(toolName: string): string {
  if (toolName.startsWith('mcp__')) {
    const parts = toolName.split('__')
    const base = parts.slice(2).join('__')
    return base.replace(/_/g, ' ')
  }
  return toolName.replace(/_/g, ' ')
}

function isMcpTool(toolName: string): boolean {
  return toolName.startsWith('mcp__relevo-')
}

function ToolEntry({ entry }: { entry: ToolTraceEntry }) {
  const isRunning = entry.status === 'running'
  const isMcp = isMcpTool(entry.toolName)

  let icon: React.ReactNode
  if (isRunning && isMcp) {
    icon = (
      <img
        src={logoSrc}
        alt=""
        aria-hidden="true"
        className="thinking-tool-logo thinking-tool-logo--spin"
      />
    )
  } else if (isRunning) {
    icon = <span className="thinking-tool-spinner" aria-hidden="true" />
  } else if (entry.status === 'succeeded') {
    icon = <span className="thinking-tool-icon thinking-tool-icon--ok" aria-hidden="true">✓</span>
  } else {
    icon = <span className="thinking-tool-icon thinking-tool-icon--fail" aria-hidden="true">✗</span>
  }

  return (
    <div className={`thinking-tool-entry thinking-tool-entry--${entry.status}`}>
      {icon}
      <span className="thinking-tool-name">{formatToolName(entry.toolName)}</span>
      {entry.elapsedTimeSeconds != null && (
        <span className="thinking-tool-time">{entry.elapsedTimeSeconds.toFixed(1)}s</span>
      )}
    </div>
  )
}

type Props = {
  toolTrace: ToolTraceEntry[]
}

export default function ThinkingIndicator({ toolTrace }: Props) {
  const hasMcpRunning = toolTrace.some(
    (e) => e.status === 'running' && isMcpTool(e.toolName)
  )

  return (
    <div className="thinking-indicator">
      <div className="thinking-header">
        {hasMcpRunning ? (
          <img
            src={logoSrc}
            alt=""
            aria-hidden="true"
            className="thinking-logo thinking-logo--spin"
          />
        ) : (
          <span className="thinking-dots" aria-label="thinking">
            <span />
            <span />
            <span />
          </span>
        )}
        <span className="thinking-label">thinking</span>
      </div>
      {toolTrace.length > 0 && (
        <ul className="thinking-tool-list">
          {toolTrace.map((entry) => (
            <li key={entry.id}>
              <ToolEntry entry={entry} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
