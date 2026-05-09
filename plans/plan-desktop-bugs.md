# Plan: Desktop Bug Fixes

**Branch:** `feat/desktop-bugs`

## Bugs

### 1. IPC Crash — `apps/desktop/src/main/index.ts`
The `assistant:run` IPC handler iterates over the async generator but has no top-level try/catch. An unhandled error in the generator kills the main process or hangs the renderer indefinitely.

**Fix:** wrap the `for await` loop in try/catch and emit an `error` event back to the renderer:
```typescript
try {
  for await (const event of stream) {
    event_window.webContents.send('assistant:event', event);
  }
} catch (err) {
  event_window.webContents.send('assistant:event', {
    type: 'error',
    message: err instanceof Error ? err.message : String(err),
  });
}
```

### 2. `isToolCallInput` Type Guard — `apps/desktop/src/runner.ts`
Current guard checks `typeof input === 'object'` but doesn't check for `null`, so `isToolCallInput(null)` returns `true` and crashes downstream.

**Fix:**
```typescript
function isToolCallInput(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === 'object' && !Array.isArray(input);
}
```

### 3. `toolUseId` Null Propagation
Several `tool_call` events emit `toolUseId: undefined`. The renderer tries to match them by ID for `tool_result` events and silently drops context. Emit a stable fallback ID:
```typescript
toolUseId: block.id ?? `tool-${Date.now()}`,
```

## Verification
- Kill the server mid-run → renderer should show error message, not hang
- Pass `null` as tool input → no crash
- Tool call / result pairing shows up correctly in the tool trace

## Priority: High (crash risk in production demo)
