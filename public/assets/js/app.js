const STORAGE_KEYS = {
  billingCycle: "nexforce.billingCycle",
  selectedPlan: "nexforce.selectedPlan",
  recentGame: "nexforce.recentGame",
  authUser: "nexforce.authUser",
  authToken: "nexforce.authToken",
  preferredDevice: "nexforce.preferredDevice",
  networkProfile: "nexforce.networkProfile",
  activeGame: "nexforce.activeGame"
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
  get authToken() {
    return getStoredValue(STORAGE_KEYS.authToken, "");
  },
  set authToken(value) {
    if (!value) {
      localStorage.removeItem(STORAGE_KEYS.authToken);
      return;
    }
    setStoredValue(STORAGE_KEYS.authToken, value);
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
  },
  get activeGame() {
    return getStoredValue(STORAGE_KEYS.activeGame, "Fortnite");
  },
  set activeGame(value) {
    setStoredValue(STORAGE_KEYS.activeGame, value);
  }
};

const slugFromGame = (name = "") =>
  String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");

const getApiBase = () => {
  if (window.location.protocol === "file:") {
    return "http://localhost:5500";
  }
  return window.location.origin;
};

export const apiRequest = async (path, { method = "GET", body, auth = false } = {}) => {
  const headers = {
    "Content-Type": "application/json"
  };

  if (auth && appState.authToken) {
    headers.Authorization = `Bearer ${appState.authToken}`;
  }

  const response = await fetch(`${getApiBase()}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  const parsed = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const error = new Error(parsed.error || `Request failed: ${response.status}`);
    error.status = response.status;
    error.payload = parsed;
    throw error;
  }

  return parsed;
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
  const statusEl = modal.querySelector("[data-launch-status]");

  let intervalRef;
  let launchRedirected = false;
  let trackedSessionId = null;

  const stopSimulation = () => {
    if (intervalRef) {
      clearInterval(intervalRef);
      intervalRef = undefined;
    }
  };

  const stopTracking = () => {
    trackedSessionId = null;
  };

  const pollUntilActive = async (gameSlug) => {
    for (let attempt = 0; attempt < 90; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const sessions = await apiRequest("/api/sessions/me", { auth: true });
      const tracked = sessions.find((entry) => entry.id === trackedSessionId);

      if (!tracked) {
        continue;
      }

      if (queueEl && tracked.queuePosition) {
        queueEl.textContent = String(tracked.queuePosition);
      }
      if (etaEl && tracked.queuePosition) {
        etaEl.textContent = `${Math.max(1, tracked.queuePosition)} min`;
      }

      if (tracked.status === "active") {
        return tracked;
      }
    }

    return null;
  };

  const runSimulation = async () => {
    const selectedPlan = appState.selectedPlan;
    let queue = selectedPlan === "ultimate" ? 8 : selectedPlan === "performance" ? 18 : 30;
    let eta = Math.ceil(queue / 3);
    latencyEl.textContent = selectedPlan === "ultimate" ? "12 ms" : selectedPlan === "performance" ? "18 ms" : "26 ms";
    fpsEl.textContent = selectedPlan === "ultimate" ? "132 FPS" : selectedPlan === "performance" ? "112 FPS" : "88 FPS";

    queueEl.textContent = String(queue);
    etaEl.textContent = `${eta} min`;
    if (statusEl) {
      statusEl.textContent = "Connecting...";
    }

    stopSimulation();
    launchRedirected = false;
    const gameName = appState.activeGame || "Fortnite";
    const gameSlug = slugFromGame(gameName);

    const ensureSignedIn = async () => {
      if (appState.authToken) {
        return;
      }
      await signInDemo();
    };

    try {
      await ensureSignedIn();
      const requestResult = await apiRequest("/api/sessions/request", {
        method: "POST",
        auth: true,
        body: {
          gameSlug
        }
      });

      trackedSessionId = requestResult.session?.id || null;

      let activeSession = requestResult.session;
      if (requestResult.session?.status === "queued") {
        if (statusEl) {
          statusEl.textContent = "Queued";
        }
        if (queueEl && requestResult.queuePosition) {
          queueEl.textContent = String(requestResult.queuePosition);
        }
        if (etaEl && requestResult.queuePosition) {
          etaEl.textContent = `${Math.max(1, requestResult.queuePosition)} min`;
        }
        const resolved = await pollUntilActive(gameSlug);
        if (!resolved) {
          throw new Error("Queue timed out. Try again.");
        }
        activeSession = resolved;
      }

      if (statusEl) {
        statusEl.textContent = "Issuing launch ticket...";
      }

      const ticket = await apiRequest("/api/launch/ticket", {
        method: "POST",
        auth: true,
        body: {
          gameSlug,
          sessionId: activeSession.id
        }
      });

      if (!launchRedirected) {
        launchRedirected = true;
        const game = encodeURIComponent(gameName);
        const ticketId = encodeURIComponent(ticket.id || "");
        window.location.href = `./play.html?game=${game}&ticket=${ticketId}`;
      }
    } catch (error) {
      if (statusEl) {
        statusEl.textContent = error.message || "Launch failed";
      }
      if (etaEl) {
        etaEl.textContent = "Retry";
      }
      console.error(error);
    } finally {
      stopTracking();
    }
  };

  const openModal = (selectedGame = "Cloud Session") => {
    gameName.textContent = selectedGame;
    appState.recentGame = selectedGame;
    appState.activeGame = selectedGame;
    modal.classList.remove("hidden");
    document.body.classList.add("overflow-hidden");
    runSimulation();
  };

  const closeModal = () => {
    modal.classList.add("hidden");
    document.body.classList.remove("overflow-hidden");
    stopSimulation();
    stopTracking();
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
  if (appState.authToken) {
    apiRequest("/api/auth/logout", {
      method: "POST",
      auth: true
    }).catch(() => {});
  }
  appState.authUser = null;
  appState.authToken = "";
};

export const signInDemo = async () => {
  try {
    const result = await apiRequest("/api/auth/demo-login", {
      method: "POST",
      body: {}
    });
    appState.authToken = result.token;
    appState.authUser = result.user;
    return result.user;
  } catch {
    const user = await loadJson("./data/mock-user.json");
    appState.authToken = "";
    appState.authUser = user;
    return user;
  }
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