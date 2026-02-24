# NexForce

NexForce is a cloud gaming frontend concept inspired by premium game-streaming experiences.
The app now uses a data-driven architecture so games, plans, and key UI state are managed from JSON and reusable modules.

## What this site is for

- Present a cloud gaming brand and product message.
- Showcase a searchable game library and membership plans.
- Simulate launch flow with queue, latency, and FPS stats.
- Persist selected plan, billing cycle, and recent game in browser storage.

## Tech stack

- HTML5
- Tailwind CSS (CLI build)
- Vanilla JavaScript (ES modules)
- Local JSON data files as mock API source

## Project structure

```text
NexForce/
├── src/
│   └── tailwind.css
├── public/
│   ├── index.html
│   ├── library.html
│   ├── plans.html
│   ├── data/
│   │   ├── games.json
│   │   └── plans.json
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
│           └── plans.js
├── tailwind.config.js
├── package.json
└── README.md
```

## Phase 2 completed

- Data-driven UI from `public/data/games.json` and `public/data/plans.json`.
- Dynamic Home featured games section rendered from game data.
- Dynamic Library with search, genre filter, and minimum-plan filter.
- Dynamic Plans page with persisted monthly/yearly billing toggle.
- Shared app module for localStorage state and launch modal simulation.
- Roblox and Fortnite images wired into Library cards.

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

This repository is frontend-only for now. Real cloud streaming infrastructure (GPU orchestration, WebRTC media transport, auth, billing, and game entitlements) is not implemented yet.
