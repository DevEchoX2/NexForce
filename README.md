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
- Launch and play access now require sign-in (unauthenticated users are redirected to `profile.html`).
- Rig control "Time Left" is intentionally hidden until the user presses the 🙏 unlock button on the left side of `play.html`.
- Profile settings now include a **Streaming Transport** mode:
	- `Auto` (prefers WebRTC when available)
	- `Force WebRTC`
	- `Compatibility` (no WebRTC, for restricted school/work networks)

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

- Account auth (register/login) + session token endpoints
- Optional Postgres-backed auth/session/ticket persistence (`DATABASE_URL`)
- Plan checks for game access
- Session request queue and host allocation
- Session state endpoints (queued, active, disconnected, ended)

### Control-plane endpoints

- `GET /api/health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/control/summary`
- `POST /api/sessions/request`
- `GET /api/sessions/me`
- `POST /api/sessions/:sessionId/disconnect`
- `POST /api/sessions/:sessionId/reconnect`
- `POST /api/sessions/:sessionId/end`
- `POST /api/launch/ticket/verify`
- `GET /api/launch/service/rigs`
- `PUT /api/launch/service/rigs/:rigId/capacity` (host key required)
- `PUT /api/hosts/:hostId/stream-health` (host key required)
- `GET /api/stream/sessions/:sessionId/bootstrap` (user auth required)
- `GET /api/control/monitoring`
- `GET /api/metrics`
- `GET /api/control/autoscale`

Auth session TTL is configurable with `AUTH_SESSION_TTL_MS` (default: 7 days).
Session reconnect grace is configurable with `SESSION_RECONNECT_GRACE_MS` (default: 5 minutes).
Launch-service default rig capacity is configurable with `NEXFORCE_DEFAULT_RIG_CAPACITY` (default: 40 users per rig).
Launch-service ad policy is configurable with `NEXFORCE_ADS_PER_RIG_SESSION` (default: 15 video ads per rig session).
Host stream readiness gating is configurable with `NEXFORCE_REQUIRE_STREAM_HEALTH` (default: `true`).
Stripe checkout support for day passes + paid plans is configurable with:

- `STRIPE_SECRET_KEY`
- `STRIPE_PUBLISHABLE_KEY`
- `STRIPE_DAY_PASS_PRICE_ID` (optional; if omitted, server uses dynamic amount pricing)
- `STRIPE_PERFORMANCE_MONTHLY_PRICE_ID` (optional)
- `STRIPE_PERFORMANCE_YEARLY_PRICE_ID` (optional)
- `STRIPE_ULTIMATE_MONTHLY_PRICE_ID` (optional)
- `STRIPE_ULTIMATE_YEARLY_PRICE_ID` (optional)
- `STRIPE_WEBHOOK_SECRET` (required to verify Stripe webhook signatures)
- `NEXFORCE_DAY_PASS_PRICE_USD` (default: `7`)
- `NEXFORCE_DAY_PASS_DURATION_HOURS` (default: `24`)
- `NEXFORCE_PUBLIC_BASE_URL` (used for Stripe success/cancel redirects)

Payment endpoints:

- `GET /api/payments/config`
- `GET /api/payments/day-pass/status` (user auth required)
- `POST /api/payments/day-pass/checkout` (user auth required)
- `GET /api/payments/plans/status` (user auth required)
- `POST /api/payments/plans/checkout` (user auth required)

- `POST /api/payments/stripe/webhook` (expects raw JSON + Stripe signature header)

Recommended local testing flow:

```bash
stripe listen --forward-to http://localhost:5500/api/payments/stripe/webhook
```

Then copy the emitted signing secret into `STRIPE_WEBHOOK_SECRET`.

### Security + reliability hardening

- Secure launch tickets are HMAC-signed (`NEXFORCE_TICKET_SIGNING_KEY`) and can be verified via `POST /api/launch/ticket/verify`.
- API rate limiting is enabled with configurable buckets:
	- `RATE_LIMIT_API_WINDOW_MS` / `RATE_LIMIT_API_MAX`
	- `RATE_LIMIT_AUTH_WINDOW_MS` / `RATE_LIMIT_AUTH_MAX`
	- `RATE_LIMIT_SESSION_WINDOW_MS` / `RATE_LIMIT_SESSION_MAX`
- Monitoring endpoints:
	- `GET /api/control/monitoring` (JSON summary)
	- `GET /api/metrics` (Prometheus-style text)
	- `GET /api/control/autoscale` (queue/capacity scale-up recommendation)

### Session reliability + smarter placement

- Active sessions can temporarily transition to `disconnected` and recover through reconnect token flow.
- Disconnected sessions auto-expire to `ended` when reconnect window elapses (`reconnect_timeout`).
- `POST /api/sessions/request` now accepts optional `clientLatencyMsByRegion` map for latency-aware host selection.

### Postgres mode (optional)

Set `DATABASE_URL` to enable Postgres-backed persistence for:

- users
- auth sessions
- launch tickets

Tables are auto-created on startup by `server/postgres.js`.

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

### Step 3 split mode (separate orchestrator service)

You can run scheduler/placement as a separate backend process:

- Control API (without embedded scheduler):

```bash
npm run serve:control
```

- Orchestrator service:

```bash
npm run serve:orchestrator
```

Internal orchestrator endpoints on control API:

- `GET /internal/orchestrator/health` (`x-orchestrator-key` required)
- `POST /internal/orchestrator/tick` (`x-orchestrator-key` required)

Related env vars:

- `NEXFORCE_ORCHESTRATOR_EMBEDDED` (default: `true`)
- `NEXFORCE_ORCHESTRATOR_KEY` (default: `nexforce-orchestrator-key`)
- `CONTROL_API_URL` for orchestrator (default: `http://localhost:5500`)
- `ORCHESTRATOR_PORT` (default: `5600`)
- `ORCHESTRATOR_TICK_MS` (default: `5000`)

Fail-fast behavior in split mode:

- Scheduling-dependent endpoints return `503` with `code: scheduler_unavailable` if orchestrator ticks are stale.
- Freshness window is controlled by `NEXFORCE_SCHEDULER_GRACE_MS` (default: `15000`).

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

### Host.md quick-connect flow (prep now, host later)

1) Create local env files from templates:

```bash
cp .env.control.example .env.control
cp .env.host-agent.example .env.host-agent
```

2) In `.env.control`, set strong shared keys (`NEXFORCE_HOST_KEY`, `NEXFORCE_ORCHESTRATOR_KEY`) and your public base URL.

3) Start control API with that env loaded:

```bash
set -a && . ./.env.control && set +a && npm run serve:control
```

4) On the host PC, set `NEXFORCE_API_BASE_URL` in `.env.host-agent` to your live control API URL, keep the same `NEXFORCE_HOST_KEY`, then run:

```bash
set -a && . ./.env.host-agent && set +a && npm run host:agent
```

You can also run the host agent directly from env file using:

```bash
npm run host:agent:with-env
```

Host.md streaming presets are now available as one-command scripts:

- Stable 1080p60 preset:

```bash
npm run host:agent:1080p60
```

- Better quality 1440p60 preset:

```bash
npm run host:agent:1440p60
```

### Host agent environment variables

- `NEXFORCE_API_BASE_URL` (default: `http://localhost:5500`)
- `NEXFORCE_HOST_KEY` (default: `nexforce-host-key`)
- `NEXFORCE_AGENT_HOST_ID` (default: `host-<pid>`)
- `NEXFORCE_AGENT_HOST_NAME` (default: `NexForce Agent <hostId>`)
- `NEXFORCE_AGENT_REGION` (default: `local`)
- `NEXFORCE_AGENT_CAPACITY` (default: `40`)
- `NEXFORCE_AGENT_HEARTBEAT_MS` (default: `15000`)
- `NEXFORCE_AGENT_STREAM_SOFTWARE` (default: `sunshine`)
- `NEXFORCE_AGENT_STREAM_PROTOCOL` (default: `moonlight`)
- `NEXFORCE_AGENT_STREAM_REMOTE_NETWORK` (default: `tailscale`)
- `NEXFORCE_AGENT_STREAM_BACKUP_CONTROL` (default: `parsec`)
- `NEXFORCE_AGENT_AUDIO_READY` (default: `true`)
- `NEXFORCE_AGENT_NETWORK_OK` (default: `true`)
- `NEXFORCE_AGENT_NETWORK_TYPE` (default: `ethernet`)
- `NEXFORCE_AGENT_UPLINK_MBPS` (default: `100`)
- `NEXFORCE_AGENT_DOWNLINK_MBPS` (default: `100`)
- `NEXFORCE_AGENT_JITTER_MS` (default: `8`)
- `NEXFORCE_AGENT_PACKET_LOSS_PCT` (default: `0`)
- `NEXFORCE_AGENT_STREAM_RESOLUTION` (default: `1080p`)
- `NEXFORCE_AGENT_STREAM_FPS` (default: `60`)
- `NEXFORCE_AGENT_STREAM_BITRATE_MBPS` (default: `20`)
- `NEXFORCE_AGENT_STREAM_CODEC` (default: `hevc`)

## Step 5 (session lifecycle watchdog)

Step 5 is now implemented in the backend worker pipeline:

- Automatic max-duration enforcement per plan:
	- `free`: 30 minutes
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

## Integration phase started

Backend now includes real integration scaffolding to connect external game providers:

- `GET /api/integrations/providers`
- `GET /api/integrations/accounts`
- `POST /api/integrations/:provider/link`
- `DELETE /api/integrations/:provider/unlink`
- `POST /api/launch/ticket`

Current provider mapping:

- `fortnite` → `epic`
- `roblox` → `roblox`

`POST /api/launch/ticket` now enforces linked provider accounts for mapped games and returns a short-lived launch ticket payload with `launchUrl`.

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
