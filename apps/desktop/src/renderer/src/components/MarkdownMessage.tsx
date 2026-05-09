import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

type Props = { text: string }

export default function MarkdownMessage({ text }: Props) {
  return (
    <ReactMarkdown
      components={{
        code({ className, children, ...rest }) {
          const match = /language-(\w+)/.exec(className ?? '')
          if (!match) {
            return (
              <code className="md-inline-code" {...rest}>
                {children}
              </code>
            )
          }
          return (
            <SyntaxHighlighter
              style={oneDark}
              language={match[1]}
              PreTag="div"
              className="md-code-block"
            >
              {String(children).replace(/\n$/, '')}
            </SyntaxHighlighter>
          )
        },
        p({ children }) {
          return <p className="chat-msg__paragraph">{children}</p>
        },
        pre({ children }) {
          // We intercept at the code level above, so unwrap the pre wrapper
          return <>{children}</>
        },
      }}
    >
      {text}
    </ReactMarkdown>
  )
}
