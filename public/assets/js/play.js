import { appState, initAuthShell, toTitle } from "./app.js";
import { TRANSPORT_MODES, resolveTransportMode } from "./settings.js";

const getGameFromQuery = () => {
  const params = new URLSearchParams(window.location.search);
  return params.get("game") || appState.activeGame || "Fortnite";
};

const runtimeProfiles = {
  fortnite: {
    label: "Target Rush",
    help: "Click moving targets before time runs out.",
    durationSec: 60,
    mode: "shooter"
  },
  roblox: {
    label: "Orb Collector",
    help: "Use WASD or Arrow keys to move and collect nodes.",
    durationSec: 60,
    mode: "collector"
  },
  default: {
    label: "Arcade Runtime",
    help: "Use WASD or Arrow keys to move and collect nodes.",
    durationSec: 60,
    mode: "collector"
  }
};

const slugFromGameName = (name) =>
  String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const createRuntime = (profile) => {
  const canvas = document.querySelector("[data-game-canvas]");
  const stage = document.querySelector("[data-runtime-stage]");
  if (!canvas) {
    return { start: () => {}, reset: () => {} };
  }

  const startBtn = document.querySelector("[data-runtime-start]");
  const resetBtn = document.querySelector("[data-runtime-reset]");
  const overlay = document.querySelector("[data-runtime-overlay]");
  const scoreEl = document.querySelector("[data-runtime-score]");
  const timeEl = document.querySelector("[data-runtime-time]");
  const modeEl = document.querySelector("[data-runtime-mode]");
  const helpEl = document.querySelector("[data-runtime-help]");

  if (modeEl) modeEl.textContent = profile.label;
  if (helpEl) helpEl.textContent = profile.help;

  const context = canvas.getContext("2d");
  canvas.width = 1280;
  canvas.height = 720;

  const state = {
    started: false,
    ended: false,
    score: 0,
    endAt: 0,
    remainingMs: profile.durationSec * 1000,
    keys: new Set(),
    player: { x: 640, y: 360, radius: 20, speed: 430 },
    orb: { x: 250, y: 220, radius: 14 },
    target: { x: 620, y: 260, radius: 28, vx: 210, vy: 170 },
    rafId: 0,
    previousTime: 0
  };

  const updateHud = () => {
    if (scoreEl) scoreEl.textContent = String(state.score);
    const remainingMs = state.started ? Math.max(0, state.endAt - performance.now()) : state.remainingMs;
    const remaining = Math.max(0, Math.ceil(remainingMs / 1000));
    if (timeEl) timeEl.textContent = `${remaining}s`;
  };

  const isFullscreen = () => document.fullscreenElement === stage || document.fullscreenElement === canvas;

  const randomOrb = () => {
    state.orb.x = Math.floor(Math.random() * (canvas.width - 100)) + 50;
    state.orb.y = Math.floor(Math.random() * (canvas.height - 100)) + 50;
  };

  const resetState = () => {
    state.started = false;
    state.ended = false;
    state.score = 0;
    state.remainingMs = profile.durationSec * 1000;
    state.player.x = 640;
    state.player.y = 360;
    state.target.x = 620;
    state.target.y = 260;
    state.target.vx = 210;
    state.target.vy = 170;
    randomOrb();
    if (overlay) overlay.textContent = "Fullscreen is required. Press Start to enter fullscreen and begin.";
    if (overlay) overlay.classList.remove("hidden");
    if (startBtn) startBtn.textContent = "Start";
    updateHud();
  };

  const endRun = () => {
    state.started = false;
    state.ended = true;
    state.remainingMs = 0;
    if (overlay) {
      overlay.textContent = `Session complete. Final score: ${state.score}`;
      overlay.classList.remove("hidden");
    }
    if (startBtn) startBtn.textContent = "Restart";
  };

  const drawCollector = () => {
    context.fillStyle = "#06090f";
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.fillStyle = "#22d3ee";
    context.beginPath();
    context.arc(state.orb.x, state.orb.y, state.orb.radius, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = "#39ff14";
    context.beginPath();
    context.arc(state.player.x, state.player.y, state.player.radius, 0, Math.PI * 2);
    context.fill();
  };

  const drawShooter = () => {
    context.fillStyle = "#0a0b13";
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

  const tickShooter = (delta) => {
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

    if (state.started && !state.ended) {
      if (profile.mode === "collector") {
        tickCollector(delta);
      } else {
        tickShooter(delta);
      }

      if (time >= state.endAt) {
        endRun();
      }
      updateHud();
    }

    if (profile.mode === "collector") {
      drawCollector();
    } else {
      drawShooter();
    }

    state.rafId = requestAnimationFrame(loop);
  };

  const start = () => {
    const beginRun = () => {
      if (state.started && !state.ended) {
        return;
      }

      if (state.ended) {
        resetState();
      }

      state.started = true;
      state.endAt = performance.now() + state.remainingMs;
      state.previousTime = 0;

      if (overlay) overlay.classList.add("hidden");
      if (startBtn) startBtn.textContent = "Running";
      updateHud();
    };

    if (isFullscreen()) {
      beginRun();
      return;
    }

    const target = stage || canvas;
    if (target?.requestFullscreen) {
      target
        .requestFullscreen()
        .then(() => beginRun())
        .catch(() => {
          if (overlay) {
            overlay.textContent = "Fullscreen was blocked. Allow fullscreen to play.";
            overlay.classList.remove("hidden");
          }
        });
      return;
    }

    if (overlay) {
      overlay.textContent = "Fullscreen is not supported in this browser.";
      overlay.classList.remove("hidden");
    }
  };

  if (profile.mode === "shooter") {
    canvas.addEventListener("click", (event) => {
      if (!state.started || state.ended) {
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
        state.target.x = Math.floor(Math.random() * (canvas.width - 100)) + 50;
        state.target.y = Math.floor(Math.random() * (canvas.height - 100)) + 50;
        state.target.vx = (Math.random() > 0.5 ? 1 : -1) * (170 + Math.random() * 120);
        state.target.vy = (Math.random() > 0.5 ? 1 : -1) * (140 + Math.random() * 100);
        updateHud();
      }
    });
  }

  window.addEventListener("keydown", (event) => {
    state.keys.add(event.key.toLowerCase());
  });

  window.addEventListener("keyup", (event) => {
    state.keys.delete(event.key.toLowerCase());
  });

  startBtn?.addEventListener("click", start);
  resetBtn?.addEventListener("click", resetState);

  document.addEventListener("fullscreenchange", () => {
    if (!isFullscreen() && state.started && !state.ended) {
      state.remainingMs = Math.max(0, state.endAt - performance.now());
      state.started = false;
      if (overlay) {
        overlay.textContent = "Fullscreen is required. Press Start to resume.";
        overlay.classList.remove("hidden");
      }
      if (startBtn) {
        startBtn.textContent = "Resume";
      }
      updateHud();
    }
  });

  resetState();
  state.rafId = requestAnimationFrame(loop);

  return {
    start,
    reset: resetState,
    destroy: () => cancelAnimationFrame(state.rafId)
  };
};

const getTransportStatusText = ({ mode, reason }) => {
  if (mode === TRANSPORT_MODES.webrtc) {
    return "Live Session · WebRTC";
  }

  if (reason === "forced_compatibility") {
    return "Live Session · Compatibility";
  }

  return "Live Session · Compatibility (fallback)";
};

const getTransportHelpText = ({ mode, reason }) => {
  if (mode === TRANSPORT_MODES.webrtc) {
    return null;
  }

  if (reason === "forced_compatibility") {
    return "Compatibility mode active (WebRTC disabled in settings).";
  }

  return "Compatibility mode active (WebRTC unavailable on this network/browser).";
};

const init = async () => {
  initAuthShell();

  const game = getGameFromQuery();
  appState.activeGame = game;
  appState.recentGame = game;
  const gameSlug = slugFromGameName(game);
  const profile = runtimeProfiles[gameSlug] || runtimeProfiles.default;

  const gameNameEls = document.querySelectorAll("[data-game-name]");
  gameNameEls.forEach((el) => {
    el.textContent = game;
  });

  const planEl = document.querySelector("[data-plan-name]");
  if (planEl) {
    planEl.textContent = toTitle(appState.selectedPlan);
  }

  const statusEl = document.querySelector("[data-session-status]");
  if (statusEl) {
    statusEl.textContent = "Connecting...";
  }

  const transport = await resolveTransportMode();

  if (statusEl) {
    statusEl.textContent = getTransportStatusText(transport);
  }

  createRuntime(profile);

  const helpEl = document.querySelector("[data-runtime-help]");
  const transportHelp = getTransportHelpText(transport);
  if (helpEl && transportHelp) {
    helpEl.textContent = transportHelp;
  }
};

init().catch((error) => {
  console.error(error);
});
