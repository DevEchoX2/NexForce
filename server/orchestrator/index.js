const express = require("express");

const app = express();
app.use(express.json());

const PORT = Number(process.env.ORCHESTRATOR_PORT || 5600);
const CONTROL_API_URL = process.env.CONTROL_API_URL || "http://localhost:5500";
const ORCHESTRATOR_KEY = process.env.NEXFORCE_ORCHESTRATOR_KEY || "nexforce-orchestrator-key";
const TICK_MS = Number(process.env.ORCHESTRATOR_TICK_MS || 5000);

const state = {
  startedAt: new Date().toISOString(),
  tickMs: TICK_MS,
  controlApiUrl: CONTROL_API_URL,
  totalTicks: 0,
  successTicks: 0,
  failedTicks: 0,
  lastTickAt: null,
  lastResult: null,
  lastError: null,
  lastErrorAt: null,
  running: false
};

const callControlTick = async () => {
  const response = await fetch(`${CONTROL_API_URL}/internal/orchestrator/tick`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-orchestrator-key": ORCHESTRATOR_KEY
    },
    body: JSON.stringify({ forceWrite: false })
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(payload.error || `Control tick failed (${response.status})`);
  }

  return payload;
};

const tick = async () => {
  if (state.running) {
    return;
  }

  state.running = true;
  state.totalTicks += 1;
  state.lastTickAt = new Date().toISOString();

  try {
    const result = await callControlTick();
    state.successTicks += 1;
    state.lastResult = result;
    state.lastError = null;
    state.lastErrorAt = null;
  } catch (error) {
    state.failedTicks += 1;
    state.lastError = error.message;
    state.lastErrorAt = new Date().toISOString();
    console.error("[orchestrator] tick failed:", error.message);
  } finally {
    state.running = false;
  }
};

app.get("/health", (_req, res) => {
  res.json({ status: "ok", startedAt: state.startedAt });
});

app.get("/state", (_req, res) => {
  res.json(state);
});

app.post("/tick", async (_req, res) => {
  await tick();
  res.json(state);
});

setInterval(() => {
  tick().catch((error) => {
    console.error("[orchestrator] unexpected error:", error.message);
  });
}, TICK_MS);

tick().catch((error) => {
  console.error("[orchestrator] initial tick failed:", error.message);
});

app.listen(PORT, () => {
  console.log(`NexForce Orchestrator running on http://localhost:${PORT}`);
  console.log(`Control API target: ${CONTROL_API_URL}`);
});
