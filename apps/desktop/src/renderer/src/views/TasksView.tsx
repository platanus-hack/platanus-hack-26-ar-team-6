import { CheckCircle2, Circle, Clock } from 'lucide-react'
import tasks from '../fixtures/tasks.json'

type TaskFixture = {
  id: string
  title: string
  status: string
  authors: string[]
}

const STATUS_CONFIG: Record<string, { icon: typeof Circle; label: string; className: string }> = {
  done: { icon: CheckCircle2, label: 'Done', className: 'task-card--done' },
  'in progress': { icon: Clock, label: 'In progress', className: 'task-card--progress' },
  open: { icon: Circle, label: 'Open', className: 'task-card--open' },
}

function TasksView(): React.JSX.Element {
  return (
    <section className="content-panel tasks-view">
      <div className="tasks-grid">
        {tasks.map((task) => {
          const item = task as TaskFixture
          const config = STATUS_CONFIG[item.status] ?? STATUS_CONFIG.open!
          const Icon = config.icon

          return (
            <div className={`task-card ${config.className}`} key={item.id}>
              <div className="task-card__status">
                <Icon size={14} />
                <span>{config.label}</span>
              </div>
              <h3 className="task-card__title">{item.title}</h3>
              {item.authors.length > 0 && (
                <div className="task-card__authors">
                  {item.authors.join(', ')}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

export default TasksView
