# External Integrations — Ideas

Idea: let users connect third-party services so their data feeds automatically into the project context (memory system). The agent already queries context via `/agent-ctx` and `/global-ctx` — imported data would be stored there as additional memory entries.

---

## Services to integrate

### Google (Calendar + Drive/Docs)
**Auth:** Extend the existing Google OAuth flow — same `/auth/google/start` + `/auth/google/callback`, but request additional scopes and persist the tokens.

Scopes to add:
- `https://www.googleapis.com/auth/calendar.readonly`
- `https://www.googleapis.com/auth/drive.readonly`

Data to pull:
- Upcoming calendar events → fed as `kind: "calendar-event"` context entries
- Recent Docs / meeting notes → fed as `kind: "google-doc"` context entries

**What the agent gains:** awareness of meetings, deadlines, shared documents per user.

---

### Notion
**Auth:** Atlassian-style OAuth 2.0 — new routes `/auth/notion/start` + `/auth/notion/callback`.

Data to pull:
- Pages and databases the user shares with the integration
- Block content of selected pages

**What the agent gains:** project wikis, specs, decision logs, runbooks.

**Note:** Notion OAuth requires the user to explicitly select which pages/databases to share — the app needs a post-auth "select pages" step in the UI.

---

### Jira
**Auth:** Atlassian OAuth 2.0 (3LO) — new routes `/auth/jira/start` + `/auth/jira/callback`.

Atlassian scopes needed:
- `read:jira-work` — issues, projects, sprints
- `read:jira-user` — user info, assignees

Data to pull:
- Issues assigned to the user (open, in-progress)
- Recent activity on issues the user is watching
- Sprint contents for the current sprint

**What the agent gains:** current workload, blockers, ticket context — very useful for standup / handoff scenarios.

---

### Slack
**Auth:** Slack OAuth 2.0 (v2) — new routes `/auth/slack/start` + `/auth/slack/callback`. Requires creating a Slack App in the workspace.

Scopes needed (user token):
- `channels:history` — read messages from public channels
- `groups:history` — read messages from private channels the user is in
- `im:history` — direct messages
- `channels:read` / `groups:read` — list channels
- `users:read` — resolve user names

Data to pull:
- Recent messages from selected channels (last N messages or since last sync)
- Threads the user participated in or was mentioned in
- DMs relevant to the project (opt-in, privacy-sensitive)

**What the agent gains:** real-time team communication context — decisions made in chat, blockers mentioned, things that never make it into Jira/Notion.

**Note:** Slack message history can be very noisy. Recommended approach: let the user select which channels to sync, and only pull messages since the last sync timestamp. Consider summarizing channel history with the LLM before storing as a context entry rather than storing raw messages.

---

## Backend changes needed (server)

1. **New DB table: `account_integrations`**
   ```
   account_id  UUID
   provider    TEXT  (google | notion | jira | slack)
   access_token   TEXT
   refresh_token  TEXT (nullable)
   expires_at     TIMESTAMPTZ (nullable)
   scope          TEXT
   extra          JSONB  (e.g. Jira cloud_id, Notion workspace_id)
   ```

2. **Token refresh logic** — Google and Jira tokens expire; need background refresh or on-demand refresh before API calls.

3. **New API routes**
   - `GET /auth/{provider}/start` — redirect to provider OAuth
   - `GET /auth/{provider}/callback` — exchange code, store tokens
   - `DELETE /integrations/{provider}` — disconnect
   - `GET /integrations` — list connected integrations for the account
   - `POST /integrations/{provider}/sync` — on-demand pull + store as context entries

4. **Sync strategy options**
   - On-demand: user clicks "Sync now" in the UI → `POST /integrations/{provider}/sync`
   - Background: periodic job syncs all connected accounts (simpler for a hackathon: just on-demand)

---

## Frontend changes needed (desktop)

- Settings screen: "Connected Accounts" section showing Google / Notion / Jira tiles
- Connect / Disconnect buttons per provider
- Optional: Notion page picker after connecting
- Optional: Jira project filter (which projects to sync)
- "Last synced" timestamp per integration

---

## Context entry format (how data lands in memory)

Each imported item becomes a context entry with a structured `metadata` field so the agent can filter by source:

```json
{
  "kind": "jira-issue",
  "content": "[PROJ-123] Fix login bug — Status: In Progress, Assignee: you",
  "metadata": {
    "source": "jira",
    "issue_key": "PROJ-123",
    "status": "In Progress",
    "url": "https://..."
  }
}
```

Same pattern for `google-calendar-event`, `google-doc`, `notion-page`.

---

## Suggested order of implementation

1. **Jira** — most immediately useful for standup/handoff use cases, clean API
2. **Google Calendar** — easiest since OAuth is already built
3. **Slack** — high value for capturing decisions/context that never lands in tickets; needs channel picker + summarization
4. **Notion** — most complex (page picker UX, block parsing)