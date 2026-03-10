import { appState, initAuthShell, toTitle } from "./app.js";

const getGameFromQuery = () => {
  const params = new URLSearchParams(window.location.search);
  return params.get("game") || appState.activeGame || "Fortnite";
};

const initPlayerSurface = () => {
  const surface = document.querySelector("[data-play-surface]");
  const overlay = document.querySelector("[data-play-overlay]");
  const messageEl = document.querySelector("[data-bootstrap-message]");
  const fullscreenButtons = Array.from(document.querySelectorAll("[data-enter-fullscreen]"));

  if (!surface) {
    return;
  }

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

  const setButtonLabel = (label) => {
    fullscreenButtons.forEach((button) => {
      button.textContent = label;
    });
  };

  const start = async () => {
    if (!document.fullscreenElement && surface.requestFullscreen) {
      try {
        await surface.requestFullscreen();
      } catch {
        setMessage("Allow fullscreen to start the stream.");
        return;
      }
    }

    setStatus("Playing");
    if (overlay) {
      overlay.classList.add("hidden");
    }
    setButtonLabel("Playing");
  };

  fullscreenButtons.forEach((button) => {
    button.addEventListener("click", () => {
      start();
    });
  });

  document.addEventListener("fullscreenchange", () => {
    const inFullscreen = document.fullscreenElement === surface;
    if (!inFullscreen) {
      setStatus("Paused");
      if (overlay) {
        overlay.classList.remove("hidden");
      }
      setMessage("Paused. Enter fullscreen to resume.");
      setButtonLabel("Play / Fullscreen");
    }
  });

  setStatus("Ready");
  setMessage("Enter fullscreen and press the button to play.");
  setButtonLabel("Play / Fullscreen");
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

  initPlayerSurface();
};

init();
