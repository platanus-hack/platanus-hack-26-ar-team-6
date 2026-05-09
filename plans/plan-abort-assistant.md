# Plan: Abort Running Assistant

**Branch:** `feat/abort-assistant`

## Problem
Once a run starts there's no way to stop it. The generator runs to completion even if the user navigates away or wants to cancel, wasting API tokens and blocking the input.

## Changes

### 1. AbortController in Main — `apps/desktop/src/main/index.ts`
```typescript
let currentAbortController: AbortController | null = null;

ipcMain.handle('assistant:abort', () => {
  currentAbortController?.abort();
  currentAbortController = null;
});

// Inside assistant:run handler:
currentAbortController = new AbortController();
const { signal } = currentAbortController;

for await (const event of stream) {
  if (signal.aborted) break;
  event_window.webContents.send('assistant:event', event);
}
currentAbortController = null;
```

### 2. Preload Bridge — `apps/desktop/src/preload/index.ts`
```typescript
abortAssistantRun: () => ipcRenderer.invoke('assistant:abort'),
```

### 3. Stop Button — `apps/desktop/src/renderer/src/views/ChatView.tsx`
Show a "Stop" button while `isLoading` is true:
```tsx
{isLoading && (
  <button className="stop-btn" onClick={() => window.api.abortAssistantRun()}>
    Stop
  </button>
)}
```

### 4. CSS
```css
.stop-btn { background: #c0392b; color: #fff; border: none; border-radius: 4px;
            padding: 4px 12px; cursor: pointer; }
.stop-btn:hover { background: #e74c3c; }
```

## Verification
- Start a long prompt → click Stop → stream stops, input re-enables
- Start a new run after abort → works normally
- Abort with no active run → no crash

## Priority: Medium (demo usability)
