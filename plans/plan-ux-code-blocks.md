# Plan: Code Block Rendering

**Branch:** `feat/code-block-rendering`

## Problem
Assistant responses with fenced code blocks (` ```python ... ``` `) render as raw text. This is a demo blocker since the assistant regularly outputs code.

## Changes

### 1. Add Markdown Renderer — `apps/desktop/src/renderer/src/views/ChatView.tsx`
Install `react-markdown` and `react-syntax-highlighter`:
```
npm install react-markdown react-syntax-highlighter
npm install -D @types/react-syntax-highlighter
```

Replace plain `<p>{msg.text}</p>` with:
```tsx
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

<ReactMarkdown
  components={{
    code({ inline, className, children }) {
      const lang = /language-(\w+)/.exec(className ?? '')?.[1];
      return !inline && lang ? (
        <SyntaxHighlighter style={oneDark} language={lang} PreTag="div">
          {String(children).replace(/\n$/, '')}
        </SyntaxHighlighter>
      ) : (
        <code className={className}>{children}</code>
      );
    },
  }}
>
  {msg.text}
</ReactMarkdown>
```

### 2. CSS — `apps/desktop/src/renderer/src/assets/main.css`
```css
.message-bubble pre { margin: 0; border-radius: 6px; overflow-x: auto; }
.message-bubble code { font-family: 'JetBrains Mono', monospace; font-size: 0.85em; }
.message-bubble p { margin: 0 0 0.5em; }
.message-bubble p:last-child { margin-bottom: 0; }
```

## Verification
- Send "write a python hello world" → code block renders with syntax highlighting
- Send plain text → no regression in formatting
- Long code blocks scroll horizontally

## Priority: High (demo quality)
