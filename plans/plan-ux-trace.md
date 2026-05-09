# Plan: Collapsible Tool Trace + Memory Checkpoint Toast

**Branch:** `feat/ux-trace`

## Features

### 1. Collapsible Tool Trace
Currently tool calls (`tool_call`, `tool_status`, `tool_result`) are either hidden or always shown. Better UX: show a single collapsed row per tool call, expandable to see the full input/output.

**Renderer changes — `ChatView.tsx`:**
- Group consecutive tool events by `toolUseId` into a `ToolCallTrace` component
- Collapsed state: `[🔧 ask_retriever — 1.2s]` (click to expand)
- Expanded state: shows query, result count, and a summary snippet

```tsx
function ToolCallTrace({ events }: { events: LocalAssistantEvent[] }) {
  const [open, setOpen] = useState(false);
  const call = events.find(e => e.type === 'tool_call');
  const status = events.find(e => e.type === 'tool_status');
  const result = events.find(e => e.type === 'tool_result');
  return (
    <div className="tool-trace" onClick={() => setOpen(o => !o)}>
      <span className="tool-trace-header">
        🔧 {call?.toolName} {status?.elapsedTimeSeconds ? `— ${status.elapsedTimeSeconds.toFixed(1)}s` : ''}
      </span>
      {open && <pre className="tool-trace-body">{JSON.stringify(result?.result, null, 2)}</pre>}
    </div>
  );
}
```

### 2. Memory Checkpoint Toast
When a `memory_update` event with `status: "succeeded"` arrives, flash a small toast:
`✓ Memory saved (checkpoint #N)`

**Implementation:**
- Track `lastMemoryUpdate` in component state
- `useEffect` to auto-clear after 3s
- Absolute-positioned toast overlay, bottom-right

## CSS additions
```css
.tool-trace { cursor: pointer; padding: 4px 8px; border-left: 2px solid #555;
              margin: 4px 0; font-size: 0.8em; color: #aaa; }
.tool-trace:hover { border-color: #888; color: #ccc; }
.tool-trace-body { margin-top: 6px; font-size: 0.75em; max-height: 200px; overflow-y: auto; }
.memory-toast { position: fixed; bottom: 20px; right: 20px; background: #27ae60;
                color: #fff; padding: 8px 16px; border-radius: 6px; font-size: 0.85em;
                animation: fade-in-out 3s forwards; }
@keyframes fade-in-out { 0%,80%{opacity:1} 100%{opacity:0} }
```

## Priority: Medium (polish for demo)
