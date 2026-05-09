import agents from '../fixtures/agents.json'

type AgentFixture = {
  id: string
  display_name: string
  domain: {
    primary: string
  }
}

function Sidebar(): React.JSX.Element {
  return (
    <aside className="sidebar">
      {agents.map((agent) => {
        const item = agent as AgentFixture

        return (
          <div className="sidebar-item" key={item.id}>
            <div>{item.display_name}</div>
            <div className="sidebar-item__meta">{item.domain.primary}</div>
          </div>
        )
      })}
    </aside>
  )
}

export default Sidebar
