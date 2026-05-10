# Running the App: Production vs Demo

## Production (Railway)

The production server and database live on Railway. The desktop app points at the Railway URL by default.

### 1. Ensure `apps/desktop/.env` points at Railway

```
VITE_API_BASE_URL=https://platanus-hack-26-ar-team-6-copy-production-5a85.up.railway.app
```

### 2. Build and launch the desktop app

```bash
cd apps/desktop
npm install
npm run build   # or: npm run dev  for hot-reload
```

### 3. Log in via Google OAuth

Click "Sign in with Google" in the app. The Railway server handles the OAuth flow and creates a session.

### 4. Deploying server changes to Railway

Railway auto-deploys on push to `main`. If you need a manual deploy:

```bash
git push origin main
```

The server reads `DATABASE_URL` from the Railway environment automatically — no local config needed.

---

## Demo (local dummy database)

A self-contained demo environment with TMNT dummy data (Leonardo, Donatello, Michelangelo, Raphael
building an automated sewer cleanup product). Fully isolated from Railway. Resettable in ~10 seconds.

### Prerequisites

- Docker installed ([get.docker.com](https://get.docker.com))
- Python + `uv` (`pip install uv`)

### One-time setup

#### 1. Install Docker (if not already installed)

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# log out and back in for the group change to take effect
```

#### 2. Start local Postgres

```bash
cd infra && docker compose up -d
```

#### 3. Point the desktop app at the local server

In `apps/desktop/.env`:

```
# Comment out Railway:
# VITE_API_BASE_URL=https://platanus-hack-26-ar-team-6-copy-production-5a85.up.railway.app

# Use local server:
VITE_API_BASE_URL=http://localhost:8000
```

Rebuild the desktop app:

```bash
cd apps/desktop && npm run dev -- -- --no-sandbox
```

`--no-sandbox` is only for local Linux dev runs. Without it, Electron may abort
if `node_modules/electron/dist/chrome-sandbox` is not owned by root with mode
`4755`.

### Before each rehearsal

#### 4. Start the local server

```bash
cd apps/server
DATABASE_URL=postgresql://relevo:relevo@localhost:5432/relevo \
PORT=8000 \
  uv run python -m relevo
```

#### 5. Seed (or reset) the demo database

```bash
cd apps/server
DATABASE_URL=postgresql://relevo:relevo@localhost:5432/relevo \
  uv run python -m relevo.seeds.demo_loader
```

Wipes all runtime data and reloads the full TMNT snapshot (project, users, prompt history, memory
documents, task board, context exchanges). Takes ~10 seconds.

Optional flags:

| Flag | Effect |
|---|---|
| `--skip-schema` | Skip migration check (safe if schema hasn't changed, slightly faster) |
| `--no-backfill` | Skip vector chunk backfill (fastest, disables vector search) |
| `--database-url URL` | Override the Postgres connection string |

#### 6. Configure the desktop app for your demo user

```bash
# from repo root — local server must be running
python demo/setup_desktop.py leonardo
```

Available users: `leonardo`, `donatello`, `michelangelo`, `raphael`

Writes both known Linux Electron settings paths with the pre-seeded session token:
`~/.config/relevo/settings.json` for packaged builds and
`~/.config/@relevo/desktop/settings.json` for `npm run dev`. No Google OAuth needed.

#### 7. Launch the desktop app and demo

```bash
cd apps/desktop
npm run dev -- -- --no-sandbox
```

### Resetting between rehearsals

Repeat steps 5 and 6 only. Takes ~10 seconds.

### Switching back to production after the demo

1. Restore `apps/desktop/.env`:

```
VITE_API_BASE_URL=https://platanus-hack-26-ar-team-6-copy-production-5a85.up.railway.app
```

2. Rebuild the desktop app:

```bash
cd apps/desktop && npm run build
```

3. Log in normally via Google OAuth.

---

## Demo session tokens (reference)

| User | Token |
|---|---|
| Leonardo | `rlv_demo_leonardo_session_token` |
| Donatello | `rlv_demo_donatello_session_token` |
| Michelangelo | `rlv_demo_michelangelo_session_token` |
| Raphael | `rlv_demo_raphael_session_token` |

`setup_desktop.py` uses these automatically — you don't need to paste them manually.

---

## Verification

After seeding:

```bash
psql postgresql://relevo:relevo@localhost:5432/relevo \
  -c "SELECT display_name, role FROM app_user;"
# Leonardo (leader), Donatello, Michelangelo, Raphael

psql postgresql://relevo:relevo@localhost:5432/relevo \
  -c "SELECT COUNT(*) FROM agent_memory_event;"
# 16

# After a full demo run, reset, check again:
psql postgresql://relevo:relevo@localhost:5432/relevo \
  -c "SELECT COUNT(*) FROM agent_memory_event;"
# back to 16
```
