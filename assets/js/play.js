import { appState, initAuthShell, toTitle } from "./app.js";

const getGameFromQuery = () => {
  const params = new URLSearchParams(window.location.search);
  return params.get("game") || appState.activeGame || "Fortnite";
};

const slugFromGameName = (name) =>
  String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const runtimeProfiles = {
  fortnite: {
    label: "Target Rush",
    hint: "Click targets fast."
  },
  roblox: {
    label: "Orb Collector",
    hint: "Use WASD/Arrows to collect orbs."
  },
  default: {
    label: "Arcade Session",
    hint: "Use WASD/Arrows to collect orbs."
  }
};

const createRuntime = (gameSlug) => {
  const surface = document.querySelector("[data-play-surface]");
  const overlay = document.querySelector("[data-play-overlay]");
  const messageEl = document.querySelector("[data-bootstrap-message]");
  const fullscreenButton = document.querySelector("[data-enter-fullscreen]");

  if (!surface) {
    return;
  }

  const canvas = document.createElement("canvas");
  canvas.className = "h-full w-full";
  canvas.width = 960;
  canvas.height = 960;
  surface.prepend(canvas);

  const context = canvas.getContext("2d");
  const profile = runtimeProfiles[gameSlug] || runtimeProfiles.default;
  const state = {
    running: false,
    mode: gameSlug === "fortnite" ? "target" : "collector",
    score: 0,
    player: { x: 480, y: 480, radius: 18, speed: 360 },
    orb: { x: 240, y: 220, radius: 12 },
    target: { x: 620, y: 320, radius: 26, vx: 170, vy: 150 },
    keys: new Set(),
    rafId: 0,
    previousTime: 0
  };

  const setMessage = (message) => {
    if (messageEl) {
      messageEl.textContent = message;
    }
  };

  const setStatus = (status) => {
    const statusEl = document.querySelector("[data-session-status]");
    if (statusEl) {
      statusEl.textContent = status;
    }
  };

  const randomOrb = () => {
    state.orb.x = Math.floor(Math.random() * 820) + 70;
    state.orb.y = Math.floor(Math.random() * 820) + 70;
  };

  const drawCollector = () => {
    context.fillStyle = "#05070d";
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.fillStyle = "#22d3ee";
    context.beginPath();
    context.arc(state.orb.x, state.orb.y, state.orb.radius, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = "#39ff14";
    context.beginPath();
    context.arc(state.player.x, state.player.y, state.player.radius, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = "rgba(255,255,255,0.85)";
    context.font = "600 20px Inter";
    context.fillText(`${profile.label} • Score ${state.score}`, 24, 34);
    context.fillStyle = "rgba(180,190,210,0.85)";
    context.font = "500 15px Inter";
    context.fillText(profile.hint, 24, 58);
  };

  const drawTarget = () => {
    context.fillStyle = "#070914";
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.strokeStyle = "#39ff14";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(canvas.width / 2 - 16, canvas.height / 2);
    context.lineTo(canvas.width / 2 + 16, canvas.height / 2);
    context.moveTo(canvas.width / 2, canvas.height / 2 - 16);
    context.lineTo(canvas.width / 2, canvas.height / 2 + 16);
    context.stroke();

    context.fillStyle = "#22d3ee";
    context.beginPath();
    context.arc(state.target.x, state.target.y, state.target.radius, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = "rgba(255,255,255,0.85)";
    context.font = "600 20px Inter";
    context.fillText(`${profile.label} • Score ${state.score}`, 24, 34);
    context.fillStyle = "rgba(180,190,210,0.85)";
    context.font = "500 15px Inter";
    context.fillText(profile.hint, 24, 58);
  };

  const tickCollector = (delta) => {
    const speed = state.player.speed * delta;
    if (state.keys.has("arrowup") || state.keys.has("w")) state.player.y -= speed;
    if (state.keys.has("arrowdown") || state.keys.has("s")) state.player.y += speed;
    if (state.keys.has("arrowleft") || state.keys.has("a")) state.player.x -= speed;
    if (state.keys.has("arrowright") || state.keys.has("d")) state.player.x += speed;

    state.player.x = clamp(state.player.x, state.player.radius, canvas.width - state.player.radius);
    state.player.y = clamp(state.player.y, state.player.radius, canvas.height - state.player.radius);

    const distance = Math.hypot(state.player.x - state.orb.x, state.player.y - state.orb.y);
    if (distance <= state.player.radius + state.orb.radius) {
      state.score += 1;
      randomOrb();
    }
  };

  const tickTarget = (delta) => {
    state.target.x += state.target.vx * delta;
    state.target.y += state.target.vy * delta;

    if (state.target.x <= state.target.radius || state.target.x >= canvas.width - state.target.radius) {
      state.target.vx *= -1;
      state.target.x = clamp(state.target.x, state.target.radius, canvas.width - state.target.radius);
    }

    if (state.target.y <= state.target.radius || state.target.y >= canvas.height - state.target.radius) {
      state.target.vy *= -1;
      state.target.y = clamp(state.target.y, state.target.radius, canvas.height - state.target.radius);
    }
  };

  const loop = (time) => {
    if (!state.previousTime) {
      state.previousTime = time;
    }
    const delta = Math.min(0.05, (time - state.previousTime) / 1000);
    state.previousTime = time;

    if (state.running) {
      if (state.mode === "collector") {
        tickCollector(delta);
      } else {
        tickTarget(delta);
      }
    }

    if (state.mode === "collector") {
      drawCollector();
    } else {
      drawTarget();
    }

    state.rafId = requestAnimationFrame(loop);
  };

  const start = async () => {
    if (!document.fullscreenElement && surface.requestFullscreen) {
      try {
        await surface.requestFullscreen();
      } catch {
        setMessage("Allow fullscreen to start playing.");
        return;
      }
    }

    state.running = true;
    setStatus("Playing");
    if (overlay) {
      overlay.classList.add("hidden");
    }
    if (fullscreenButton) {
      fullscreenButton.textContent = "Playing";
    }
  };

  fullscreenButton?.addEventListener("click", () => {
    start();
  });

  document.addEventListener("fullscreenchange", () => {
    const inFullscreen = document.fullscreenElement === surface;
    if (!inFullscreen && state.running) {
      state.running = false;
      setStatus("Paused");
      if (overlay) {
        overlay.classList.remove("hidden");
      }
      setMessage("Paused. Enter fullscreen to resume playing.");
      if (fullscreenButton) {
        fullscreenButton.textContent = "Enter Fullscreen";
      }
    }
  });

  window.addEventListener("keydown", (event) => {
    state.keys.add(event.key.toLowerCase());
  });

  window.addEventListener("keyup", (event) => {
    state.keys.delete(event.key.toLowerCase());
  });

  if (state.mode === "target") {
    canvas.addEventListener("click", (event) => {
      if (!state.running) {
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = (event.clientX - rect.left) * scaleX;
      const y = (event.clientY - rect.top) * scaleY;
      const distance = Math.hypot(x - state.target.x, y - state.target.y);

      if (distance <= state.target.radius) {
        state.score += 1;
        state.target.x = Math.floor(Math.random() * 820) + 70;
        state.target.y = Math.floor(Math.random() * 820) + 70;
      }
    });
  }

  randomOrb();
  setStatus("Ready");
  setMessage("Enter fullscreen and press the button to play.");
  state.rafId = requestAnimationFrame(loop);
};

const init = () => {
  initAuthShell();

  const game = getGameFromQuery();
  appState.activeGame = game;
  appState.recentGame = game;

  document.querySelectorAll("[data-game-name]").forEach((element) => {
    element.textContent = game;
  });

  const planEl = document.querySelector("[data-plan-name]");
  if (planEl) {
    planEl.textContent = toTitle(appState.selectedPlan);
  }

  const gameSlug = slugFromGameName(game);
  createRuntime(gameSlug);
};

init();
