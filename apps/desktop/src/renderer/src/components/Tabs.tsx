type TabKey = 'chat' | 'pool' | 'timeline' | 'tasks'

type TabsProps = {
  activeTab: TabKey
  onTabChange: (tab: TabKey) => void
}

// Reordered tabs: Chat -> Timeline -> Tasks -> Pool
function Tabs({ activeTab, onTabChange }: TabsProps): React.JSX.Element {
  return (
    <nav className="tabs">
      <button
        className={`tab ${activeTab === 'chat' ? 'tab--active' : ''}`}
        type="button"
        onClick={() => onTabChange('chat')}
      >
        Chat
      </button>
      <button
        className={`tab ${activeTab === 'timeline' ? 'tab--active' : ''}`}
        type="button"
        onClick={() => onTabChange('timeline')}
      >
        Timeline
      </button>
      <button
        className={`tab ${activeTab === 'tasks' ? 'tab--active' : ''}`}
        type="button"
        onClick={() => onTabChange('tasks')}
      >
        Tasks
      </button>
      <button
        className={`tab ${activeTab === 'pool' ? 'tab--active' : ''}`}
        type="button"
        onClick={() => onTabChange('pool')}
      >
        Pool
      </button>
    </nav>
  )
}

export type { TabKey }
export default Tabs
