desktop app

run:

```sh
cd apps/desktop
npm install
npm run dev
```

build:

```sh
cd apps/desktop
npm run build
npm run build:mac
```

config:

```env
VITE_API_BASE_URL=https://platanus-hack-26-ar-team-6-copy-production.up.railway.app
VITE_ENABLE_HEALTHCHECK=true
```

`VITE_API_BASE_URL` is the fixed Relevo server URL. The app does not allow
users to edit it at runtime; rebuild/relaunch with a different env value to
point at another server.

Relevo login no longer uses `VITE_AUTH_TOKEN` or `VITE_USER_ID`. The app opens
Google login in the system browser, receives `relevo://auth/callback`, exchanges
the one-time code with the server, and stores the session in Electron
main-process settings. The raw session token is not exposed to the renderer.

Configure the Anthropic API key from the app's settings panel. It is encrypted
with Electron `safeStorage` when the OS supports it.

notes:

- logged-out state shows Google sign-in without asking for a server URL
- logged-in state shows projects; selecting or creating one enters the chat,
  leaders can delete projects, and the top bar can return to the selector
- each project must be connected to a local folder through the desktop folder
  picker before chat can run
- LangGraph runs `preflightRetriever`, `retriever`, `userAgent`, and `updater`
- the user agent can only ask the local `ask_retriever` tool for missing context
- the retriever calls `/agent-ctx` and `/global-ctx` with the selected project id
- the updater calls `/memory-updates` after checkpoints
- the runner uses the selected project's connected local folder as its working
  directory; `VITE_LOCAL_REPO_PATH` is only a deprecated fallback
- the health indicator checks `VITE_API_BASE_URL`

manual smoke:

1. start the server with Google OAuth configured
2. launch the desktop app
3. sign in through the browser
4. select or create a project and connect it to a local folder
5. configure the Anthropic key in settings
6. send a chat message and confirm memory checkpoint status appears
