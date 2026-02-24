# NexForce

NexForce is a cloud gaming frontend concept inspired by premium game-streaming experiences.
It focuses on a clean UI, fast navigation, and cloud-session style interactions.

## What this site is for

- Present a cloud gaming brand and product message.
- Showcase a game library and membership plans.
- Simulate a launch flow with queue, latency, and FPS stats.

## Tech stack

- HTML5
- Tailwind CSS (CLI build)
- Vanilla JavaScript

## Project structure

```text
NexForce/
├── src/
│   └── tailwind.css
├── public/
│   ├── index.html
│   ├── library.html
│   ├── plans.html
│   └── assets/
│       ├── css/
│       │   └── main.css
│       └── js/
│           └── main.js
├── tailwind.config.js
├── package.json
└── README.md
```

## Phase 1 completed

- Tailwind build pipeline (no CDN runtime generation).
- Multi-page flow: Home, Library, Plans.
- Game placeholders ready for images:
  - Roblox
  - Fortnite
  - Fall Guys
  - Rocket League
- Launch modal simulator with dynamic queue, latency, and FPS values.
- Billing toggle on plans page (monthly/yearly display).

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

Start local server:

```bash
npm run serve
```

Open:

`http://localhost:5500`

## Notes

This repository is currently frontend-only. Real cloud streaming infrastructure (GPU orchestration, WebRTC streaming backend, auth, billing, and game entitlement systems) is not implemented yet.
