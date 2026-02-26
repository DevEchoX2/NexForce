import { apiRequest, appState, initAuthShell, toTitle } from "./app.js";
import { TRANSPORT_MODES, resolveTransportMode } from "./settings.js";

const supportedGameSlugs = new Set(["fortnite", "roblox", "fall-guys", "rocket-league"]);

const getGameFromQuery = () => {
  const params = new URLSearchParams(window.location.search);
  return params.get("game") || appState.activeGame || "Fortnite";
};

const slugFromGameName = (name) =>
  String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");

const setPanelText = (selector, value) => {
  const element = document.querySelector(selector);
  if (!element || value === undefined || value === null) {
    return;
  }
  element.textContent = String(value);
};

const getTransportStatusText = ({ mode, reason }) => {
  if (mode === TRANSPORT_MODES.webrtc) {
    return "Live Session · WebRTC";
  }

  if (reason === "forced_compatibility") {
    return "Live Session · Compatibility";
  }

  return "Live Session · Compatibility (fallback)";
};

const getTransportBadgeText = ({ mode, reason }) => {
  if (mode === TRANSPORT_MODES.webrtc) {
    return "WebRTC";
  }

  if (reason === "forced_compatibility") {
    return "Compatibility";
  }

  return "Compatibility (Fallback)";
};

const getTransportHelpText = ({ mode, reason }) => {
  if (mode === TRANSPORT_MODES.webrtc) {
    return "Host stream bootstrap ready. Open the stream client when host status is healthy.";
  }

  if (reason === "forced_compatibility") {
    return "Compatibility mode active. Stream still runs through Sunshine + Moonlight host setup.";
  }

  return "Compatibility mode active (WebRTC unavailable). Use Moonlight client over Tailscale.";
};

let rigTimeUnlocked = false;
let remainingSessionSeconds = null;
let rigSidebarOpen = false;

const formatRemainingTime = (seconds) => {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
};

const updateRigTimeDisplay = () => {
  const valueEl = document.querySelector("[data-rig-time-left]");
  const noteEl = document.querySelector("[data-rig-time-note]");
  if (!valueEl || !noteEl) {
    return;
  }

  if (!rigTimeUnlocked) {
    valueEl.textContent = "Locked";
    noteEl.textContent = "Press 🙏 on the left to reveal hours/minutes.";
    return;
  }

  if (Number.isFinite(remainingSessionSeconds)) {
    valueEl.textContent = formatRemainingTime(remainingSessionSeconds);
    noteEl.textContent = "Remaining in your current cloud session.";
    return;
  }

  valueEl.textContent = "No active timer";
  noteEl.textContent = "Start a session to see hours/minutes left.";
};

const initRigTimeUnlock = () => {
  const unlockButton = document.querySelector("[data-rig-unlock]");
  const rigSidebar = document.querySelector("[data-rig-sidebar]");
  if (!unlockButton) {
    return;
  }

  const applySidebarState = () => {
    if (!rigSidebar) {
      return;
    }

    rigSidebar.style.transform = rigSidebarOpen
      ? "translateX(0) translateY(-50%)"
      : "translateX(calc(-100% + 2.85rem)) translateY(-50%)";
    unlockButton.setAttribute("aria-expanded", rigSidebarOpen ? "true" : "false");
  };

  unlockButton.addEventListener("click", () => {
    if (!rigTimeUnlocked) {
      rigTimeUnlocked = true;
    }
    rigSidebarOpen = !rigSidebarOpen;
    applySidebarState();
    updateRigTimeDisplay();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !rigSidebarOpen) {
      return;
    }
    rigSidebarOpen = false;
    applySidebarState();
  });

  applySidebarState();
  updateRigTimeDisplay();
};

const findActiveSession = async (gameSlug) => {
  const sessions = await apiRequest("/api/sessions/me", { auth: true });
  return (
    (sessions || []).find(
      (entry) => (entry.status === "active" || entry.status === "disconnected") && entry.gameSlug === gameSlug
    ) || null
  );
};

const hydrateRigPanel = async (gameSlug) => {
  setPanelText("[data-rig-max]", 40);

  if (!appState.authToken) {
    return null;
  }

  try {
    const [activeSession, rigSnapshot] = await Promise.all([
      findActiveSession(gameSlug),
      apiRequest("/api/launch/service/rigs", { auth: true })
    ]);

    if (activeSession && Number.isFinite(Number(activeSession.remainingSec))) {
      remainingSessionSeconds = Number(activeSession.remainingSec);
    } else {
      remainingSessionSeconds = null;
    }
    updateRigTimeDisplay();

    let rig = null;
    if (activeSession?.hostId) {
      rig = (rigSnapshot?.rigs || []).find((entry) => entry.rigId === activeSession.hostId) || null;
    }

    if (!rig) {
      rig = (rigSnapshot?.rigs || [])[0] || null;
    }

    if (rig) {
      setPanelText("[data-rig-name]", rig.name || rig.rigId || "NexForce RTX Pod");
      setPanelText("[data-rig-region]", `Region: ${rig.region || "local"}`);
      setPanelText("[data-rig-active]", Number.isFinite(Number(rig.activeUsers)) ? Number(rig.activeUsers) : 0);
      setPanelText("[data-rig-max]", Number.isFinite(Number(rig.maxUsers)) ? Number(rig.maxUsers) : 40);
      setPanelText("[data-rig-available]", Number.isFinite(Number(rig.availableUsers)) ? Number(rig.availableUsers) : 0);
      setPanelText("[data-rig-load]", `${Number.isFinite(Number(rig.saturationPct)) ? Number(rig.saturationPct) : 0}%`);
      setPanelText("[data-rig-state]", rig.acceptingUsers ? "Ready" : "At Capacity");
    }

    return activeSession;
  } catch {
    return null;
  }
};

const hydrateStreamBootstrap = async (activeSession) => {
  if (!activeSession?.id) {
    setPanelText("[data-runtime-overlay]", "No active host session found. Launch from Library to start one.");
    return null;
  }

  try {
    const bootstrap = await apiRequest(`/api/stream/sessions/${encodeURIComponent(activeSession.id)}/bootstrap`, { auth: true });
    const stream = bootstrap?.stream || {};

    setPanelText("[data-stream-host]", bootstrap?.host?.name || "Pending");
    setPanelText("[data-stream-network]", stream.networkType || "Pending");
    setPanelText("[data-stream-software]", toTitle(String(stream.software || "sunshine")));
    setPanelText("[data-stream-client]", toTitle(String(stream.protocol || "moonlight")));
    setPanelText("[data-stream-remote]", toTitle(String(stream.remoteNetwork || "tailscale")));
    setPanelText("[data-stream-backup]", toTitle(String(stream.backupControl || "parsec")));

    const healthy = stream.audioReady !== false && stream.networkOk !== false;
    setPanelText(
      "[data-runtime-overlay]",
      healthy
        ? "Host stream is ready. Open stream client to continue on your Sunshine host."
        : "Host stream checks are not healthy yet (audio/network). Verify host setup from host.md."
    );

    return {
      healthy,
      sessionId: activeSession.id,
      gameSlug: activeSession.gameSlug
    };
  } catch {
    setPanelText("[data-runtime-overlay]", "Host bootstrap unavailable. Check host heartbeat and stream-health APIs.");
    return null;
  }
};

const initOpenStreamButton = (sessionContext) => {
  const button = document.querySelector("[data-open-stream]");
  if (!button) {
    return;
  }

  button.disabled = !sessionContext?.healthy;

  button.addEventListener("click", async () => {
    if (!sessionContext?.sessionId || !sessionContext?.gameSlug) {
      return;
    }

    button.disabled = true;
    setPanelText("[data-runtime-overlay]", "Requesting provider launch ticket...");

    try {
      const ticket = await apiRequest("/api/launch/ticket", {
        method: "POST",
        auth: true,
        body: {
          gameSlug: sessionContext.gameSlug,
          sessionId: sessionContext.sessionId
        }
      });

      if (ticket?.launchUrl) {
        window.open(ticket.launchUrl, "_blank", "noopener,noreferrer");
        setPanelText("[data-runtime-overlay]", "Provider launch opened. Continue in Moonlight from your host PC session.");
        return;
      }

      setPanelText("[data-runtime-overlay]", "Launch ticket issued but no provider URL returned.");
    } catch (error) {
      const provider = error?.payload?.provider;
      if (provider) {
        setPanelText("[data-runtime-overlay]", `Link your ${toTitle(provider)} account first, then retry Open Stream Client.`);
      } else {
        setPanelText("[data-runtime-overlay]", "Could not open provider launch. Verify integrations and session state.");
      }
    } finally {
      button.disabled = false;
    }
  });
};

const init = async () => {
  initAuthShell();

  if (!appState.authToken || !appState.authUser) {
    window.location.href = "./profile.html?reason=signin-required";
    return;
  }

  initRigTimeUnlock();

  const game = getGameFromQuery();
  appState.activeGame = game;
  appState.recentGame = game;
  const gameSlug = slugFromGameName(game);

  if (!supportedGameSlugs.has(gameSlug)) {
    window.location.href = "./library.html";
    return;
  }

  const gameNameEls = document.querySelectorAll("[data-game-name]");
  gameNameEls.forEach((el) => {
    el.textContent = game;
  });

  const planEl = document.querySelector("[data-plan-name]");
  if (planEl) {
    planEl.textContent = toTitle(appState.selectedPlan);
  }

  const statusEl = document.querySelector("[data-session-status]");
  if (statusEl) {
    statusEl.textContent = "Connecting...";
  }

  const transport = await resolveTransportMode();

  if (statusEl) {
    statusEl.textContent = getTransportStatusText(transport);
  }

  const transportBadgeEl = document.querySelector("[data-transport-badge]");
  if (transportBadgeEl) {
    transportBadgeEl.textContent = getTransportBadgeText(transport);
  }

  const helpEl = document.querySelector("[data-runtime-help]");
  if (helpEl) {
    helpEl.textContent = getTransportHelpText(transport);
  }

  const activeSession = await hydrateRigPanel(gameSlug);
  const sessionContext = await hydrateStreamBootstrap(activeSession);
  initOpenStreamButton(sessionContext);
};

init().catch((error) => {
  console.error(error);
});
