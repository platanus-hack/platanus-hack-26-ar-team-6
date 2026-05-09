import poolItems from '../fixtures/pool.json'

type PoolFixture = {
  id: string
  title: string
  source: string
  tag: string
}

function PoolView(): React.JSX.Element {
  return (
    <section className="content-panel pool-view">
      <div className="pool-header">
        <h2 className="pool-title">Memory Pool</h2>
        <p className="pool-subtitle">Shared knowledge and context items</p>
      </div>
      <div className="pool-grid">
        {poolItems.map((entry) => {
          const item = entry as PoolFixture
          return (
            <div className="pool-card" key={item.id}>
              <div className="pool-card__header">
                <span className="pool-card__tag">{item.tag}</span>
              </div>
              <h3 className="pool-card__title">{item.title}</h3>
              <p className="pool-card__source">{item.source}</p>
            </div>
          )
        })}
      </div>
      {poolItems.length === 0 && (
        <p className="pool-empty">No items in the memory pool yet.</p>
      )}
    </section>
  )
}

export default PoolView
