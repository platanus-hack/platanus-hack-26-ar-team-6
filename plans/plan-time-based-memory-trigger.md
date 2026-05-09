# Plan: Time-Based Memory Update Trigger

**Branch:** `feat/time-based-memory-trigger`
**Status:** Implemented ✓

## Problem
Previously the updater fired every 6 messages (`MEMORY_UPDATE_MESSAGE_THRESHOLD = 6`). A single deep "explain this codebase" exchange should be saved immediately, but five quick one-liners shouldn't trigger a checkpoint.

## New Rule
Update when **≥ 3 minutes have passed since the last checkpoint** AND **≥ 2 new messages since the last checkpoint**. Hard cap at 10 new messages regardless of time.

## Changes — `apps/desktop/src/agentGraph.ts`

### New Constants
```typescript
const CHECKPOINT_MIN_ELAPSED_MS = 3 * 60 * 1000;  // 3 minutes
const CHECKPOINT_MIN_NEW_MESSAGES = 2;
const CHECKPOINT_HARD_CAP_MESSAGES = 10;
```

### New State Fields
```typescript
conversationStartedAt: Annotation<number>()   // unix ms, set once at graph start
lastCheckpointAt: Annotation<number | null>() // unix ms of last successful checkpoint
lastCheckpointMessageCount: Annotation<number>() // message count at last checkpoint
```

### New `shouldRunUpdater` Logic
```typescript
function shouldRunUpdater(state: AgentNetworkState, now: number): boolean {
  const newMessages = state.conversationMessages.length - state.lastCheckpointMessageCount;
  if (newMessages < CHECKPOINT_MIN_NEW_MESSAGES) return false;
  if (newMessages >= CHECKPOINT_HARD_CAP_MESSAGES) return true;
  const elapsed = now - (state.lastCheckpointAt ?? state.conversationStartedAt);
  return elapsed >= CHECKPOINT_MIN_ELAPSED_MS;
}
```

### Updater Success Path
On success, records `lastCheckpointAt` and `lastCheckpointMessageCount` so the next turn calculates elapsed time correctly.

## Verification
1. 2 messages quickly → `updater:skip` in logs
2. Wait 3+ min, 2 messages → `updater:start` fires
3. 10 rapid messages → updater fires on 10th regardless of time
