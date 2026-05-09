import tasks from '../fixtures/tasks.json'

type TaskFixture = {
  id: string
  title: string
  status: string
}

function getStatusClass(status: string): string {
  const normalized = status.toLowerCase()
  if (normalized.includes('done') || normalized.includes('complete')) return 'tasks-item__status--done'
  if (normalized.includes('progress') || normalized.includes('active')) return 'tasks-item__status--active'
  if (normalized.includes('pending') || normalized.includes('wait')) return 'tasks-item__status--pending'
  return ''
}

function TasksView(): React.JSX.Element {
  return (
    <section className="content-panel tasks-view">
      <div className="tasks-header">
        <h2 className="tasks-title">Tasks</h2>
        <p className="tasks-subtitle">Track and manage your project tasks</p>
      </div>
      <div className="tasks-list">
        {tasks.map((task) => {
          const item = task as TaskFixture
          return (
            <div className="tasks-item" key={item.id}>
              <div className="tasks-item__checkbox">
                <div className={`tasks-item__check ${item.status.toLowerCase().includes('done') ? 'tasks-item__check--checked' : ''}`}>
                  {item.status.toLowerCase().includes('done') && (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
              </div>
              <div className="tasks-item__content">
                <span className={`tasks-item__title ${item.status.toLowerCase().includes('done') ? 'tasks-item__title--done' : ''}`}>
                  {item.title}
                </span>
                <span className={`tasks-item__status ${getStatusClass(item.status)}`}>
                  {item.status}
                </span>
              </div>
            </div>
          )
        })}
      </div>
      {tasks.length === 0 && (
        <p className="tasks-empty">No tasks yet. Tasks will appear here as they are created.</p>
      )}
    </section>
  )
}

export default TasksView
