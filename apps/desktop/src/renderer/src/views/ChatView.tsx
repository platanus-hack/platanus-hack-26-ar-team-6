import CitationChip from '../components/CitationChip'
import messages from '../fixtures/messages.json'

type MessageFixture = {
  id: string
  author: string
  text: string
  citation:
    | {
        label: string
        tier: 'personal' | 'pool' | 'timeline'
      }
    | null
}

function ChatView(): React.JSX.Element {
  return (
    <section className="content-panel">
      {messages.map((message) => {
        const item = message as MessageFixture

        return (
          <div className="content-row" key={item.id}>
            <div className="content-row__title">{item.author}</div>
            <div>{item.text}</div>
            {item.citation ? (
              <div className="content-row__meta">
                <CitationChip label={item.citation.label} tier={item.citation.tier} />
              </div>
            ) : null}
          </div>
        )
      })}
    </section>
  )
}

export default ChatView
