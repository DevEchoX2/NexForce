import { appState, loadJson, toTitle } from "./app.js";

const renderPlans = (plans, billingCycle) => {
  const container = document.querySelector("[data-plans-grid]");
  if (!container) {
    return;
  }

  container.innerHTML = plans
    .map((plan) => {
      const selected = appState.selectedPlan === plan.id;
      const cardClass = plan.recommended
        ? "rounded-2xl border border-primary/50 bg-primary/10 p-6 shadow-glow"
        : "plan-card";

      return `
      <article class="${cardClass}">
        <div class="flex items-center justify-between gap-2">
          <h2 class="text-xl font-semibold">${plan.name}</h2>
          ${plan.recommended ? '<span class="rounded-full bg-primary/20 px-2 py-1 text-[10px] font-semibold uppercase text-primary">Popular</span>' : ""}
        </div>
        <p class="mt-2 text-sm text-soft">${plan.description}</p>
        <p class="mt-5 text-3xl font-bold">${billingCycle === "yearly" ? plan.yearly : plan.monthly}</p>
        <ul class="mt-5 space-y-2 text-sm text-soft">
          ${plan.features.map((feature) => `<li>• ${feature}</li>`).join("")}
        </ul>
        <button
          data-plan-select="${plan.id}"
          class="mt-6 w-full rounded-lg border px-4 py-2 text-sm font-semibold transition ${
            selected
              ? "border-primary bg-primary text-black"
              : "border-white/20 bg-white/5 text-white hover:border-white/40 hover:bg-white/10"
          }"
        >
          ${selected ? "Selected" : `Choose ${plan.name}`}
        </button>
      </article>
    `;
    })
    .join("");

  container.querySelectorAll("[data-plan-select]").forEach((button) => {
    button.addEventListener("click", () => {
      appState.selectedPlan = button.getAttribute("data-plan-select") || "free";
      renderPlans(plans, appState.billingCycle);
      hydrateSelectedPlan();
    });
  });
};

const hydrateSelectedPlan = () => {
  const selected = document.querySelector("[data-current-plan]");
  if (selected) {
    selected.textContent = toTitle(appState.selectedPlan);
  }
};

const init = async () => {
  const plans = await loadJson("./data/plans.json");
  const billingToggle = document.querySelector("[data-billing-toggle]");

  if (billingToggle) {
    billingToggle.checked = appState.billingCycle === "yearly";
    billingToggle.addEventListener("change", () => {
      appState.billingCycle = billingToggle.checked ? "yearly" : "monthly";
      renderPlans(plans, appState.billingCycle);
    });
  }

  hydrateSelectedPlan();
  renderPlans(plans, appState.billingCycle);
};

init().catch((error) => {
  console.error(error);
});