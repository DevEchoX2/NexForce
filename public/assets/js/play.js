import { appState, initAuthShell, toTitle } from "./app.js";

const getGameFromQuery = () => {
  const params = new URLSearchParams(window.location.search);
  return params.get("game") || appState.activeGame || "Fortnite";
};

const init = () => {
  initAuthShell();

  const game = getGameFromQuery();
  appState.activeGame = game;
  appState.recentGame = game;

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
    statusEl.textContent = "Connected";
  }
};

init();
