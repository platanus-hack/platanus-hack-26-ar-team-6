import { Activity, MessageSquare, Network, SquareCheck, Users } from 'lucide-react'
import type { LucideProps } from 'lucide-react'
import type { ComponentType } from 'react'

type TabKey = 'chat' | 'timeline' | 'responsibilities' | 'tasks' | 'graph'

type TabsProps = {
  activeTab: TabKey
  onTabChange: (tab: TabKey) => void
}

const TAB_ICON_SIZE = 15

const TAB_DEFS: Array<{ key: TabKey; label: string; Icon: ComponentType<LucideProps> }> = [
  { key: 'chat', label: 'chat', Icon: MessageSquare },
  { key: 'timeline', label: 'timeline', Icon: Activity },
  { key: 'responsibilities', label: 'team', Icon: Users },
  { key: 'tasks', label: 'tasks', Icon: SquareCheck },
  { key: 'graph', label: 'graph', Icon: Network }
]

function Tabs({ activeTab, onTabChange }: TabsProps): React.JSX.Element {
  return (
    <nav className="tabs" role="tablist">
      {TAB_DEFS.map(({ key, label, Icon }) => {
        const isActive = activeTab === key
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`tab${isActive ? ' tab--active' : ''}`}
            onClick={() => onTabChange(key)}
          >
            <Icon size={TAB_ICON_SIZE} />
            <span className="tab__label">{label}</span>
          </button>
        )
      })}
    </nav>
  )
}

export type { TabKey }
export default Tabs
