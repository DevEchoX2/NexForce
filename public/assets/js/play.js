import {
  apiRequest,
  apiRequestWithSchedulerRecovery,
  appState,
  getResolvedApiBase,
  initAuthShell,
  isSchedulerUnavailableError,
  recoverScheduler,
  setApiBaseUrl,
  toTitle
} from "./app.js";

const getGameFromQuery = () => {
  const params = new URLSearchParams(window.location.search);
  return params.get("game") || appState.activeGame || "Fortnite";
};

const getTicketFromQuery = () => {
  const params = new URLSearchParams(window.location.search);
  return params.get("ticket") || "";
};

const slugFromGameName = (name) =>
  String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");

const msSince = (isoTime) => {
  if (!isoTime) {
    return null;
  }
  const timestamp = new Date(isoTime).getTime();
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return Date.now() - timestamp;
};

const formatAgo = (isoTime) => {
  const elapsed = msSince(isoTime);
  if (elapsed === null) {
    return "Unknown";
  }

  const seconds = Math.max(0, Math.floor(elapsed / 1000));
  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
};

const setText = (selector, value) => {
  const element = document.querySelector(selector);
  if (element) {
    element.textContent = value;
  }
};

const setApiStatus = (message) => {
  setText("[data-api-status]", message);
};

const pickBestSession = (sessions, gameSlug) => {
  if (!Array.isArray(sessions) || sessions.length === 0) {
    return null;
  }

  const byGame = sessions.filter((entry) => slugFromGameName(entry.gameSlug || entry.gameTitle || "") === gameSlug);
  const candidates = byGame.length ? byGame : sessions;

  const active = candidates.find((entry) => entry.status === "active");
  if (active) {
    return active;
  }

  const disconnected = candidates.find((entry) => entry.status === "disconnected");
  if (disconnected) {
    return disconnected;
  }

  const queued = candidates.find((entry) => entry.status === "queued");
  return queued || candidates[0] || null;
};

const renderBaseMeta = (game) => {
  document.querySelectorAll("[data-game-name]").forEach((el) => {
    el.textContent = game;
  });

  setText("[data-plan-name]", toTitle(appState.selectedPlan));
};

const renderDisconnectedState = (message, status = "Waiting") => {
  setText("[data-bootstrap-message]", message);
  setText("[data-session-status]", status);
  setText("[data-session-id]", "—");
  setText("[data-session-state]", "—");
  setText("[data-session-queue]", "—");
  setText("[data-stream-transport]", "—");
  setText("[data-stream-profile]", "—");
  setText("[data-stream-health]", "—");
  setText("[data-host-name]", "—");
  setText("[data-host-region]", "—");
  setText("[data-host-heartbeat]", "—");
  setText("[data-host-status]", "—");
};

const loadLiveStatus = async (gameSlug, ticketId) => {
  if (!appState.authToken || !appState.authUser) {
    window.location.href = "./profile.html?reason=signin-required";
    return;
  }

  const sessions = await apiRequestWithSchedulerRecovery(
    "/api/sessions/me",
    { auth: true },
    {
      onRecovering: () => {
        setText("[data-session-status]", "Recovering");
        setText("[data-bootstrap-message]", "Scheduler was stale. Attempting rig service recovery...");
      }
    }
  );
  const session = pickBestSession(sessions, gameSlug);

  if (!session) {
    renderDisconnectedState("No active or queued cloud session found. Launch a game from Library first.", "No Session");
    return;
  }

  setText("[data-session-id]", session.id || "—");
  setText("[data-session-state]", toTitle(session.status || "unknown"));
  setText("[data-session-queue]", session.queuePosition ? String(session.queuePosition) : "Not queued");

  if (session.status === "queued") {
    setText("[data-session-status]", "Queued");
    setText("[data-bootstrap-message]", "Session is queued. Keep this page open while host capacity is assigned.");
    setText("[data-host-status]", "Waiting for assignment");
    return;
  }

  const [bootstrap, hosts] = await Promise.all([
    apiRequestWithSchedulerRecovery(
      `/api/stream/sessions/${encodeURIComponent(session.id)}/bootstrap`,
      { auth: true },
      {
        onRecovering: () => {
          setText("[data-session-status]", "Recovering");
          setText("[data-bootstrap-message]", "Re-syncing stream bootstrap with host... ");
        }
      }
    ),
    apiRequestWithSchedulerRecovery(
      "/api/hosts",
      { auth: true },
      {
        onRecovering: () => {
          setText("[data-session-status]", "Recovering");
          setText("[data-bootstrap-message]", "Re-syncing host inventory...");
        }
      }
    )
  ]);

  const host = (hosts || []).find((entry) => entry.id === bootstrap?.host?.id) || null;
  const stream = bootstrap?.stream || {};

  if (ticketId) {
    setText("[data-bootstrap-message]", `Launch ticket ${ticketId.slice(0, 8)}… verified with active host session.`);
  } else {
    setText("[data-bootstrap-message]", "Active cloud session found and host stream health is connected.");
  }

  setText("[data-session-status]", session.status === "disconnected" ? "Reconnect" : "Connected");
  setText(
    "[data-stream-transport]",
    `${toTitle(stream.software || "unknown")} + ${toTitle(stream.protocol || "unknown")} via ${toTitle(stream.remoteNetwork || "unknown")}`
  );
  setText(
    "[data-stream-profile]",
    `${stream.profile?.resolution || "—"} @ ${stream.profile?.fps || "—"}fps • ${stream.profile?.bitrateMbps || "—"} Mbps • ${String(
      stream.profile?.codec || "—"
    ).toUpperCase()}`
  );
  setText(
    "[data-stream-health]",
    `${stream.networkType || "unknown"} • jitter ${stream.jitterMs ?? "—"}ms • loss ${stream.packetLossPct ?? "—"}%`
  );

  setText("[data-host-name]", host?.name || bootstrap?.host?.name || "Assigned host");
  setText("[data-host-region]", host?.region || bootstrap?.host?.region || "—");
  setText("[data-host-heartbeat]", host?.lastHeartbeatAt ? formatAgo(host.lastHeartbeatAt) : "Unknown");
  setText("[data-host-status]", toTitle(host?.status || "online"));
};

const init = () => {
  initAuthShell();

  const game = getGameFromQuery();
  const gameSlug = slugFromGameName(game);
  const ticketId = getTicketFromQuery();

  appState.activeGame = game;
  appState.recentGame = game;

  renderBaseMeta(game);
  renderDisconnectedState("Checking launch ticket, session, and host availability...", "Checking");

  const apiInput = document.querySelector("[data-api-base-input]");
  const saveApiButton = document.querySelector("[data-api-base-save]");
  const testApiButton = document.querySelector("[data-api-base-test]");

  if (apiInput) {
    apiInput.value = getResolvedApiBase();
  }

  setApiStatus(`Current API: ${getResolvedApiBase()}`);

  const refresh = async () => {
    try {
      await loadLiveStatus(gameSlug, ticketId);
      setApiStatus(`Connected to API: ${getResolvedApiBase()}`);
    } catch (error) {
      const statusCode = Number(error?.status || 0);
      if (statusCode === 401) {
        window.location.href = "./profile.html?reason=signin-required";
        return;
      }

      if (isSchedulerUnavailableError(error)) {
        renderDisconnectedState("Scheduler is temporarily unavailable. Retry in a few seconds.", "Degraded");
        setApiStatus(`Scheduler unavailable on API: ${getResolvedApiBase()}`);
        return;
      }

      if (statusCode >= 500) {
        setApiStatus(`API error ${statusCode} from ${getResolvedApiBase()}`);
      } else {
        setApiStatus(`Connection failed: ${getResolvedApiBase()}`);
      }

      renderDisconnectedState("Could not read live host/session status right now.", "Unavailable");
      console.error(error);
    }
  };

  const refreshButton = document.querySelector("[data-refresh-status]");
  refreshButton?.addEventListener("click", () => {
    refresh();
  });

  const retryButton = document.querySelector("[data-retry-connect]");
  retryButton?.addEventListener("click", () => {
    refresh();
  });

  saveApiButton?.addEventListener("click", () => {
    const inputValue = String(apiInput?.value || "").trim();
    if (!inputValue) {
      setApiBaseUrl("");
      if (apiInput) {
        apiInput.value = getResolvedApiBase();
      }
      setApiStatus(`API reset to: ${getResolvedApiBase()}`);
      refresh();
      return;
    }

    const normalized = setApiBaseUrl(inputValue);
    if (apiInput) {
      apiInput.value = normalized;
    }
    setApiStatus(`Saved API: ${normalized}`);
    refresh();
  });

  testApiButton?.addEventListener("click", async () => {
    setApiStatus("Testing API connection...");
    try {
      const health = await apiRequest("/api/health");
      setApiStatus(`API OK (${health.status || "ok"}) at ${getResolvedApiBase()}`);
    } catch (error) {
      setApiStatus(`API test failed at ${getResolvedApiBase()}`);
      console.error(error);
    }
  });

  const recoverButton = document.querySelector("[data-recover-scheduler]");
  recoverButton?.addEventListener("click", async () => {
    setText("[data-session-status]", "Recovering");
    setText("[data-bootstrap-message]", "Running scheduler recovery tick...");
    const result = await recoverScheduler();
    if (!result.recovered) {
      renderDisconnectedState("Rig service recovery failed. Verify API URL and backend process.", "Unavailable");
      setApiStatus(`Recovery failed at ${getResolvedApiBase()}`);
      return;
    }

    setApiStatus(`Rig service recovered via ${getResolvedApiBase()}`);
    await refresh();
  });

  refresh();
  setInterval(refresh, 10000);
};

init();
