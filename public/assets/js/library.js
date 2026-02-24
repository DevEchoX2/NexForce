import { initAuthShell, initLaunchButtons, initLaunchModal, loadJson, toTitle } from "./app.js";

const renderFilterOptions = (games) => {
  const genreSelect = document.querySelector("[data-genre-filter]");
  const planSelect = document.querySelector("[data-plan-filter]");

  if (!genreSelect || !planSelect) {
    return;
  }

  const genres = [...new Set(games.map((game) => game.genre))];

  genreSelect.innerHTML = ["All genres", ...genres]
    .map((genre) => `<option value="${genre}">${genre}</option>`)
    .join("");

  planSelect.innerHTML = ["All plans", "free", "performance", "ultimate"]
    .map((plan) => `<option value="${plan}">${plan === "All plans" ? plan : toTitle(plan)}</option>`)
    .join("");
};

const renderGames = (games) => {
  const grid = document.querySelector("[data-games-grid]");
  const count = document.querySelector("[data-game-count]");
  if (!grid || !count) {
    return;
  }

  count.textContent = `${games.length} Games Available`;

  grid.innerHTML = games
    .map(
      (game) => `
      <article class="game-card">
        ${
          game.image
            ? `<img src="${game.image}" alt="${game.title}" class="h-36 w-full rounded-xl border border-white/10 bg-black/30 object-cover" />`
            : `<div class="h-36 rounded-xl border border-dashed border-white/20 bg-black/30"></div>`
        }
        <h2 class="mt-4 text-lg font-semibold">${game.title}</h2>
        <p class="mt-1 text-sm text-soft">${game.description}</p>
        <div class="mt-3 flex items-center justify-between text-xs text-soft">
          <span>${game.genre}</span>
          <span>Min plan: ${toTitle(game.minPlan)}</span>
        </div>
        <button
          data-open-launch
          data-game="${game.title}"
          class="mt-4 w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-black transition hover:brightness-110"
        >
          Launch
        </button>
      </article>
    `
    )
    .join("");
};

const init = async () => {
  initAuthShell();
  const launch = initLaunchModal();
  const games = await loadJson("./data/games.json");
  renderFilterOptions(games);

  const searchInput = document.querySelector("[data-search]");
  const genreSelect = document.querySelector("[data-genre-filter]");
  const planSelect = document.querySelector("[data-plan-filter]");

  const applyFilters = () => {
    const searchValue = (searchInput?.value || "").toLowerCase().trim();
    const genreValue = genreSelect?.value || "All genres";
    const planValue = planSelect?.value || "All plans";

    const filtered = games.filter((game) => {
      const matchSearch =
        searchValue.length === 0 ||
        game.title.toLowerCase().includes(searchValue) ||
        game.description.toLowerCase().includes(searchValue);
      const matchGenre = genreValue === "All genres" || game.genre === genreValue;
      const matchPlan = planValue === "All plans" || game.minPlan === planValue;
      return matchSearch && matchGenre && matchPlan;
    });

    renderGames(filtered);
    initLaunchButtons(launch.openModal);
  };

  [searchInput, genreSelect, planSelect].forEach((element) => {
    element?.addEventListener("input", applyFilters);
    element?.addEventListener("change", applyFilters);
  });

  applyFilters();
};

init().catch((error) => {
  console.error(error);
});