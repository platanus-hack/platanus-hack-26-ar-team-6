import agents from '../fixtures/agents.json'

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
  currentUserName?: string
  currentUserDetail?: string
}

function Sidebar({ agents: roster, currentUserId, currentUserName, currentUserDetail }: SidebarProps): React.JSX.Element {
  const items =
    roster && roster.length > 0
      ? roster
      : (agents as AgentFixture[]).map((agent) => ({
          id: agent.id,
          display_name: agent.display_name,
          domain_summary: agent.domain?.primary ?? ''
        }))

  return (
    <aside className="sidebar">
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
      {(currentUserName || currentUserDetail) && (
        <div className="sidebar-user-section">
          <div className="sidebar-user-box">
            <div className="sidebar-user-box__avatar" aria-hidden="true">
              <span>You</span>
            </div>
            <div className="sidebar-user-box__content">
              <div className="sidebar-user-box__name">{currentUserName || 'Your Name'}</div>
              <div className="sidebar-user-box__detail">{currentUserDetail || 'main'}</div>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}

export type { SidebarAgent }
export default Sidebar
