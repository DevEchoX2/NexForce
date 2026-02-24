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
- `PUT /api/hosts/:hostId/capabilities` (host key required)
- `PUT /api/hosts/:hostId/mode` (host key required)
- `PUT /api/hosts/:hostId/policy` (host key required)

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
- `GET /api/control/scheduler` (user auth required)
- `GET /api/control/scheduler/events` (user auth required)
- `PUT /api/control/scheduler/policy` (user auth required)
- `POST /api/control/scheduler/metrics/reset` (user auth required)

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

## Step 5 (session lifecycle watchdog)

Step 5 is now implemented in the backend worker pipeline:

- Automatic max-duration enforcement per plan:
	- `free`: 1 hour
	- `performance`: 6 hours
	- `ultimate`: 8 hours
- Timed-out sessions are ended with `endReason: session_timeout`
- Timed-out capacity is reclaimed and queue promotion runs on the same tick
- Session responses now include runtime metadata:
	- `maxDurationSec`
	- `remainingSec` (for active sessions)

Step 5 runs through the existing Step 3 worker tick loop and also applies when session/control endpoints trigger queue promotion.

## Step 6 (host-agent resilience)

Step 6 hardens `server/host-agent.js` for unstable networks/process restarts:

- Exponential backoff + jitter for API health/register retries
- Optional API readiness wait on startup before registration
- Non-overlapping heartbeat execution guard
- Automatic host re-registration after consecutive heartbeat failures

### Step 6 host-agent environment variables

- `NEXFORCE_AGENT_RETRY_BASE_MS` (default: `1000`)
- `NEXFORCE_AGENT_RETRY_MAX_MS` (default: `15000`)
- `NEXFORCE_AGENT_REGISTER_MAX_RETRIES` (default: `10`, set `-1` for infinite)
- `NEXFORCE_AGENT_HEARTBEAT_FAILURE_THRESHOLD` (default: `3`)
- `NEXFORCE_AGENT_WAIT_FOR_API_ON_STARTUP` (default: `true`)

## Step 7 (capability-aware scheduling)

Step 7 upgrades matchmaking from load-only to compatibility-aware placement:

- Hosts now carry scheduling metadata:
	- `mode`: `active` | `draining` | `maintenance`
	- `capabilities.supportedGames`
	- `capabilities.gpuTier` (`basic` | `performance` | `ultimate`)
	- `capabilities.maxFps`
- Scheduler assigns sessions only to compatible `active` hosts and ranks by:
	- region match (when `preferredRegion` is provided)
	- lowest utilization
	- freshest heartbeat
- Session assignment now records `assignedBy` for scheduling traceability.

### Step 7 request update

- `POST /api/sessions/request` supports optional `preferredRegion`.

### Step 7 host-agent environment variables

- `NEXFORCE_AGENT_MODE` (default: `active`)
- `NEXFORCE_AGENT_GPU_TIER` (default: `basic`)
- `NEXFORCE_AGENT_MAX_FPS` (default: `60`)
- `NEXFORCE_AGENT_SUPPORTED_GAMES` (default: empty, comma-separated slugs)

## Step 8 (fair queue + user concurrency)

Step 8 adds queue fairness and configurable per-user limits:

- Per-user active session limit (`maxActiveSessionsPerUser`)
- Per-user queued session limit (`maxQueuedSessionsPerUser`)
- Queue aging boost to reduce starvation (`agingBoostMinutes`, `agingBoostPerStep`)

## Step 9 (scheduler metrics)

Step 9 adds scheduler observability counters:

- Total queued/assigned/timed-out sessions
- Rejection counters by reason (`concurrency_limit`, `plan_restricted`, `no_capacity`)
- Per-plan wait-time aggregates (`waitByPlanSec`)

## Step 10 (host slot policy)

Step 10 adds host-level reserved capacity policy for plan-aware admission:

- `slotPolicy.freeReservedMin`
- `slotPolicy.performanceReservedMin`
- `slotPolicy.ultimateReservedMin`

Hosts can enforce reserved headroom for higher tiers while still using compatibility + region-aware scheduling.

## Step 11 (scheduler audit events)

Step 11 adds scheduler audit logs (`schedulerEvents`) for operations traceability:

- Queue join
- Assignment
- Session timeout
- Host mode/capability/policy updates
- Scheduler policy updates and metrics resets

## Step 12 (runtime policy controls)

Step 12 adds runtime policy control endpoints:

- Update scheduler policy via `PUT /api/control/scheduler/policy`
- Inspect policy + metrics via `GET /api/control/scheduler`
- Fetch audit history via `GET /api/control/scheduler/events?limit=...`
- Reset counters via `POST /api/control/scheduler/metrics/reset`

## Step 13 (playable runtime) — final roadmap step

Step 13 completes the current roadmap by replacing the old play placeholder with a real in-browser runtime in `play.html`:

- Instant playable session surface after launch handoff
- Game-mode routing by selected title (`Roblox` → collector mode, `Fortnite` → target mode)
- Live HUD with score, timer, and runtime controls (start/reset)

This closes the current implementation roadmap at Step 13.

### Important boundary

Running official Roblox/Fortnite cloud streams requires external proprietary platform integrations and licensing. Current implementation provides a real playable in-browser runtime so launches are functional while those external integrations are pending.

### Step 10 host-agent environment variables

- `NEXFORCE_AGENT_FREE_RESERVED_MIN` (default: `0`)
- `NEXFORCE_AGENT_PERFORMANCE_RESERVED_MIN` (default: `0`)
- `NEXFORCE_AGENT_ULTIMATE_RESERVED_MIN` (default: `0`)

### Run Step 1 backend locally

```bash
npm install
npm run serve
```

Then use a REST client or curl to test the queue flow.
