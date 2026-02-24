const STORAGE_KEYS = {
  billingCycle: "nexforce.billingCycle",
  recentGame: "nexforce.recentGame",
  authToken: "nexforce.authToken"
};

const getStoredValue = (key, fallbackValue) => {
  const value = localStorage.getItem(key);
  return value ?? fallbackValue;
};

const setStoredValue = (key, value) => {
  localStorage.setItem(key, value);
};

const API_BASE = "/api";

export const appState = {
  user: null,
  settings: {
    preferredDevice: "PC",
    networkProfile: "Balanced",
    selectedPlan: "performance"
  },
  get billingCycle() {
    return getStoredValue(STORAGE_KEYS.billingCycle, "monthly");
  },
  set billingCycle(value) {
    setStoredValue(STORAGE_KEYS.billingCycle, value);
  },
  get recentGame() {
    return getStoredValue(STORAGE_KEYS.recentGame, "Fortnite");
  },
  set recentGame(value) {
    setStoredValue(STORAGE_KEYS.recentGame, value);
  },
  get authToken() {
    return getStoredValue(STORAGE_KEYS.authToken, "");
  },
  set authToken(value) {
    if (!value) {
      localStorage.removeItem(STORAGE_KEYS.authToken);
      return;
    }
    setStoredValue(STORAGE_KEYS.authToken, value);
  }
};

const apiRequest = async (path, options = {}) => {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (appState.authToken) {
    headers.Authorization = `Bearer ${appState.authToken}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }
  return data;
};

export const getGames = async () => apiRequest("/games");
export const getPlans = async () => apiRequest("/plans");

export const refreshSession = async () => {
  if (!appState.authToken) {
    appState.user = null;
    return null;
  }

  try {
    const payload = await apiRequest("/auth/me");
    appState.user = payload.user;
    return payload.user;
  } catch {
    appState.authToken = "";
    appState.user = null;
    return null;
  }
};

export const signInDemo = async () => {
  const payload = await apiRequest("/auth/demo-login", { method: "POST" });
  appState.authToken = payload.token;
  appState.user = payload.user;
  return payload.user;
};

export const signOut = async () => {
  if (appState.authToken) {
    try {
      await apiRequest("/auth/logout", { method: "POST" });
    } catch {
      // noop
    }
  }

  appState.authToken = "";
  appState.user = null;
};

export const getProfileSettings = async () => {
  const settings = await apiRequest("/profile/settings");
  appState.settings = settings;
  return settings;
};

export const updateProfileSettings = async (updates) => {
  const settings = await apiRequest("/profile/settings", {
    method: "PUT",
    body: JSON.stringify(updates)
  });
  appState.settings = settings;
  return settings;
};

export const updateSelectedPlan = async (selectedPlan) => {
  const settings = await apiRequest("/profile/plan", {
    method: "PUT",
    body: JSON.stringify({ selectedPlan })
  });
  appState.settings = settings;
  return settings;
};

export const getLaunchEstimate = async (plan) => apiRequest(`/launch/estimate?plan=${encodeURIComponent(plan)}`);

export const initLaunchModal = () => {
  const modal = document.querySelector("[data-launch-modal]");
  if (!modal) {
    return {
      openModal: () => {},
      closeModal: () => {}
    };
  }

  const closeButtons = modal.querySelectorAll("[data-close-launch]");
  const gameName = modal.querySelector("[data-launch-game]");
  const queueEl = modal.querySelector("[data-queue]");
  const latencyEl = modal.querySelector("[data-latency]");
  const fpsEl = modal.querySelector("[data-fps]");
  const etaEl = modal.querySelector("[data-eta]");

  let intervalRef;

  const stopSimulation = () => {
    if (intervalRef) {
      clearInterval(intervalRef);
      intervalRef = undefined;
    }
  };

  const runSimulation = async () => {
    const selectedPlan = appState.settings.selectedPlan || "free";
    let queue = 0;
    let eta = 0;

    try {
      const estimate = await getLaunchEstimate(selectedPlan);
      queue = estimate.queue;
      eta = estimate.eta;
      latencyEl.textContent = `${estimate.latency} ms`;
      fpsEl.textContent = `${estimate.fps} FPS`;
    } catch {
      queue = 20;
      eta = 7;
      latencyEl.textContent = "22 ms";
      fpsEl.textContent = "100 FPS";
    }

    queueEl.textContent = String(queue);
    etaEl.textContent = `${eta} min`;

    stopSimulation();
    intervalRef = setInterval(() => {
      queue = Math.max(0, queue - (Math.floor(Math.random() * 3) + 1));
      eta = Math.max(0, Math.ceil(queue / 3));
      const latencyBase = selectedPlan === "ultimate" ? 10 : selectedPlan === "performance" ? 16 : 22;
      const fpsBase = selectedPlan === "ultimate" ? 116 : selectedPlan === "performance" ? 100 : 82;
      const latency = Math.floor(Math.random() * 7) + latencyBase;
      const fps = Math.floor(Math.random() * 18) + fpsBase;

      queueEl.textContent = String(queue);
      etaEl.textContent = queue === 0 ? "Launching..." : `${eta} min`;
      latencyEl.textContent = `${latency} ms`;
      fpsEl.textContent = `${fps} FPS`;
    }, 1200);
  };

  const openModal = (selectedGame = "Cloud Session") => {
    gameName.textContent = selectedGame;
    appState.recentGame = selectedGame;
    modal.classList.remove("hidden");
    document.body.classList.add("overflow-hidden");
    runSimulation();
  };

  const closeModal = () => {
    modal.classList.add("hidden");
    document.body.classList.remove("overflow-hidden");
    stopSimulation();
  };

  closeButtons.forEach((button) => {
    button.addEventListener("click", closeModal);
  });

  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeModal();
    }
  });

  return { openModal, closeModal };
};

export const initLaunchButtons = (openModal) => {
  document.querySelectorAll("[data-open-launch]").forEach((button) => {
    button.addEventListener("click", () => {
      openModal(button.getAttribute("data-game") || "Cloud Session");
    });
  });
};

export const toTitle = (text) => text.charAt(0).toUpperCase() + text.slice(1);

export const initAuthShell = () => {
  const shell = document.querySelector("[data-auth-shell]");
  if (!shell) {
    return;
  }

  const render = () => {
    const user = appState.user;
    if (user) {
      shell.innerHTML = `
        <a href="./profile.html" class="rounded-lg border border-white/20 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:border-white/40 hover:bg-white/10">Profile</a>
        <button data-sign-out class="rounded-lg border border-primary/70 bg-primary px-4 py-2 text-sm font-semibold text-black transition hover:brightness-110">Sign Out</button>
      `;
      shell.querySelector("[data-sign-out]")?.addEventListener("click", async () => {
        await signOut();
        render();
      });
      return;
    }

    shell.innerHTML = `
      <button data-sign-in class="rounded-lg border border-white/20 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:border-white/40 hover:bg-white/10">Sign In</button>
      <a href="./plans.html" class="rounded-lg border border-primary/70 bg-primary px-4 py-2 text-sm font-semibold text-black transition hover:brightness-110">Join Beta</a>
    `;

    shell.querySelector("[data-sign-in]")?.addEventListener("click", async () => {
      await signInDemo();
      await refreshSession();
      try {
        await getProfileSettings();
      } catch {
        // noop
      }
      render();
    });
  };

  refreshSession().then(render).catch(render);
};