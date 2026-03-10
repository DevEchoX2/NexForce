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

  let launchReadyButton = modal.querySelector("[data-launch-ready]");
  if (!launchReadyButton && statusEl?.parentElement) {
    launchReadyButton = document.createElement("button");
    launchReadyButton.setAttribute("data-launch-ready", "");
    launchReadyButton.disabled = true;
    launchReadyButton.className =
      "mt-4 hidden w-full rounded-lg border border-primary/70 bg-primary/80 px-4 py-2 text-sm font-semibold text-black transition disabled:cursor-not-allowed disabled:opacity-60";
    launchReadyButton.textContent = "Enter Game";
    statusEl.insertAdjacentElement("afterend", launchReadyButton);
  }

  let pollRef;
  let flowId = 0;
  let pollInFlight = false;
  let launchRedirected = false;
  let activeTicketId = "";
  let activeGame = appState.activeGame || "Fortnite";
  let initialQueuePosition = null;
  let canLaunch = false;

  const stopPolling = () => {
    if (pollRef) {
      clearInterval(pollRef);
      pollRef = undefined;
    }
    pollInFlight = false;
  };

  const setStatus = (message) => {
    if (statusEl) {
      statusEl.textContent = message;
    }
  };

  const setLaunchButtonState = (ready) => {
    canLaunch = Boolean(ready);
    if (!launchReadyButton) {
      return;
    }

    launchReadyButton.classList.toggle("hidden", !canLaunch);
    launchReadyButton.disabled = !canLaunch;
  };

  const updateQueueProgress = (queueCount) => {
    if (!queueBarEl) {
      return;
    }

    const parsed = Number(queueCount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      queueBarEl.style.width = "10%";
      return;
    }

    if (initialQueuePosition === null || parsed > initialQueuePosition) {
      initialQueuePosition = parsed;
    }

    const start = Math.max(2, Number(initialQueuePosition) || parsed);
    const normalized = parsed <= 1 ? 100 : ((start - parsed) / (start - 1)) * 100;
    const pct = Math.max(10, Math.min(100, Math.round(normalized)));
    queueBarEl.style.width = `${pct}%`;
  };

  const formatEta = (etaSec) => {
    const value = Number(etaSec);
    if (!Number.isFinite(value) || value <= 0) {
      return "Ready";
    }

    const minutes = Math.ceil(value / 60);
    return `${Math.max(1, minutes)} min`;
  };

  const applyPlanTelemetry = () => {
    const selectedPlan = appState.selectedPlan;
    if (latencyEl) {
      latencyEl.textContent = selectedPlan === "ultimate" ? "12 ms" : selectedPlan === "performance" ? "18 ms" : "26 ms";
    }
    if (fpsEl) {
      fpsEl.textContent = selectedPlan === "ultimate" ? "132 FPS" : selectedPlan === "performance" ? "112 FPS" : "88 FPS";
    }
    if (adsCountEl) {
      adsCountEl.textContent = "15";
    }
  };

  const applyQueueState = (state) => {
    const queuePosition = Number(state?.queuePosition);
    const etaSec = Number(state?.etaSec);
    const status = String(state?.status || "queued");
    const ready = Boolean(state?.canLaunch);

    if (queueEl) {
      queueEl.textContent = Number.isFinite(queuePosition)
        ? String(Math.max(1, status === "launched" ? 0 : queuePosition))
        : "--";
    }
    updateQueueProgress(queuePosition);

    if (etaEl) {
      etaEl.textContent = status === "launched" ? "Started" : formatEta(etaSec);
    }

    if (status === "launched") {
      setStatus("Session started.");
      setLaunchButtonState(false);
      return;
    }

    if (ready) {
      setStatus("Queue complete. Press Enter Game.");
      setLaunchButtonState(true);
      return;
    }

    setStatus("Queued. Holding your spot...");
    setLaunchButtonState(false);
  };

  const startPolling = (currentFlowId) => {
    stopPolling();

    pollRef = setInterval(async () => {
      if (pollInFlight || !activeTicketId || launchRedirected) {
        return;
      }

      pollInFlight = true;

      try {
        const nextState = await apiRequest(`/api/launcher/queue/${encodeURIComponent(activeTicketId)}`, {
          auth: true
        });

        if (flowId !== currentFlowId || modal.classList.contains("hidden")) {
          return;
        }

        applyQueueState(nextState);
        if (nextState?.canLaunch) {
          stopPolling();
        }
      } catch (error) {
        if (flowId !== currentFlowId || modal.classList.contains("hidden")) {
          return;
        }

        if (error?.status === 404) {
          stopPolling();
          setStatus("Queue ticket expired. Please relaunch.");
          setLaunchButtonState(false);
        } else if (error?.status === 401) {
          stopPolling();
          setStatus("Sign in required to continue queueing.");
          setLaunchButtonState(false);
        } else {
          setStatus("Reconnecting to queue...");
        }
      } finally {
        pollInFlight = false;
      }
    }, 2000);
  };

  const startQueueFlow = async (selectedGame, currentFlowId) => {
    activeTicketId = "";
    initialQueuePosition = null;
    launchRedirected = false;
    setLaunchButtonState(false);
    setStatus("Joining queue...");

    applyPlanTelemetry();

    if (queueEl) {
      queueEl.textContent = "--";
    }
    if (etaEl) {
      etaEl.textContent = "--";
    }
    updateQueueProgress(null);

    const resolvedGame = selectedGame && selectedGame !== "Cloud Session" ? selectedGame : appState.activeGame || "Fortnite";
    const gameSlug = slugFromGame(resolvedGame);

    try {
      const queueState = await apiRequest("/api/launcher/queue/join", {
        method: "POST",
        auth: true,
        body: { gameSlug }
      });

      if (flowId !== currentFlowId || modal.classList.contains("hidden")) {
        return;
      }

      activeTicketId = String(queueState.ticketId || "");
      applyQueueState(queueState);

      if (!queueState?.canLaunch) {
        startPolling(currentFlowId);
      }
    } catch (error) {
      if (flowId !== currentFlowId || modal.classList.contains("hidden")) {
        return;
      }

      if (error?.status === 401) {
        setStatus("Sign in required before joining queue.");
      } else if (error?.status === 403 && error?.payload?.requiredPlan) {
        setStatus(`Upgrade required: ${toTitle(String(error.payload.requiredPlan))} plan.`);
      } else {
        setStatus(error?.message || "Unable to join queue right now.");
      }

      setLaunchButtonState(false);
    }
  };

  const openModal = (selectedGame = "Cloud Session") => {
    const resolvedGame = selectedGame && selectedGame !== "Cloud Session" ? selectedGame : appState.activeGame || "Fortnite";
    activeGame = resolvedGame;
    gameName.textContent = resolvedGame;
    appState.recentGame = resolvedGame;
    appState.activeGame = resolvedGame;

    flowId += 1;
    modal.classList.remove("hidden");
    document.body.classList.add("overflow-hidden");
    startQueueFlow(resolvedGame, flowId);
  };

  const closeModal = () => {
    flowId += 1;
    modal.classList.add("hidden");
    document.body.classList.remove("overflow-hidden");
    stopPolling();
    activeTicketId = "";
    setLaunchButtonState(false);
  };

  launchReadyButton?.addEventListener("click", async () => {
    if (!canLaunch || !activeTicketId || launchRedirected) {
      return;
    }

    launchReadyButton.disabled = true;
    setStatus("Starting cloud session...");

    try {
      const response = await apiRequest(`/api/launcher/queue/${encodeURIComponent(activeTicketId)}/launch`, {
        method: "POST",
        auth: true
      });

      launchRedirected = true;
      setStatus("Opening game player...");
      const game = encodeURIComponent(response?.gameTitle || activeGame || "Cloud Session");
      window.location.href = `./play.html?game=${game}`;
    } catch (error) {
      if (error?.status === 409) {
        applyQueueState(error?.payload || {});
      } else if (error?.status === 401) {
        setStatus("Sign in required to launch.");
      } else {
        setStatus(error?.message || "Unable to launch session right now.");
      }

      launchReadyButton.disabled = !canLaunch;
    }
  });

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