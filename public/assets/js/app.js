const STORAGE_KEYS = {
  billingCycle: "nexforce.billingCycle",
  selectedPlan: "nexforce.selectedPlan",
  recentGame: "nexforce.recentGame",
  authUser: "nexforce.authUser",
  authToken: "nexforce.authToken",
  preferredDevice: "nexforce.preferredDevice",
  networkProfile: "nexforce.networkProfile",
  activeGame: "nexforce.activeGame",
  transportMode: "nexforce.transportMode",
  apiBaseUrl: "nexforce.apiBaseUrl"
};

const getStoredValue = (key, fallbackValue) => {
  const value = localStorage.getItem(key);
  return value ?? fallbackValue;
};

const setStoredValue = (key, value) => {
  localStorage.setItem(key, value);
};

const DEMO_USERS_KEY = "nexforce.demoUsers";

const readDemoUsers = () => {
  try {
    const raw = localStorage.getItem(DEMO_USERS_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeDemoUsers = (users) => {
  localStorage.setItem(DEMO_USERS_KEY, JSON.stringify(users));
};

const createDemoToken = () => {
  return `demo_${Math.random().toString(36).slice(2)}_${Date.now()}`;
};

const findDemoUserByEmail = (email) => {
  const normalized = String(email || "").trim().toLowerCase();
  return readDemoUsers().find((entry) => String(entry.email || "").toLowerCase() === normalized) || null;
};

const registerDemoUser = ({ name, email, password, tier = "free" }) => {
  const normalizedName = String(name || "").trim();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedPassword = String(password || "");

  if (normalizedName.length < 2) {
    const error = new Error("Name must be at least 2 characters");
    error.payload = { error: "Name must be at least 2 characters" };
    throw error;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    const error = new Error("A valid email is required");
    error.payload = { error: "A valid email is required" };
    throw error;
  }

  if (normalizedPassword.length < 8) {
    const error = new Error("Password must be at least 8 characters");
    error.payload = { error: "Password must be at least 8 characters" };
    throw error;
  }

  const users = readDemoUsers();
  if (users.some((entry) => String(entry.email || "").toLowerCase() === normalizedEmail)) {
    const error = new Error("Email already registered");
    error.payload = { error: "Email already registered" };
    throw error;
  }

  const selectedTier = ["free", "performance", "ultimate"].includes(String(tier || "").toLowerCase())
    ? String(tier).toLowerCase()
    : "free";

  const user = {
    id: `demo_user_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
    name: normalizedName,
    email: normalizedEmail,
    tier: selectedTier,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    password: normalizedPassword
  };

  users.push(user);
  writeDemoUsers(users);

  return {
    token: createDemoToken(),
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      tier: user.tier,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    }
  };
};

const loginDemoUser = ({ email, password }) => {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedPassword = String(password || "");
  const user = findDemoUserByEmail(normalizedEmail);

  if (!user || user.password !== normalizedPassword) {
    const error = new Error("Invalid email or password");
    error.payload = { error: "Invalid email or password" };
    throw error;
  }

  return {
    token: createDemoToken(),
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      tier: user.tier,
      createdAt: user.createdAt || null,
      updatedAt: new Date().toISOString()
    }
  };
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
  },
  get transportMode() {
    return getStoredValue(STORAGE_KEYS.transportMode, "auto");
  },
  set transportMode(value) {
    setStoredValue(STORAGE_KEYS.transportMode, value || "auto");
  },
  get apiBaseUrl() {
    return getStoredValue(STORAGE_KEYS.apiBaseUrl, "");
  },
  set apiBaseUrl(value) {
    const normalized = String(value || "").trim();
    if (!normalized) {
      localStorage.removeItem(STORAGE_KEYS.apiBaseUrl);
      return;
    }
    setStoredValue(STORAGE_KEYS.apiBaseUrl, normalized);
  }
};

const slugFromGame = (name = "") =>
  String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");

const normalizeApiBase = (value) => String(value || "").trim().replace(/\/+$/, "");

const getApiBaseFromQuery = () => {
  try {
    const queryValue = new URLSearchParams(window.location.search).get("apiBase");
    return queryValue ? normalizeApiBase(queryValue) : "";
  } catch {
    return "";
  }
};

const getApiBase = () => {
  const queryBase = getApiBaseFromQuery();
  if (queryBase) {
    appState.apiBaseUrl = queryBase;
    return queryBase;
  }

  const globalBase = normalizeApiBase(window.NEXFORCE_API_BASE_URL || "");
  if (globalBase) {
    return globalBase;
  }

  const storedBase = normalizeApiBase(appState.apiBaseUrl);
  if (storedBase) {
    return storedBase;
  }

  if (window.location.protocol === "file:") {
    return "http://localhost:5500";
  }
  return normalizeApiBase(window.location.origin);
};

export const setApiBaseUrl = (value) => {
  appState.apiBaseUrl = normalizeApiBase(value);
  return getApiBase();
};

export const getResolvedApiBase = () => getApiBase();

export const isApiConnectionFailure = (error) => {
  const statusCode = Number(error?.status || 0);
  const message = String(error?.message || "").toLowerCase();
  return (
    statusCode === 0 ||
    [404, 502, 503, 504].includes(statusCode) ||
    message.includes("failed to fetch") ||
    message.includes("service unavailable") ||
    message.includes("request failed: 404") ||
    message.includes("unexpected response format")
  );
};

export const isSchedulerUnavailableError = (error) => {
  const statusCode = Number(error?.status || 0);
  const code = String(error?.payload?.code || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  return statusCode === 503 && (code === "scheduler_unavailable" || message.includes("scheduler unavailable"));
};

export const recoverScheduler = async () => {
  if (!appState.authToken || !appState.authUser) {
    return { recovered: false, reason: "unauthenticated" };
  }

  try {
    const result = await apiRequest("/api/control/worker/tick", {
      method: "POST",
      auth: true
    });
    return { recovered: true, result };
  } catch (error) {
    return { recovered: false, error };
  }
};

export const apiRequestWithSchedulerRecovery = async (
  path,
  options = {},
  { allowRecovery = true, onRecovering = null } = {}
) => {
  try {
    return await apiRequest(path, options);
  } catch (error) {
    if (!allowRecovery || path === "/api/control/worker/tick" || !isSchedulerUnavailableError(error)) {
      throw error;
    }

    if (typeof onRecovering === "function") {
      onRecovering();
    }

    const recovered = await recoverScheduler();
    if (!recovered.recovered) {
      throw error;
    }

    return apiRequest(path, options);
  }
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
  let parsed = {};
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { error: response.ok ? "Unexpected response format" : "Service unavailable" };
    }
  }

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
  const queueBarEl = modal.querySelector("[data-queue-bar]");
  const adsCountEl = modal.querySelector("[data-rig-ads-count]");
  const statusEl = modal.querySelector("[data-launch-status]");

  let intervalRef;
  let launchRedirected = false;
  let trackedSessionId = null;
  let apiRepairAttempted = false;

  const stopSimulation = () => {
    if (intervalRef) {
      clearInterval(intervalRef);
      intervalRef = undefined;
    }
  };

  const stopTracking = () => {
    trackedSessionId = null;
  };

  const updateQueueProgress = (queueCount) => {
    if (!queueBarEl) {
      return;
    }

    const parsed = Number(queueCount);
    const pct = Number.isFinite(parsed) ? Math.max(10, Math.min(95, Math.floor(parsed * 2.8))) : 88;
    queueBarEl.style.width = `${pct}%`;
  };

  const pollUntilActive = async () => {
    for (let attempt = 0; attempt < 90; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const sessions = await apiRequestWithSchedulerRecovery(
        "/api/sessions/me",
        { auth: true },
        {
          onRecovering: () => {
            if (statusEl) {
              statusEl.textContent = "Recovering scheduler...";
            }
          }
        }
      );
      const tracked = sessions.find((entry) => entry.id === trackedSessionId);

      if (!tracked) {
        continue;
      }

      if (queueEl && tracked.queuePosition) {
        queueEl.textContent = String(tracked.queuePosition);
        updateQueueProgress(tracked.queuePosition);
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
    updateQueueProgress(queue);
    etaEl.textContent = `${eta} min`;
    if (adsCountEl) {
      adsCountEl.textContent = "15";
    }
    if (statusEl) {
      statusEl.textContent = "Connecting...";
    }

    stopSimulation();
    launchRedirected = false;
    const gameName = appState.activeGame || "Fortnite";
    const gameSlug = slugFromGame(gameName);

    const markLaunchUnavailable = (message = "Launch service unavailable") => {
      if (statusEl) {
        statusEl.textContent = message;
      }
      if (etaEl) {
        etaEl.textContent = "Unavailable";
      }
    };

    const ensureSignedIn = async () => {
      if (appState.authToken && appState.authUser) {
        return;
      }
      const error = new Error("Authentication required");
      error.status = 401;
      throw error;
    };

    try {
      await ensureSignedIn();
      const requestResult = await apiRequestWithSchedulerRecovery(
        "/api/sessions/request",
        {
          method: "POST",
          auth: true,
          body: {
            gameSlug
          }
        },
        {
          onRecovering: () => {
            if (statusEl) {
              statusEl.textContent = "Recovering rig service...";
            }
          }
        }
      );

      trackedSessionId = requestResult.session?.id || null;

      let activeSession = requestResult.session;
      if (requestResult.session?.status === "queued") {
        if (statusEl) {
          statusEl.textContent = "Queued";
        }
        if (queueEl && requestResult.queuePosition) {
          queueEl.textContent = String(requestResult.queuePosition);
          updateQueueProgress(requestResult.queuePosition);
        }
        if (etaEl && requestResult.queuePosition) {
          etaEl.textContent = `${Math.max(1, requestResult.queuePosition)} min`;
        }
        const resolved = await pollUntilActive();
        if (!resolved) {
          markLaunchUnavailable("Queue is still pending. Keep waiting or try again.");
          return;
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
        const apiBaseParam = encodeURIComponent(getResolvedApiBase());
        window.location.href = `./play.html?game=${game}&ticket=${ticketId}&apiBase=${apiBaseParam}`;
      }
    } catch (error) {
      const statusCode = Number(error?.status || 0);
      if (statusCode === 401) {
        if (statusEl) {
          statusEl.textContent = "Sign in required";
        }
        window.location.href = "./profile.html?reason=signin-required";
        return;
      }

      if (statusCode === 403) {
        if (statusEl) {
          statusEl.textContent = "Provider link required";
        }
        window.location.href = "./profile.html?reason=provider-link";
        return;
      }

      if (!apiRepairAttempted && isApiConnectionFailure(error)) {
        apiRepairAttempted = true;
        if (statusEl) {
          statusEl.textContent = "Control API not connected";
        }

        const enteredApiBase = window.prompt(
          "Enter your NexForce Control API URL (example: https://your-control-api.example.com)",
          getResolvedApiBase()
        );

        if (enteredApiBase && String(enteredApiBase).trim()) {
          setApiBaseUrl(String(enteredApiBase).trim());
          if (statusEl) {
            statusEl.textContent = "Retrying with saved API URL...";
          }
          await runSimulation();
          return;
        }
      }

      markLaunchUnavailable("Launch service unavailable. Check host connection and retry.");
      console.error(error);
    } finally {
      stopTracking();
    }
  };

  const openModal = (selectedGame = "Cloud Session") => {
    gameName.textContent = selectedGame;
    appState.recentGame = selectedGame;
    appState.activeGame = selectedGame;
    apiRepairAttempted = false;
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

const shouldUseDemoAuthFallback = (error) => {
  const status = Number(error?.status || 0);
  const message = String(error?.message || "").toLowerCase();

  if (status === 0 || message === "failed to fetch") {
    return true;
  }

  if ([404, 502, 503, 504].includes(status)) {
    return true;
  }

  return (
    message.includes("service unavailable") ||
    message.includes("unexpected response format") ||
    message.includes("request failed: 404")
  );
};

export const signInWithPassword = async ({ email, password }) => {
  let result;
  try {
    result = await apiRequest("/api/auth/login", {
      method: "POST",
      body: { email, password }
    });
  } catch (error) {
    if (shouldUseDemoAuthFallback(error)) {
      result = loginDemoUser({ email, password });
    } else {
      throw error;
    }
  }
  appState.authToken = result.token;
  appState.authUser = result.user;
  return result.user;
};

export const registerAccount = async ({ name, email, password, tier = "free" }) => {
  let result;
  try {
    result = await apiRequest("/api/auth/register", {
      method: "POST",
      body: { name, email, password, tier }
    });
  } catch (error) {
    if (shouldUseDemoAuthFallback(error)) {
      result = registerDemoUser({ name, email, password, tier });
    } else {
      throw error;
    }
  }
  appState.authToken = result.token;
  appState.authUser = result.user;
  return result.user;
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
      window.location.href = "./profile.html";
    });
  };

  render();
};