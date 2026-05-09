import events from '../fixtures/timeline.json'

type TimelineFixture = {
  id: string
  time: string
  text: string
}

function TimelineView(): React.JSX.Element {
  return (
    <section className="content-panel">
      {events.map((event) => {
        const item = event as TimelineFixture

        return (
          <div className="content-row" key={item.id}>
            <div className="content-row__title">{item.time}</div>
            <div className="content-row__meta">{item.text}</div>
          </div>
        )
      })}
    </section>
  )
}

export default TimelineView
