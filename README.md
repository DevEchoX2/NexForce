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

### Run Step 1 backend locally

```bash
npm install
npm run serve
```

Then use a REST client or curl to test the queue flow.
