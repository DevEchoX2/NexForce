const STORAGE_KEYS = {
  billingCycle: "nexforce.billingCycle",
  selectedPlan: "nexforce.selectedPlan",
  recentGame: "nexforce.recentGame",
  authUser: "nexforce.authUser",
  preferredDevice: "nexforce.preferredDevice",
  networkProfile: "nexforce.networkProfile"
};

const getStoredValue = (key, fallbackValue) => {
  const value = localStorage.getItem(key);
  return value ?? fallbackValue;
};

const setStoredValue = (key, value) => {
  localStorage.setItem(key, value);
};

export const appState = {
  get billingCycle() {
    return getStoredValue(STORAGE_KEYS.billingCycle, "monthly");
  },
  set billingCycle(value) {
    setStoredValue(STORAGE_KEYS.billingCycle, value);
  },
  get selectedPlan() {
    return getStoredValue(STORAGE_KEYS.selectedPlan, "free");
  },
  set selectedPlan(value) {
    setStoredValue(STORAGE_KEYS.selectedPlan, value);
  },
  get recentGame() {
    return getStoredValue(STORAGE_KEYS.recentGame, "Fortnite");
  },
  set recentGame(value) {
    setStoredValue(STORAGE_KEYS.recentGame, value);
  },
  get authUser() {
    const raw = getStoredValue(STORAGE_KEYS.authUser, "");
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },
  set authUser(value) {
    if (!value) {
      localStorage.removeItem(STORAGE_KEYS.authUser);
      return;
    }
    setStoredValue(STORAGE_KEYS.authUser, JSON.stringify(value));
  },
  get preferredDevice() {
    return getStoredValue(STORAGE_KEYS.preferredDevice, "PC");
  },
  set preferredDevice(value) {
    setStoredValue(STORAGE_KEYS.preferredDevice, value);
  },
  get networkProfile() {
    return getStoredValue(STORAGE_KEYS.networkProfile, "Balanced");
  },
  set networkProfile(value) {
    setStoredValue(STORAGE_KEYS.networkProfile, value);
  }
};

export const loadJson = async (path) => {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}`);
  }
  return response.json();
};

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
    const selectedPlan = appState.selectedPlan;
    let queue = selectedPlan === "ultimate" ? 8 : selectedPlan === "performance" ? 18 : 30;
    let eta = Math.ceil(queue / 3);
    latencyEl.textContent = selectedPlan === "ultimate" ? "12 ms" : selectedPlan === "performance" ? "18 ms" : "26 ms";
    fpsEl.textContent = selectedPlan === "ultimate" ? "132 FPS" : selectedPlan === "performance" ? "112 FPS" : "88 FPS";

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

export const signOut = () => {
  appState.authUser = null;
};

export const signInDemo = async () => {
  const user = await loadJson("./data/mock-user.json");
  appState.authUser = user;
  return user;
};

export const initAuthShell = () => {
  const shell = document.querySelector("[data-auth-shell]");
  if (!shell) {
    return;
  }

  const render = () => {
    const user = appState.authUser;
    if (user) {
      shell.innerHTML = `
        <a href="./profile.html" class="rounded-lg border border-white/20 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:border-white/40 hover:bg-white/10">Profile</a>
        <button data-sign-out class="rounded-lg border border-primary/70 bg-primary px-4 py-2 text-sm font-semibold text-black transition hover:brightness-110">Sign Out</button>
      `;
      shell.querySelector("[data-sign-out]")?.addEventListener("click", () => {
        signOut();
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
      render();
    });
  };

  render();
};