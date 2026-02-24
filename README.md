# NexForce

NexForce is a cloud gaming frontend concept inspired by premium game-streaming experiences.
The project is currently frontend-only, with static JSON data and browser persistence for demos.

## What this site is for

- Present a cloud gaming brand and product message.
- Showcase a searchable game library and membership plans.
- Run demo authentication and profile settings in-browser.
- Simulate launch estimates (queue, latency, FPS) on the client.

## Tech stack

- HTML5
- Tailwind CSS (CLI build)
- Vanilla JavaScript (ES modules)
- Static JSON data files
- Browser localStorage for session-like state

## Project structure

```text
NexForce/
├── src/
│   └── tailwind.css
├── public/
│   ├── index.html
│   ├── library.html
│   ├── plans.html
│   ├── profile.html
│   ├── data/
│   │   ├── games.json
│   │   ├── plans.json
│   │   └── mock-user.json
│   └── assets/
│       ├── css/
│       │   └── main.css
│       ├── images/
│       │   ├── fortnite.png
│       │   └── roblox.png
│       └── js/
│           ├── app.js
│           ├── home.js
│           ├── library.js
│           ├── plans.js
│           └── profile.js
├── tailwind.config.js
├── package.json
└── README.md
```

## What works now

- Games and plans render from static JSON files.
- Demo sign-in/profile state uses browser localStorage.
- Featured games, library filters, and pricing toggle are fully functional.
- Launch modal queue/latency/FPS simulation runs client-side.
- When queue reaches launch state, the app transitions to `play.html` as the in-session surface.

## Run locally

Install dependencies:

```bash
npm install
```

Build CSS:

```bash
npm run build:css
```

Watch CSS while editing:

```bash
npm run watch:css
```

Start local static server:

```bash
npm run serve:static
```

Open:

`http://localhost:5500`

## Notes

This is currently a frontend MVP. Real cloud streaming infrastructure and production backend services can be added in a later phase.

## Step 1 backend (control plane)

Step 1 is now available in `server/` as a local/VPS-ready control plane (no Railway required):

- Auth/session token endpoints
- Plan checks for game access
- Session request queue and host allocation
- Session state endpoints (queued, active, ended)

### Control-plane endpoints

- `GET /api/health`
- `POST /api/auth/demo-login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/control/summary`
- `POST /api/sessions/request`
- `GET /api/sessions/me`
- `POST /api/sessions/:sessionId/end`

### Step 2 (prototype host integration) endpoints

- `GET /api/hosts` (user auth required)
- `POST /api/hosts/register` (host key required)
- `POST /api/hosts/:hostId/heartbeat` (host key required)
- `POST /api/hosts/:hostId/offline` (host key required)

Use header: `x-host-key: nexforce-host-key` (or override via `NEXFORCE_HOST_KEY`).

Step 2 currently includes:

- Host register/online/offline and heartbeat updates
- Host timeout auto-offline (`HOST_HEARTBEAT_TIMEOUT_MS`, default 45000)
- Queue promotion by plan priority (`ultimate` > `performance` > `free`) then FIFO within same tier
- Basic host load-aware assignment (lowest utilization first)

## Step 3 (matchmaker worker + operations)

Step 3 is now implemented with a continuous background worker:

- Periodic matchmaker tick loop (`MATCHMAKER_TICK_MS`, default 5000)
- Automatic reconciliation of stale hosts and active sessions
- Non-overlapping tick execution guard
- Worker runtime telemetry (tick counts, duration, last write, last error)
- Manual admin tick trigger for operational recovery/testing

### Step 3 control endpoints

- `GET /api/control/worker` (user auth required)
- `POST /api/control/worker/tick` (user auth required)

## Step 4 (host agent daemon)

Step 4 adds a runnable host daemon at `server/host-agent.js`:

- Registers itself to `/api/hosts/register` on startup
- Sends periodic heartbeats to `/api/hosts/:hostId/heartbeat`
- Marks host offline on `SIGINT`/`SIGTERM` via `/api/hosts/:hostId/offline`
- Uses environment variables so each VPS node can run its own unique host identity

### Run host agent

```bash
npm run host:agent
```

### Host agent environment variables

- `NEXFORCE_API_BASE_URL` (default: `http://localhost:5500`)
- `NEXFORCE_HOST_KEY` (default: `nexforce-host-key`)
- `NEXFORCE_AGENT_HOST_ID` (default: `host-<pid>`)
- `NEXFORCE_AGENT_HOST_NAME` (default: `NexForce Agent <hostId>`)
- `NEXFORCE_AGENT_REGION` (default: `local`)
- `NEXFORCE_AGENT_CAPACITY` (default: `1`)
- `NEXFORCE_AGENT_HEARTBEAT_MS` (default: `15000`)

### Run Step 1 backend locally

```bash
npm install
npm run serve
```

Then use a REST client or curl to test the queue flow.
