const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { ensureDb, readDb, writeDb } = require("./storage");

const app = express();
const publicDir = path.join(__dirname, "..", "public");
const PORT = process.env.PORT || 5500;
const HOST_HEARTBEAT_TIMEOUT_MS = Number(process.env.HOST_HEARTBEAT_TIMEOUT_MS || 45000);
const MATCHMAKER_TICK_MS = Number(process.env.MATCHMAKER_TICK_MS || 5000);

const defaultAllowedOrigins = [
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "https://devechox2.github.io",
  "https://wafflev1.me",
  "https://www.wafflev1.me",
  "http://wafflev1.me"
];

const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean)
  .concat(defaultAllowedOrigins);

const HOST_KEY = process.env.NEXFORCE_HOST_KEY || "nexforce-host-key";
const matchmakerState = {
  startedAt: new Date().toISOString(),
  isRunning: false,
  totalTicks: 0,
  changedTicks: 0,
  lastTickAt: null,
  lastDurationMs: 0,
  lastWriteAt: null,
  lastErrorAt: null,
  lastError: null
};

app.use(express.json());

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Vary", "Origin");
    res.header("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  next();
});

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const db = readDb();
  const session = db.authSessions.find((entry) => entry.token === token);

  if (!session) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const user = db.users.find((entry) => entry.id === session.userId);
  if (!user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  req.auth = { token, user };
  next();
};

const hostAuthMiddleware = (req, res, next) => {
  const key = req.headers["x-host-key"];
  if (!key || key !== HOST_KEY) {
    return res.status(401).json({ error: "Invalid host key" });
  }
  next();
};

const planRank = {
  free: 0,
  performance: 1,
  ultimate: 2
};

const planSessionDurationMs = {
  free: 60 * 60 * 1000,
  performance: 6 * 60 * 60 * 1000,
  ultimate: 8 * 60 * 60 * 1000
};

const canAccessGame = (userPlan, gameMinPlan) => {
  return (planRank[userPlan] ?? 0) >= (planRank[gameMinPlan] ?? 0);
};

const getPlanRank = (plan) => planRank[plan] ?? 0;

const getPlanSessionDurationMs = (plan) => {
  return planSessionDurationMs[plan] ?? planSessionDurationMs.free;
};

const getSessionTimeRemainingMs = (session, nowMs = Date.now()) => {
  if (!session.startedAt) {
    return getPlanSessionDurationMs(session.plan);
  }

  const startedAtMs = new Date(session.startedAt).getTime();
  if (!Number.isFinite(startedAtMs)) {
    return getPlanSessionDurationMs(session.plan);
  }

  const elapsedMs = Math.max(0, nowMs - startedAtMs);
  return Math.max(0, getPlanSessionDurationMs(session.plan) - elapsedMs);
};

const withSessionRuntime = (session, nowMs = Date.now()) => {
  const maxDurationMs = getPlanSessionDurationMs(session.plan);
  const isActive = session.status === "active";
  const remainingMs = isActive ? getSessionTimeRemainingMs(session, nowMs) : null;

  return {
    ...session,
    maxDurationSec: Math.floor(maxDurationMs / 1000),
    remainingSec: remainingMs === null ? null : Math.floor(remainingMs / 1000)
  };
};

const isHostFresh = (host) => {
  if (host.status !== "online") {
    return false;
  }

  if (!host.lastHeartbeatAt) {
    return true;
  }

  const age = Date.now() - new Date(host.lastHeartbeatAt).getTime();
  return age <= HOST_HEARTBEAT_TIMEOUT_MS;
};

const getUserSettings = (db, userId) => {
  return (
    db.settingsByUserId[userId] || {
      preferredDevice: "PC",
      networkProfile: "Balanced",
      selectedPlan: "free"
    }
  );
};

const assignConnection = (session) => {
  session.connection = {
    mode: "placeholder",
    playUrl: `/play.html?game=${encodeURIComponent(session.gameTitle)}`
  };
};

const reconcileHostsAndSessions = (db) => {
  const now = new Date().toISOString();
  const hostById = new Map(db.gameHosts.map((host) => [host.id, host]));
  let changed = false;

  db.gameHosts.forEach((host) => {
    const previousStatus = host.status;
    if (!isHostFresh(host)) {
      host.status = "offline";
    }

    if (host.status !== previousStatus) {
      changed = true;
    }

    const previousActiveSessions = host.activeSessions;
    host.activeSessions = 0;
    if (previousActiveSessions !== 0) {
      changed = true;
    }
  });

  db.sessions.forEach((session) => {
    if (session.status !== "active") {
      return;
    }

    const host = hostById.get(session.hostId);
    if (!host || host.status !== "online") {
      changed = true;
      session.status = "ended";
      session.endedAt = now;
      session.endReason = "host_offline";
      session.hostId = null;
      return;
    }

    host.activeSessions += 1;
  });

  return changed;
};

const enforceSessionDurationLimits = (db) => {
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();
  let changed = false;
  let timedOutCount = 0;

  db.sessions.forEach((session) => {
    if (session.status !== "active") {
      return;
    }

    const remainingMs = getSessionTimeRemainingMs(session, nowMs);
    if (remainingMs > 0) {
      return;
    }

    session.status = "ended";
    session.endedAt = nowIso;
    session.endReason = "session_timeout";
    session.hostId = null;
    changed = true;
    timedOutCount += 1;
  });

  return { changed, timedOutCount };
};

const getAvailableHost = (db) => {
  return db.gameHosts
    .filter((host) => host.status === "online" && host.activeSessions < host.capacity)
    .sort((left, right) => {
      const leftLoad = left.activeSessions / left.capacity;
      const rightLoad = right.activeSessions / right.capacity;
      if (leftLoad !== rightLoad) {
        return leftLoad - rightLoad;
      }
      const leftHeartbeat = new Date(left.lastHeartbeatAt || 0).getTime();
      const rightHeartbeat = new Date(right.lastHeartbeatAt || 0).getTime();
      return rightHeartbeat - leftHeartbeat;
    })[0];
};

const sortQueue = (db) => {
  db.sessionQueue.sort((left, right) => {
    const rankDelta = getPlanRank(right.plan) - getPlanRank(left.plan);
    if (rankDelta !== 0) {
      return rankDelta;
    }
    return new Date(left.requestedAt).getTime() - new Date(right.requestedAt).getTime();
  });
};

const promoteQueue = (db) => {
  const { changed: durationChanged, timedOutCount } = enforceSessionDurationLimits(db);
  const reconcileChanged = reconcileHostsAndSessions(db);
  let changed = durationChanged || reconcileChanged;
  let promotedCount = 0;
  sortQueue(db);

  while (db.sessionQueue.length > 0) {
    const host = getAvailableHost(db);
    if (!host) {
      break;
    }

    const next = db.sessionQueue.shift();
    if (!next) {
      break;
    }

    const session = db.sessions.find((entry) => entry.id === next.sessionId);
    if (!session || session.status !== "queued") {
      continue;
    }

    session.status = "active";
    session.hostId = host.id;
    session.startedAt = new Date().toISOString();
    assignConnection(session);
    host.activeSessions += 1;
    changed = true;
    promotedCount += 1;
  }

  return { changed, promotedCount, timedOutCount };
};

const runMatchmakerTick = ({ forceWrite = false } = {}) => {
  if (matchmakerState.isRunning) {
    return { skipped: true };
  }

  const startedAt = Date.now();
  matchmakerState.isRunning = true;
  matchmakerState.totalTicks += 1;

  const db = readDb();

  try {
    const { changed, promotedCount, timedOutCount } = promoteQueue(db);

    if (changed || forceWrite) {
      writeDb(db);
      matchmakerState.lastWriteAt = new Date().toISOString();
    }

    if (changed) {
      matchmakerState.changedTicks += 1;
    }

    matchmakerState.lastTickAt = new Date().toISOString();
    matchmakerState.lastDurationMs = Date.now() - startedAt;
    matchmakerState.lastErrorAt = null;
    matchmakerState.lastError = null;

    return {
      changed,
      promotedCount,
      timedOutCount,
      queueDepth: db.sessionQueue.length,
      activeSessions: db.sessions.filter((entry) => entry.status === "active").length,
      onlineHosts: db.gameHosts.filter((entry) => entry.status === "online").length
    };
  } catch (error) {
    matchmakerState.lastErrorAt = new Date().toISOString();
    matchmakerState.lastError = error.message;
    throw error;
  } finally {
    matchmakerState.isRunning = false;
  }
};

const getWorkerSnapshot = () => ({
  ...matchmakerState,
  tickIntervalMs: MATCHMAKER_TICK_MS
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/games", (_req, res) => {
  const db = readDb();
  res.json(db.games);
});

app.get("/api/plans", (_req, res) => {
  const db = readDb();
  res.json(db.plans);
});

app.get("/api/hosts", authMiddleware, (_req, res) => {
  const db = readDb();
  promoteQueue(db);
  writeDb(db);
  res.json(db.gameHosts);
});

app.post("/api/hosts/register", hostAuthMiddleware, (req, res) => {
  const { hostId, name, region = "local", capacity = 1 } = req.body || {};
  if (!hostId || !name) {
    return res.status(400).json({ error: "hostId and name are required" });
  }

  const db = readDb();
  const existing = db.gameHosts.find((entry) => entry.id === hostId);

  if (existing) {
    existing.name = name;
    existing.region = region;
    existing.capacity = Number(capacity) > 0 ? Number(capacity) : 1;
    existing.status = "online";
    existing.lastHeartbeatAt = new Date().toISOString();
    promoteQueue(db);
    writeDb(db);
    return res.json(existing);
  }

  const host = {
    id: hostId,
    name,
    region,
    capacity: Number(capacity) > 0 ? Number(capacity) : 1,
    activeSessions: 0,
    status: "online",
    lastHeartbeatAt: new Date().toISOString()
  };

  db.gameHosts.push(host);
  promoteQueue(db);
  writeDb(db);
  res.json(host);
});

app.post("/api/hosts/:hostId/heartbeat", hostAuthMiddleware, (req, res) => {
  const { hostId } = req.params;
  const db = readDb();
  const host = db.gameHosts.find((entry) => entry.id === hostId);

  if (!host) {
    return res.status(404).json({ error: "Host not found" });
  }

  host.status = "online";
  host.lastHeartbeatAt = new Date().toISOString();
  promoteQueue(db);
  writeDb(db);

  res.json({ success: true, host });
});

app.post("/api/hosts/:hostId/offline", hostAuthMiddleware, (req, res) => {
  const { hostId } = req.params;
  const db = readDb();
  const host = db.gameHosts.find((entry) => entry.id === hostId);

  if (!host) {
    return res.status(404).json({ error: "Host not found" });
  }

  host.status = "offline";
  promoteQueue(db);
  writeDb(db);
  res.json({ success: true, host });
});

app.get("/api/control/summary", authMiddleware, (req, res) => {
  const db = readDb();
  promoteQueue(db);
  writeDb(db);
  const userSettings = getUserSettings(db, req.auth.user.id);
  const queuePosition = db.sessionQueue.findIndex((entry) => entry.userId === req.auth.user.id);

  res.json({
    user: req.auth.user,
    settings: userSettings,
    activeSessions: db.sessions
      .filter((entry) => entry.userId === req.auth.user.id && entry.status === "active")
      .map((entry) => withSessionRuntime(entry)),
    queuedSessions: db.sessions
      .filter((entry) => entry.userId === req.auth.user.id && entry.status === "queued")
      .map((entry) => withSessionRuntime(entry)),
    queuePosition: queuePosition >= 0 ? queuePosition + 1 : null,
    hosts: db.gameHosts
  });
});

app.post("/api/auth/demo-login", (_req, res) => {
  const db = readDb();
  const user = db.users[0];

  if (!user) {
    return res.status(500).json({ error: "No user configured" });
  }

  const token = crypto.randomBytes(24).toString("hex");
  db.authSessions = db.authSessions.filter((entry) => entry.userId !== user.id);
  db.authSessions.push({ token, userId: user.id, createdAt: new Date().toISOString() });
  writeDb(db);

  res.json({ token, user });
});

app.post("/api/auth/logout", authMiddleware, (req, res) => {
  const db = readDb();
  db.authSessions = db.authSessions.filter((entry) => entry.token !== req.auth.token);
  writeDb(db);
  res.json({ success: true });
});

app.get("/api/auth/me", authMiddleware, (req, res) => {
  res.json({ user: req.auth.user });
});

app.get("/api/profile/settings", authMiddleware, (req, res) => {
  const db = readDb();
  const settings = db.settingsByUserId[req.auth.user.id] || {
    preferredDevice: "PC",
    networkProfile: "Balanced",
    selectedPlan: "free"
  };

  res.json(settings);
});

app.put("/api/profile/settings", authMiddleware, (req, res) => {
  const { preferredDevice, networkProfile } = req.body || {};
  const db = readDb();
  const current = db.settingsByUserId[req.auth.user.id] || {
    preferredDevice: "PC",
    networkProfile: "Balanced",
    selectedPlan: "free"
  };

  db.settingsByUserId[req.auth.user.id] = {
    ...current,
    preferredDevice: preferredDevice || current.preferredDevice,
    networkProfile: networkProfile || current.networkProfile
  };

  writeDb(db);
  res.json(db.settingsByUserId[req.auth.user.id]);
});

app.put("/api/profile/plan", authMiddleware, (req, res) => {
  const { selectedPlan } = req.body || {};
  const db = readDb();
  const valid = new Set(db.plans.map((entry) => entry.id));

  if (!valid.has(selectedPlan)) {
    return res.status(400).json({ error: "Invalid plan" });
  }

  const current = db.settingsByUserId[req.auth.user.id] || {
    preferredDevice: "PC",
    networkProfile: "Balanced",
    selectedPlan: "free"
  };

  db.settingsByUserId[req.auth.user.id] = {
    ...current,
    selectedPlan
  };
  writeDb(db);

  res.json(db.settingsByUserId[req.auth.user.id]);
});

app.post("/api/sessions/request", authMiddleware, (req, res) => {
  const { gameSlug } = req.body || {};
  if (!gameSlug) {
    return res.status(400).json({ error: "gameSlug is required" });
  }

  const db = readDb();
  const game = db.games.find((entry) => entry.slug === gameSlug);
  if (!game) {
    return res.status(404).json({ error: "Game not found" });
  }

  const settings = getUserSettings(db, req.auth.user.id);
  if (!canAccessGame(settings.selectedPlan, game.minPlan)) {
    return res.status(403).json({
      error: "Plan upgrade required",
      requiredPlan: game.minPlan,
      selectedPlan: settings.selectedPlan
    });
  }

  const existing = db.sessions.find(
    (entry) => entry.userId === req.auth.user.id && (entry.status === "queued" || entry.status === "active")
  );
  if (existing) {
    return res.status(409).json({ error: "User already has an active or queued session", session: existing });
  }

  const host = db.gameHosts.find((entry) => entry.status === "online" && entry.activeSessions < entry.capacity);
  const id = `sess_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const session = {
    id,
    userId: req.auth.user.id,
    gameSlug: game.slug,
    gameTitle: game.title,
    plan: settings.selectedPlan,
    status: host ? "active" : "queued",
    hostId: host ? host.id : null,
    requestedAt: new Date().toISOString(),
    startedAt: host ? new Date().toISOString() : null,
    endedAt: null,
    connection: null
  };

  db.sessions.push(session);

  if (host) {
    assignConnection(session);
    host.activeSessions += 1;
  } else {
    db.sessionQueue.push({
      sessionId: session.id,
      userId: req.auth.user.id,
      requestedAt: session.requestedAt,
      plan: session.plan
    });
  }

  promoteQueue(db);
  writeDb(db);

  const queuePosition =
    session.status === "queued"
      ? db.sessionQueue.findIndex((entry) => entry.sessionId === session.id) + 1
      : null;

  res.json({ session: withSessionRuntime(session), queuePosition });
});

app.get("/api/sessions/me", authMiddleware, (req, res) => {
  const db = readDb();
  promoteQueue(db);
  writeDb(db);
  const sessions = db.sessions.filter(
    (entry) => entry.userId === req.auth.user.id && (entry.status === "queued" || entry.status === "active")
  );

  const hydrated = sessions.map((entry) => {
    const queuePosition =
      entry.status === "queued"
        ? db.sessionQueue.findIndex((queueEntry) => queueEntry.sessionId === entry.id) + 1
        : null;
    const withRuntime = withSessionRuntime(entry);
    return { ...withRuntime, queuePosition: queuePosition > 0 ? queuePosition : null };
  });

  res.json(hydrated);
});

app.post("/api/sessions/:sessionId/end", authMiddleware, (req, res) => {
  const { sessionId } = req.params;
  const db = readDb();
  const session = db.sessions.find((entry) => entry.id === sessionId && entry.userId === req.auth.user.id);

  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  if (session.status === "ended") {
    return res.json({ session });
  }

  if (session.status === "active" && session.hostId) {
    const host = db.gameHosts.find((entry) => entry.id === session.hostId);
    if (host) {
      host.activeSessions = Math.max(0, host.activeSessions - 1);
    }
  }

  if (session.status === "queued") {
    db.sessionQueue = db.sessionQueue.filter((entry) => entry.sessionId !== session.id);
  }

  session.status = "ended";
  session.endedAt = new Date().toISOString();

  promoteQueue(db);
  writeDb(db);

  res.json({ session });
});

app.get("/api/launch/estimate", (req, res) => {
  const { plan = "free" } = req.query;
  const ranges = {
    free: { minQueue: 26, maxQueue: 42, minLatency: 22, maxLatency: 34, minFps: 80, maxFps: 98 },
    performance: { minQueue: 12, maxQueue: 24, minLatency: 16, maxLatency: 27, minFps: 100, maxFps: 120 },
    ultimate: { minQueue: 4, maxQueue: 14, minLatency: 10, maxLatency: 18, minFps: 110, maxFps: 144 }
  };

  const tier = ranges[plan] || ranges.free;
  const queue = Math.floor(Math.random() * (tier.maxQueue - tier.minQueue + 1)) + tier.minQueue;
  const latency = Math.floor(Math.random() * (tier.maxLatency - tier.minLatency + 1)) + tier.minLatency;
  const fps = Math.floor(Math.random() * (tier.maxFps - tier.minFps + 1)) + tier.minFps;

  res.json({ queue, eta: Math.ceil(queue / 3), latency, fps });
});

app.get("/api/control/worker", authMiddleware, (_req, res) => {
  res.json(getWorkerSnapshot());
});

app.post("/api/control/worker/tick", authMiddleware, (_req, res) => {
  const result = runMatchmakerTick({ forceWrite: true });
  res.json({ worker: getWorkerSnapshot(), result });
});

app.use(express.static(publicDir));

app.get("*", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

ensureDb();

const matchmakerTimer = setInterval(() => {
  try {
    runMatchmakerTick();
  } catch (error) {
    console.error("Matchmaker tick failed", error);
  }
}, MATCHMAKER_TICK_MS);

if (typeof matchmakerTimer.unref === "function") {
  matchmakerTimer.unref();
}

app.listen(PORT, () => {
  console.log(`NexForce running on http://localhost:${PORT}`);
});