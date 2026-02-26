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

const findActiveSession = async (gameSlug) => {
  const sessions = await apiRequest("/api/sessions/me", { auth: true });
  return (
    (sessions || []).find(
      (entry) => (entry.status === "active" || entry.status === "disconnected") && entry.gameSlug === gameSlug
    ) || null
  );
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

  const activeSession = await findActiveSession(gameSlug);
  const sessionContext = await hydrateStreamBootstrap(activeSession);
  initOpenStreamButton(sessionContext);
};

init().catch((error) => {
  console.error(error);
});
