import { useEffect, useState } from 'react'

const WORDS = [
  'thinking',
  'pondering',
  'reasoning',
  'analyzing',
  'reflecting',
  'processing',
  'synthesizing',
  'considering',
]

export default function ThinkingIndicator() {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % WORDS.length)
    }, 1800)
    return () => clearInterval(timer)
  }, [])

  return (
    <span key={index} className="thinking-word">
      {WORDS[index]}
    </span>
  )
}
