import {
  apiRequestWithSchedulerRecovery,
  appState,
  initAuthShell,
  isSchedulerUnavailableError,
  toTitle
} from "./app.js";

const getGameFromQuery = () => {
  const params = new URLSearchParams(window.location.search);
  return params.get("game") || appState.activeGame || "Fortnite";
};

const slugFromGameName = (name) =>
  String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");

const setText = (selector, value) => {
  const element = document.querySelector(selector);
  if (element) {
    element.textContent = value;
  }
};

const pickBestSession = (sessions, gameSlug) => {
  if (!Array.isArray(sessions) || sessions.length === 0) {
    return null;
  }

  const byGame = sessions.filter((entry) => slugFromGameName(entry.gameSlug || entry.gameTitle || "") === gameSlug);
  const candidates = byGame.length ? byGame : sessions;

  const active = candidates.find((entry) => entry.status === "active");
  if (active) return active;

  const disconnected = candidates.find((entry) => entry.status === "disconnected");
  if (disconnected) return disconnected;

  return candidates.find((entry) => entry.status === "queued") || candidates[0] || null;
};

const init = () => {
  initAuthShell();

  const game = getGameFromQuery();
  const gameSlug = slugFromGameName(game);
  appState.activeGame = game;
  appState.recentGame = game;

  document.querySelectorAll("[data-game-name]").forEach((element) => {
    element.textContent = game;
  });
  setText("[data-plan-name]", toTitle(appState.selectedPlan));

  const playSurface = document.querySelector("[data-play-surface]");
  const fullscreenButton = document.querySelector("[data-enter-fullscreen]");

  const isFullscreen = () => document.fullscreenElement === playSurface;

  const requestFullscreen = async () => {
    if (!playSurface?.requestFullscreen) {
      setText("[data-bootstrap-message]", "Fullscreen is not supported in this browser.");
      return;
    }

    try {
      await playSurface.requestFullscreen();
    } catch {
      setText("[data-bootstrap-message]", "Fullscreen was blocked. Allow fullscreen and try again.");
    }
  };

  fullscreenButton?.addEventListener("click", () => {
    requestFullscreen();
  });

  document.addEventListener("fullscreenchange", () => {
    if (isFullscreen()) {
      setText("[data-bootstrap-message]", "Fullscreen enabled. Waiting for cloud stream handoff...");
      if (fullscreenButton) {
        fullscreenButton.textContent = "Fullscreen Active";
      }
      return;
    }

    if (fullscreenButton) {
      fullscreenButton.textContent = "Enter Fullscreen";
    }
  });

  const refreshSessionState = async () => {
    if (!appState.authToken || !appState.authUser) {
      window.location.href = "./profile.html?reason=signin-required";
      return;
    }

    try {
      const sessions = await apiRequestWithSchedulerRecovery(
        "/api/sessions/me",
        { auth: true },
        {
          onRecovering: () => {
            setText("[data-session-status]", "Recovering");
            setText("[data-api-status]", "Recovering rig service...");
          }
        }
      );

      const session = pickBestSession(sessions, gameSlug);
      if (!session) {
        setText("[data-session-status]", "No Session");
        setText("[data-bootstrap-message]", "No cloud session found. Launch from Library first.");
        setText("[data-api-status]", "No active session");
        return;
      }

      if (session.status === "queued") {
        setText("[data-session-status]", "Queued");
        setText("[data-bootstrap-message]", "Session queued. Enter fullscreen now, stream will start when assigned.");
        setText("[data-api-status]", `Queue position: ${session.queuePosition || "..."}`);
        return;
      }

      if (session.status === "disconnected") {
        setText("[data-session-status]", "Reconnect");
        setText("[data-bootstrap-message]", "Session disconnected. Keep fullscreen ready while reconnecting.");
      } else {
        setText("[data-session-status]", "Connected");
        setText("[data-bootstrap-message]", "Host session is active. Keep fullscreen on for stream handoff.");
      }

      setText("[data-api-status]", `Session: ${session.id}`);
    } catch (error) {
      if (Number(error?.status || 0) === 401) {
        window.location.href = "./profile.html?reason=signin-required";
        return;
      }

      if (isSchedulerUnavailableError(error)) {
        setText("[data-session-status]", "Preparing");
        setText("[data-bootstrap-message]", "Stream service is syncing. Enter fullscreen and wait a moment.");
        setText("[data-api-status]", "Preparing stream...");
        return;
      }

      setText("[data-session-status]", "Ready");
      setText("[data-bootstrap-message]", "Player is ready. Enter fullscreen to continue.");
      setText("[data-api-status]", "Player mode");
      console.error(error);
    }
  };

  refreshSessionState();
  setInterval(refreshSessionState, 10000);
};

init();
