import {
  apiRequest,
  appState,
  initAuthShell,
  loadJson,
  toTitle,
} from "./app.js";

const isOfflineOrUnavailableError = (error) => {
  const status = Number(error?.status || 0);
  const message = String(error?.message || "").toLowerCase();
  return (
    status === 0 ||
    [404, 502, 503, 504].includes(status) ||
    message.includes("failed to fetch") ||
    message.includes("service unavailable") ||
    message.includes("unexpected response format")
  );
};

const setPlanStatus = (message, isError = false) => {
  const status = document.querySelector("[data-plan-sub-status]");
  if (!status) {
    return;
  }
  status.textContent = message;
  status.className = `text-sm ${isError ? "text-rose-300" : "text-slate-400"}`;
};

const initPlanCheckout = async () => {
  const button = document.querySelector("[data-buy-selected-plan]");
  if (!button) {
    return;
  }

  try {
    const config = await apiRequest("/api/payments/config");
    if (!config.stripeEnabled) {
      setPlanStatus("Stripe is not configured yet. Create your account first.", true);
      return;
    }

    if (appState.authToken && appState.authUser) {
      const current = await apiRequest("/api/payments/plans/status", { auth: true });
      if (current.active && current.planId) {
        setPlanStatus(`Active plan: ${toTitle(current.planId)} (${toTitle(current.billingCycle || "monthly")}).`);
      }
    }
  } catch (error) {
    if (isOfflineOrUnavailableError(error)) {
      setPlanStatus("Billing backend is offline right now. Plan selection still works locally.");
    } else {
      setPlanStatus("Unable to load subscription status right now.", true);
    }
  }

  button.addEventListener("click", async () => {
    if (!appState.authToken || !appState.authUser) {
      window.location.href = "./profile.html?reason=signin-required";
      return;
    }

    const selectedPlan = String(appState.selectedPlan || "free").toLowerCase();
    if (selectedPlan === "free") {
      setPlanStatus("Free plan does not require checkout.");
      return;
    }

    button.disabled = true;
    setPlanStatus(`Starting ${toTitle(selectedPlan)} checkout...`);

    try {
      const payload = {
        planId: selectedPlan,
        billingCycle: appState.billingCycle || "monthly",
        successUrl: `${window.location.origin}${window.location.pathname}?checkout=success&plan=${encodeURIComponent(selectedPlan)}`,
        cancelUrl: `${window.location.origin}${window.location.pathname}?checkout=cancel&plan=${encodeURIComponent(selectedPlan)}`
      };

      const checkout = await apiRequest("/api/payments/plans/checkout", {
        method: "POST",
        auth: true,
        body: payload
      });

      if (checkout?.url) {
        window.location.href = checkout.url;
        return;
      }

      setPlanStatus("Checkout URL was not returned.", true);
    } catch (error) {
      if (isOfflineOrUnavailableError(error)) {
        setPlanStatus("Billing backend is offline right now. Try checkout again later.");
      } else {
        setPlanStatus(error?.message || "Plan checkout failed. Try again.", true);
      }
    } finally {
      button.disabled = false;
    }
  });
};

const initDayPassCheckout = async () => {
  const button = document.querySelector("[data-buy-day-pass]");
  const status = document.querySelector("[data-day-pass-status]");
  if (!button || !status) {
    return;
  }

  const setStatus = (message, isError = false) => {
    status.textContent = message;
    status.className = `text-sm ${isError ? "text-rose-300" : "text-slate-400"}`;
  };

  try {
    const config = await apiRequest("/api/payments/config");
    if (!config.stripeEnabled) {
      setStatus("Stripe is not configured yet. Create your account first.", true);
      return;
    }

    setStatus(`Day Pass checkout is ready ($${config.dayPassPriceUsd}).`);
  } catch (error) {
    if (isOfflineOrUnavailableError(error)) {
      setStatus("Billing backend is offline right now. Day Pass checkout is temporarily unavailable.");
    } else {
      setStatus("Unable to load payment setup right now.", true);
    }
  }

  button.addEventListener("click", async () => {
    if (!appState.authToken || !appState.authUser) {
      window.location.href = "./profile.html?reason=signin-required";
      return;
    }

    button.disabled = true;
    setStatus("Creating secure checkout...");

    try {
      const payload = {
        successUrl: `${window.location.origin}${window.location.pathname}?checkout=success`,
        cancelUrl: `${window.location.origin}${window.location.pathname}?checkout=cancel`
      };
      const checkout = await apiRequest("/api/payments/day-pass/checkout", {
        method: "POST",
        auth: true,
        body: payload
      });

      if (checkout?.url) {
        window.location.href = checkout.url;
        return;
      }

      setStatus("Checkout URL was not returned.", true);
    } catch (error) {
      if (isOfflineOrUnavailableError(error)) {
        setStatus("Billing backend is offline right now. Try checkout again later.");
      } else {
        const message = error?.message || "Checkout failed. Try again.";
        setStatus(message, true);
      }
    } finally {
      button.disabled = false;
    }
  });
};

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
    button.addEventListener("click", async () => {
      const selectedPlan = button.getAttribute("data-plan-select") || "free";
      if (appState.authToken && appState.authUser) {
        try {
          const saved = await apiRequest("/api/profile/plan", {
            method: "PUT",
            auth: true,
            body: {
              selectedPlan
            }
          });
          appState.selectedPlan = saved.selectedPlan || selectedPlan;
          setPlanStatus(`Selected plan updated to ${toTitle(appState.selectedPlan)}.`);
        } catch (error) {
          if (error?.payload?.code === "payment_required") {
            appState.selectedPlan = error?.payload?.entitlementPlan || "free";
            setPlanStatus("Payment required for this plan. Use Checkout Selected Plan.", true);
          } else if (isOfflineOrUnavailableError(error)) {
            appState.selectedPlan = selectedPlan;
            setPlanStatus("Saved locally. Backend is offline right now.");
          } else {
            appState.selectedPlan = selectedPlan;
            setPlanStatus(error?.message || "Could not save selected plan to backend.", true);
          }
        }
      } else {
        appState.selectedPlan = selectedPlan;
      }

      renderPlans(plans, appState.billingCycle);
      hydrateSelectedPlan();
    });
  });
};

const hydrateSelectedPlan = () => {
  const selected = document.querySelector("[data-current-plan]");
  if (selected) {
    selected.textContent = toTitle(appState.selectedPlan || "free");
  }
};

const init = async () => {
  initAuthShell();
  if (appState.authToken && appState.authUser) {
    try {
      const settings = await apiRequest("/api/profile/settings", { auth: true });
      if (settings?.selectedPlan) {
        appState.selectedPlan = settings.selectedPlan;
      }
    } catch {
    }
  }

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
  await initPlanCheckout();
  await initDayPassCheckout();
};

init().catch((error) => {
  console.error(error);
});