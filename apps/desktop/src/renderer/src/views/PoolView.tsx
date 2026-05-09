import poolItems from '../fixtures/pool.json'

type PoolFixture = {
  id: string
  title: string
  source: string
  tag: string
}

function PoolView(): React.JSX.Element {
  return (
    <section className="content-panel">
      {poolItems.map((entry) => {
        const item = entry as PoolFixture

        return (
          <div className="content-row" key={item.id}>
            <div className="content-row__title">{item.title}</div>
            <div className="content-row__meta">
              {item.source} / {item.tag}
            </div>
          </div>
        )
      })}
    </section>
  )
}

export default PoolView
