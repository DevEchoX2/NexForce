const process = require("process");

const API_BASE_URL = process.env.NEXFORCE_API_BASE_URL || "http://localhost:5500";
const HOST_KEY = process.env.NEXFORCE_HOST_KEY || "nexforce-host-key";
const HOST_ID = process.env.NEXFORCE_AGENT_HOST_ID || `host-${process.pid}`;
const HOST_NAME = process.env.NEXFORCE_AGENT_HOST_NAME || `NexForce Agent ${HOST_ID}`;
const HOST_REGION = process.env.NEXFORCE_AGENT_REGION || "local";
const HOST_CAPACITY = Number(process.env.NEXFORCE_AGENT_CAPACITY || 1);
const HEARTBEAT_INTERVAL_MS = Number(process.env.NEXFORCE_AGENT_HEARTBEAT_MS || 15000);

let heartbeatTimer = null;
let shuttingDown = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const hostHeaders = {
  "Content-Type": "application/json",
  "x-host-key": HOST_KEY
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

const registerHost = async () => {
  return requestJson("/api/hosts/register", {
    method: "POST",
    headers: hostHeaders,
    body: JSON.stringify({
      hostId: HOST_ID,
      name: HOST_NAME,
      region: HOST_REGION,
      capacity: Number.isFinite(HOST_CAPACITY) && HOST_CAPACITY > 0 ? HOST_CAPACITY : 1
    })
  });
};

const sendHeartbeat = async () => {
  return requestJson(`/api/hosts/${encodeURIComponent(HOST_ID)}/heartbeat`, {
    method: "POST",
    headers: hostHeaders,
    body: JSON.stringify({})
  });
};

const setOffline = async () => {
  return requestJson(`/api/hosts/${encodeURIComponent(HOST_ID)}/offline`, {
    method: "POST",
    headers: hostHeaders,
    body: JSON.stringify({})
  });
};

const heartbeatLoop = async () => {
  if (shuttingDown) {
    return;
  }

  try {
    await sendHeartbeat();
    console.log(`[host-agent] heartbeat ok (${HOST_ID})`);
  } catch (error) {
    console.error(`[host-agent] heartbeat failed (${HOST_ID}): ${error.message}`);
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
  console.log(`[host-agent] starting with API=${API_BASE_URL}, hostId=${HOST_ID}, region=${HOST_REGION}, capacity=${HOST_CAPACITY}`);

  try {
    await registerHost();
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
