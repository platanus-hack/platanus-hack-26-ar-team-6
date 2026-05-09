to run:

```shell
cd apps/desktop
npm install
npm run dev
```

the packaged app uses `VITE_API_BASE_URL` for the fixed Relevo server URL and
persisted settings for the Relevo login session, selected project, and Anthropic
key. It does not need `VITE_AUTH_TOKEN` or `VITE_USER_ID`.
