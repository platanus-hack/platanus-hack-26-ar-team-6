desktop app

run:

```sh
cd apps/desktop
npm install
npm run dev
```

config:

create `apps/desktop/.env` from `apps/desktop/.env.example`.

required vars:

```env
VITE_API_BASE_URL=https://platanus-hack-26-ar-team-6-production-75c7.up.railway.app
VITE_ENABLE_HEALTHCHECK=true
VITE_USER_ID=b1a0c7d9-9fce-4f76-afec-e0ac8eff4180
VITE_AUTH_TOKEN=dev-token-user1
VITE_LOCAL_REPO_PATH=/absolute/path/to/your/repo
```

notes:

- the app calls `/bootstrap` on launch using `VITE_AUTH_TOKEN`
- the chat saves `{prompt, final_answer}` through `/context-entries`
- the runner uses `VITE_LOCAL_REPO_PATH` as its working directory
- the health indicator uses `VITE_API_BASE_URL/health`

manual smoke:

1. start the app with the user1 token and user1 uuid above
2. confirm the top bar shows:
   - `bootstrap: live`
   - `status: online`
3. confirm the sidebar shows:
   - `User1 (Frontend)` with `you`
   - `User2 (Deployment)`
4. send this locked v2 prompt from [seeds/LOCK.md](/Users/maria/IdeaProjects/platanus-hack-26-ar-team-6/seeds/LOCK.md:12):

```text
How is the shared server deployed, what auth does the local app use, and what health endpoint should I check before the demo?
```

5. confirm the trace shows:
   - `request_context`
   - target `User2 (Deployment)`
   - a running state
   - a succeeded state with an answer preview
6. confirm the final assistant answer appears once, without duplicated streamed text
7. confirm the chat shows `saved`
