type TabKey = 'chat' | 'pool' | 'timeline' | 'responsibilities' | 'tasks'

type TabsProps = {
  activeTab: TabKey
  onTabChange: (tab: TabKey) => void
}

function Tabs({ activeTab, onTabChange }: TabsProps): React.JSX.Element {
  return (
    <nav className="tabs">
      <button
        className={`settings-form__button ${activeTab === 'chat' ? 'settings-form__button--primary' : ''}`}
        type="button"
        onClick={() => onTabChange('chat')}
      >
        chat
      </button>
      <button
        className={`settings-form__button ${activeTab === 'pool' ? 'settings-form__button--primary' : ''}`}
        type="button"
        onClick={() => onTabChange('pool')}
      >
        pool
      </button>
      <button
        className={`settings-form__button ${activeTab === 'timeline' ? 'settings-form__button--primary' : ''}`}
        type="button"
        onClick={() => onTabChange('timeline')}
      >
        timeline
      </button>
      <button
        className={`settings-form__button ${activeTab === 'responsibilities' ? 'settings-form__button--primary' : ''}`}
        type="button"
        onClick={() => onTabChange('responsibilities')}
      >
        responsibilities
      </button>
      <button
        className={`settings-form__button ${activeTab === 'tasks' ? 'settings-form__button--primary' : ''}`}
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
