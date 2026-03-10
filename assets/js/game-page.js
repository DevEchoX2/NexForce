import { appState, initAuthShell, initLaunchButtons, initLaunchModal, toTitle } from "./app.js";

const getMeta = () => {
  const root = document.body;
  return {
    title: root.getAttribute("data-game-title") || "Game",
    slug: root.getAttribute("data-game-slug") || "game",
    genre: root.getAttribute("data-game-genre") || "Action",
    platform: root.getAttribute("data-game-platform") || "Cross-Platform",
    minPlan: root.getAttribute("data-game-min-plan") || "free",
    image: root.getAttribute("data-game-image") || "",
    description: root.getAttribute("data-game-description") || "Cloud session ready."
  };
};

const setText = (selector, value) => {
  const element = document.querySelector(selector);
  if (element) {
    element.textContent = value;
  }
};

const init = () => {
  initAuthShell();

  const meta = getMeta();
  appState.activeGame = meta.title;
  appState.recentGame = meta.title;

  setText("[data-game-title]", meta.title);
  setText("[data-game-genre]", meta.genre);
  setText("[data-game-platform]", meta.platform);
  setText("[data-game-min-plan]", toTitle(meta.minPlan));
  setText("[data-game-description]", meta.description);

  const image = document.querySelector("[data-game-image]");
  if (image && meta.image) {
    image.setAttribute("src", meta.image);
    image.setAttribute("alt", `${meta.title} preview`);
  }

  const launchButton = document.querySelector("[data-open-launch]");
  if (launchButton) {
    launchButton.setAttribute("data-game", meta.title);
  }

  const directPlay = document.querySelector("[data-open-player]");
  if (directPlay) {
    directPlay.setAttribute("href", `./play.html?game=${encodeURIComponent(meta.title)}`);
  }

  const launch = initLaunchModal();
  initLaunchButtons(launch.openModal);
};

init();
