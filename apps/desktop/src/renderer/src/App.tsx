import { useState } from 'react'

import Sidebar from './components/Sidebar'
import Tabs, { type TabKey } from './components/Tabs'
import TopBar from './components/TopBar'
import ChatView from './views/ChatView'
import PoolView from './views/PoolView'
import TasksView from './views/TasksView'
import TimelineView from './views/TimelineView'

function App(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<TabKey>('chat')

  let activeView: React.JSX.Element = <ChatView />

  if (activeTab === 'pool') {
    activeView = <PoolView />
  } else if (activeTab === 'timeline') {
    activeView = <TimelineView />
  } else if (activeTab === 'tasks') {
    activeView = <TasksView />
  }

  return (
    <div className="app-shell">
      <TopBar />

      <div className="app-body">
        <Sidebar />

        <main className="main-pane">
          <Tabs activeTab={activeTab} onTabChange={setActiveTab} />
          {activeView}
        </main>
      </div>
    </div>
  )
}

export default App
