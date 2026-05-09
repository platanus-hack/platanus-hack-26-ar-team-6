type TabKey = 'chat' | 'pool' | 'timeline' | 'tasks'

type TabsProps = {
  activeTab: TabKey
  onTabChange: (tab: TabKey) => void
}

function Tabs({ activeTab, onTabChange }: TabsProps): React.JSX.Element {
  return (
    <nav className="tabs">
      <button
        className={`tab ${activeTab === 'chat' ? 'tab--active' : ''}`}
        type="button"
        onClick={() => onTabChange('chat')}
      >
        chat
      </button>
      <button
        className={`tab ${activeTab === 'pool' ? 'tab--active' : ''}`}
        type="button"
        onClick={() => onTabChange('pool')}
      >
        pool
      </button>
      <button
        className={`tab ${activeTab === 'timeline' ? 'tab--active' : ''}`}
        type="button"
        onClick={() => onTabChange('timeline')}
      >
        timeline
      </button>
      <button
        className={`tab ${activeTab === 'tasks' ? 'tab--active' : ''}`}
        type="button"
        onClick={() => onTabChange('tasks')}
      >
        tasks
      </button>
    </nav>
  )
}

export type { TabKey }
export default Tabs
