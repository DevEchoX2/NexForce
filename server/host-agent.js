const process = require("process");

const API_BASE_URL = process.env.NEXFORCE_API_BASE_URL || "http://localhost:5500";
const HOST_KEY = process.env.NEXFORCE_HOST_KEY || "nexforce-host-key";
const HOST_ID = process.env.NEXFORCE_AGENT_HOST_ID || `host-${process.pid}`;
const HOST_NAME = process.env.NEXFORCE_AGENT_HOST_NAME || `NexForce Agent ${HOST_ID}`;
const HOST_REGION = process.env.NEXFORCE_AGENT_REGION || "local";
const HOST_CAPACITY = Number(process.env.NEXFORCE_AGENT_CAPACITY || 40);
const HOST_MODE = process.env.NEXFORCE_AGENT_MODE || "active";
const HOST_GPU_TIER = process.env.NEXFORCE_AGENT_GPU_TIER || "basic";
const HOST_MAX_FPS = Number(process.env.NEXFORCE_AGENT_MAX_FPS || 60);
const HOST_SUPPORTED_GAMES = (process.env.NEXFORCE_AGENT_SUPPORTED_GAMES || "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);
const HOST_FREE_RESERVED_MIN = Number(process.env.NEXFORCE_AGENT_FREE_RESERVED_MIN || 0);
const HOST_PERFORMANCE_RESERVED_MIN = Number(process.env.NEXFORCE_AGENT_PERFORMANCE_RESERVED_MIN || 0);
const HOST_ULTIMATE_RESERVED_MIN = Number(process.env.NEXFORCE_AGENT_ULTIMATE_RESERVED_MIN || 0);
const HEARTBEAT_INTERVAL_MS = Number(process.env.NEXFORCE_AGENT_HEARTBEAT_MS || 15000);
const STREAM_SOFTWARE = process.env.NEXFORCE_AGENT_STREAM_SOFTWARE || "sunshine";
const STREAM_PROTOCOL = process.env.NEXFORCE_AGENT_STREAM_PROTOCOL || "moonlight";
const STREAM_REMOTE_NETWORK = process.env.NEXFORCE_AGENT_STREAM_REMOTE_NETWORK || "tailscale";
const STREAM_BACKUP_CONTROL = process.env.NEXFORCE_AGENT_STREAM_BACKUP_CONTROL || "parsec";
const STREAM_AUDIO_READY = (process.env.NEXFORCE_AGENT_AUDIO_READY || "true").toLowerCase() !== "false";
const STREAM_NETWORK_OK = (process.env.NEXFORCE_AGENT_NETWORK_OK || "true").toLowerCase() !== "false";
const STREAM_NETWORK_TYPE = process.env.NEXFORCE_AGENT_NETWORK_TYPE || "ethernet";
const STREAM_UPLINK_MBPS = Number(process.env.NEXFORCE_AGENT_UPLINK_MBPS || 100);
const STREAM_DOWNLINK_MBPS = Number(process.env.NEXFORCE_AGENT_DOWNLINK_MBPS || 100);
const STREAM_JITTER_MS = Number(process.env.NEXFORCE_AGENT_JITTER_MS || 8);
const STREAM_PACKET_LOSS_PCT = Number(process.env.NEXFORCE_AGENT_PACKET_LOSS_PCT || 0);
const STREAM_PROFILE_RESOLUTION = process.env.NEXFORCE_AGENT_STREAM_RESOLUTION || "1080p";
const STREAM_PROFILE_FPS = Number(process.env.NEXFORCE_AGENT_STREAM_FPS || 60);
const STREAM_PROFILE_BITRATE_MBPS = Number(process.env.NEXFORCE_AGENT_STREAM_BITRATE_MBPS || 20);
const STREAM_PROFILE_CODEC = process.env.NEXFORCE_AGENT_STREAM_CODEC || "hevc";
const RETRY_BASE_MS = Number(process.env.NEXFORCE_AGENT_RETRY_BASE_MS || 1000);
const RETRY_MAX_MS = Number(process.env.NEXFORCE_AGENT_RETRY_MAX_MS || 15000);
const REGISTER_MAX_RETRIES = Number(process.env.NEXFORCE_AGENT_REGISTER_MAX_RETRIES || 10);
const HEARTBEAT_FAILURE_THRESHOLD = Number(process.env.NEXFORCE_AGENT_HEARTBEAT_FAILURE_THRESHOLD || 3);
const WAIT_FOR_API_ON_STARTUP = (process.env.NEXFORCE_AGENT_WAIT_FOR_API_ON_STARTUP || "true").toLowerCase() !== "false";

let heartbeatTimer = null;
let shuttingDown = false;
let heartbeatInFlight = false;
let heartbeatFailureCount = 0;
let recoveringRegistration = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const asPositiveInt = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
};

const effectiveRetryBaseMs = asPositiveInt(RETRY_BASE_MS, 1000);
const effectiveRetryMaxMs = asPositiveInt(RETRY_MAX_MS, 15000);
const effectiveHeartbeatFailureThreshold = asPositiveInt(HEARTBEAT_FAILURE_THRESHOLD, 3);
const effectiveRegisterMaxRetries = Number.isFinite(REGISTER_MAX_RETRIES) ? Math.floor(REGISTER_MAX_RETRIES) : 10;

const hostHeaders = {
  "Content-Type": "application/json",
  "x-host-key": HOST_KEY
};

const getStreamHealthPayload = () => {
  return {
    streamSoftware: String(STREAM_SOFTWARE || "sunshine").toLowerCase(),
    streamProtocol: String(STREAM_PROTOCOL || "moonlight").toLowerCase(),
    remoteNetwork: String(STREAM_REMOTE_NETWORK || "tailscale").toLowerCase(),
    backupControl: String(STREAM_BACKUP_CONTROL || "parsec").toLowerCase(),
    audioReady: STREAM_AUDIO_READY,
    networkOk: STREAM_NETWORK_OK,
    networkType: String(STREAM_NETWORK_TYPE || "ethernet").toLowerCase(),
    uplinkMbps: Number.isFinite(STREAM_UPLINK_MBPS) && STREAM_UPLINK_MBPS >= 0 ? Math.floor(STREAM_UPLINK_MBPS) : 100,
    downlinkMbps: Number.isFinite(STREAM_DOWNLINK_MBPS) && STREAM_DOWNLINK_MBPS >= 0 ? Math.floor(STREAM_DOWNLINK_MBPS) : 100,
    jitterMs: Number.isFinite(STREAM_JITTER_MS) && STREAM_JITTER_MS >= 0 ? Math.floor(STREAM_JITTER_MS) : 8,
    packetLossPct: Number.isFinite(STREAM_PACKET_LOSS_PCT) && STREAM_PACKET_LOSS_PCT >= 0 ? Number(STREAM_PACKET_LOSS_PCT) : 0,
    streamProfile: {
      resolution: STREAM_PROFILE_RESOLUTION || "1080p",
      fps: Number.isFinite(STREAM_PROFILE_FPS) && STREAM_PROFILE_FPS > 0 ? Math.floor(STREAM_PROFILE_FPS) : 60,
      bitrateMbps:
        Number.isFinite(STREAM_PROFILE_BITRATE_MBPS) && STREAM_PROFILE_BITRATE_MBPS > 0
          ? Math.floor(STREAM_PROFILE_BITRATE_MBPS)
          : 20,
      codec: String(STREAM_PROFILE_CODEC || "hevc").toLowerCase()
    },
    updatedAt: new Date().toISOString()
  };
};

const requestJson = async (path, options = {}) => {
  const response = await fetch(`${API_BASE_URL}${path}`, options);
  const bodyText = await response.text();
  let parsed = {};

  if (bodyText) {
    try {
      parsed = JSON.parse(bodyText);
    } catch (_error) {
      parsed = { raw: bodyText };
    }
  }

  if (!response.ok) {
    const message = parsed.error || response.statusText || "Request failed";
    throw new Error(`${response.status} ${message}`);
  }

  return parsed;
};

const getRetryDelayMs = (attemptNumber) => {
  const exponential = effectiveRetryBaseMs * 2 ** Math.max(0, attemptNumber - 1);
  const bounded = Math.min(effectiveRetryMaxMs, exponential);
  const jitter = Math.floor(Math.random() * Math.floor(bounded * 0.2 + 1));
  return bounded + jitter;
};

const withRetries = async (operationName, operation, maxRetries) => {
  let attempt = 0;

  while (true) {
    attempt += 1;

    try {
      return await operation();
    } catch (error) {
      const retryable = maxRetries < 0 || attempt <= maxRetries;
      if (!retryable) {
        throw error;
      }

      const delayMs = getRetryDelayMs(attempt);
      console.error(`[host-agent] ${operationName} failed (attempt ${attempt}): ${error.message}; retry in ${delayMs}ms`);
      await sleep(delayMs);
    }
  }
};

const registerHost = async () => {
  return requestJson("/api/hosts/register", {
    method: "POST",
    headers: hostHeaders,
    body: JSON.stringify({
      hostId: HOST_ID,
      name: HOST_NAME,
      region: HOST_REGION,
      capacity: Number.isFinite(HOST_CAPACITY) && HOST_CAPACITY > 0 ? HOST_CAPACITY : 1,
      mode: HOST_MODE,
      capabilities: {
        supportedGames: HOST_SUPPORTED_GAMES,
        gpuTier: HOST_GPU_TIER,
        maxFps: Number.isFinite(HOST_MAX_FPS) && HOST_MAX_FPS > 0 ? Math.floor(HOST_MAX_FPS) : 60
      },
      slotPolicy: {
        freeReservedMin: Number.isFinite(HOST_FREE_RESERVED_MIN) && HOST_FREE_RESERVED_MIN >= 0 ? Math.floor(HOST_FREE_RESERVED_MIN) : 0,
        performanceReservedMin:
          Number.isFinite(HOST_PERFORMANCE_RESERVED_MIN) && HOST_PERFORMANCE_RESERVED_MIN >= 0
            ? Math.floor(HOST_PERFORMANCE_RESERVED_MIN)
            : 0,
        ultimateReservedMin:
          Number.isFinite(HOST_ULTIMATE_RESERVED_MIN) && HOST_ULTIMATE_RESERVED_MIN >= 0
            ? Math.floor(HOST_ULTIMATE_RESERVED_MIN)
            : 0
      },
      streamHealth: getStreamHealthPayload()
    })
  });
};

const sendHeartbeat = async () => {
  return requestJson(`/api/hosts/${encodeURIComponent(HOST_ID)}/heartbeat`, {
    method: "POST",
    headers: hostHeaders,
    body: JSON.stringify({ streamHealth: getStreamHealthPayload() })
  });
};

const setOffline = async () => {
  return requestJson(`/api/hosts/${encodeURIComponent(HOST_ID)}/offline`, {
    method: "POST",
    headers: hostHeaders,
    body: JSON.stringify({})
  });
};

const waitForApiReadiness = async () => {
  if (!WAIT_FOR_API_ON_STARTUP) {
    return;
  }

  await withRetries(
    "api health check",
    async () => requestJson("/api/health", { method: "GET" }),
    effectiveRegisterMaxRetries
  );
};

const registerHostWithRecovery = async () => {
  return withRetries("host register", registerHost, effectiveRegisterMaxRetries);
};

const heartbeatLoop = async () => {
  if (shuttingDown || heartbeatInFlight) {
    return;
  }

  heartbeatInFlight = true;

  try {
    await sendHeartbeat();
    heartbeatFailureCount = 0;
    console.log(`[host-agent] heartbeat ok (${HOST_ID})`);
  } catch (error) {
    heartbeatFailureCount += 1;
    console.error(`[host-agent] heartbeat failed (${HOST_ID}): ${error.message}`);

    if (heartbeatFailureCount >= effectiveHeartbeatFailureThreshold && !recoveringRegistration && !shuttingDown) {
      recoveringRegistration = true;

      try {
        console.log(`[host-agent] heartbeat failures reached threshold (${heartbeatFailureCount}), re-registering host...`);
        await registerHostWithRecovery();
        heartbeatFailureCount = 0;
        console.log(`[host-agent] host re-registered (${HOST_ID})`);
      } catch (registerError) {
        console.error(`[host-agent] host re-register failed (${HOST_ID}): ${registerError.message}`);
      } finally {
        recoveringRegistration = false;
      }
    }
  } finally {
    heartbeatInFlight = false;
  }
};

const startHeartbeats = () => {
  heartbeatTimer = setInterval(() => {
    heartbeatLoop().catch((error) => {
      console.error(`[host-agent] heartbeat loop error: ${error.message}`);
    });
  }, HEARTBEAT_INTERVAL_MS);

  if (typeof heartbeatTimer.unref === "function") {
    heartbeatTimer.unref();
  }
};

const shutdown = async (signal) => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
  }

  console.log(`[host-agent] ${signal} received, setting host offline...`);

  try {
    await setOffline();
    console.log(`[host-agent] host offline (${HOST_ID})`);
  } catch (error) {
    console.error(`[host-agent] offline update failed (${HOST_ID}): ${error.message}`);
  }

  await sleep(25);
  process.exit(0);
};

const bootstrap = async () => {
  console.log(
    `[host-agent] starting with API=${API_BASE_URL}, hostId=${HOST_ID}, region=${HOST_REGION}, capacity=${HOST_CAPACITY}, mode=${HOST_MODE}, gpuTier=${HOST_GPU_TIER}, maxFps=${HOST_MAX_FPS}, stream=${STREAM_SOFTWARE}/${STREAM_PROTOCOL}/${STREAM_REMOTE_NETWORK}, audioReady=${STREAM_AUDIO_READY}, networkOk=${STREAM_NETWORK_OK}, netType=${STREAM_NETWORK_TYPE}, reserves=${HOST_FREE_RESERVED_MIN}/${HOST_PERFORMANCE_RESERVED_MIN}/${HOST_ULTIMATE_RESERVED_MIN}`
  );

  try {
    await waitForApiReadiness();
    await registerHostWithRecovery();
    console.log(`[host-agent] registered host (${HOST_ID})`);
  } catch (error) {
    console.error(`[host-agent] initial register failed: ${error.message}`);
    process.exit(1);
    return;
  }

  await heartbeatLoop();
  startHeartbeats();
};

process.on("SIGINT", () => {
  shutdown("SIGINT").catch((error) => {
    console.error(`[host-agent] shutdown error: ${error.message}`);
    process.exit(1);
  });
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM").catch((error) => {
    console.error(`[host-agent] shutdown error: ${error.message}`);
    process.exit(1);
  });
});

bootstrap().catch((error) => {
  console.error(`[host-agent] fatal error: ${error.message}`);
  process.exit(1);
});
