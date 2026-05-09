import agents from '../fixtures/agents.json'
import type { TabKey } from './Tabs'

type SidebarAgent = {
  id: string
  display_name: string
  domain_summary?: string
}

type AgentFixture = {
  id: string
  display_name: string
  domain?: {
    primary?: string
  }
}

type SidebarProps = {
  agents?: SidebarAgent[]
  currentUserId?: string
  activeTab?: TabKey
  onTabChange?: (tab: TabKey) => void
}

// Navigation icons as components
function ChatIcon(): React.JSX.Element {
  return (
    <svg className="sidebar-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function TimelineIcon(): React.JSX.Element {
  return (
    <svg className="sidebar-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
      <circle cx="12" cy="5" r="2" />
      <circle cx="12" cy="19" r="2" />
      <path d="M7 12h4M13 12h4M12 7v4M12 13v4" />
    </svg>
  )
}

function TasksIcon(): React.JSX.Element {
  return (
    <svg className="sidebar-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  )
}

function PoolIcon(): React.JSX.Element {
  return (
    <svg className="sidebar-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
  )
}

// Navigation items configuration - reordered for priority
const navItems: { key: TabKey; label: string; icon: () => React.JSX.Element }[] = [
  { key: 'chat', label: 'Chat', icon: ChatIcon },
  { key: 'timeline', label: 'Timeline', icon: TimelineIcon },
  { key: 'tasks', label: 'Tasks', icon: TasksIcon },
  { key: 'pool', label: 'Pool', icon: PoolIcon },
]

function Sidebar({ agents: roster, currentUserId, activeTab, onTabChange }: SidebarProps): React.JSX.Element {
  const items =
    roster && roster.length > 0
      ? roster
      : (agents as AgentFixture[]).map((agent) => ({
          id: agent.id,
          display_name: agent.display_name,
          domain_summary: agent.domain?.primary ?? ''
        }))

  const showNavigation = activeTab !== undefined && onTabChange !== undefined

  return (
    <aside className="sidebar">
      {/* Navigation Section */}
      {showNavigation && (
        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <button
              key={item.key}
              className={`sidebar-nav-item ${activeTab === item.key ? 'sidebar-nav-item--active' : ''}`}
              type="button"
              onClick={() => onTabChange(item.key)}
            >
              <item.icon />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      )}

      {/* Team Section Header */}
      <div className="sidebar-section-header">
        <span className="sidebar-section-title">Team</span>
      </div>

      {/* Roster List */}
      <div className="sidebar-list">
        {items.map((item) => (
          <div className="sidebar-item" key={item.id}>
            <div className="sidebar-item__title">
              <span>{item.display_name}</span>
              {item.id === currentUserId && <span className="sidebar-item__marker">you</span>}
            </div>
            <div className="sidebar-item__meta">{item.domain_summary || 'team member'}</div>
          </div>
        ))}
      </div>
    </aside>
  )
}

export type { SidebarAgent }
export default Sidebar
