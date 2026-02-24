import {
  appState,
  getGames,
  getProfileSettings,
  initAuthShell,
  initLaunchButtons,
  initLaunchModal,
  refreshSession,
  toTitle
} from "./app.js";

const renderFeaturedGames = (games) => {
  const container = document.querySelector("[data-featured-games]");
  if (!container) {
    return;
  }

  const featuredGames = games.filter((game) => game.featured);
  container.innerHTML = featuredGames
    .map(
      (game) => `
      <article class="game-card">
        ${
          game.image
            ? `<img src="${game.image}" alt="${game.title}" class="h-32 w-full rounded-xl border border-white/10 bg-black/30 object-cover" />`
            : `<div class="h-32 rounded-xl border border-dashed border-white/20 bg-black/30"></div>`
        }
        <h3 class="mt-3 text-base font-semibold">${game.title}</h3>
        <p class="mt-1 text-xs text-soft">${game.genre} • ${game.platform}</p>
        <button data-open-launch data-game="${game.title}" class="mt-3 w-full rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-black transition hover:brightness-110">
          Launch
        </button>
      </article>
    `
    )
    .join("");
};

const hydrateHeroState = () => {
  const selectedPlan = document.querySelector("[data-selected-plan]");
  const recentGame = document.querySelector("[data-recent-game]");
  if (selectedPlan) {
    selectedPlan.textContent = toTitle(appState.settings.selectedPlan || "free");
  }
  if (recentGame) {
    recentGame.textContent = appState.recentGame;
  }
};

const init = async () => {
  await refreshSession();
  if (appState.user) {
    await getProfileSettings().catch(() => {});
  }
  initAuthShell();
  const launch = initLaunchModal();

  const games = await getGames();
  renderFeaturedGames(games);
  hydrateHeroState();
  initLaunchButtons(launch.openModal);
};

init().catch((error) => {
  console.error(error);
});