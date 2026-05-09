import tasks from '../fixtures/tasks.json'

type TaskFixture = {
  id: string
  title: string
  status: string
}

function TasksView(): React.JSX.Element {
  return (
    <section className="content-panel">
      {tasks.map((task) => {
        const item = task as TaskFixture

        return (
          <div className="content-row" key={item.id}>
            <div className="content-row__title">{item.title}</div>
            <div className="content-row__meta">{item.status}</div>
          </div>
        )
      })}
    </section>
  )
}

export default TasksView
