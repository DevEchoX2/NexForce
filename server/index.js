const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { ensureDb, readDb, writeDb } = require("./storage");

const app = express();
const publicDir = path.join(__dirname, "..", "public");
const PORT = process.env.PORT || 5500;

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

const planRank = {
  free: 0,
  performance: 1,
  ultimate: 2
};

const canAccessGame = (userPlan, gameMinPlan) => {
  return (planRank[userPlan] ?? 0) >= (planRank[gameMinPlan] ?? 0);
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

const promoteQueue = (db) => {
  const host = db.gameHosts.find((entry) => entry.status === "online" && entry.activeSessions < entry.capacity);
  if (!host) {
    return;
  }

  const next = db.sessionQueue.shift();
  if (!next) {
    return;
  }

  const session = db.sessions.find((entry) => entry.id === next.sessionId);
  if (!session) {
    return;
  }

  session.status = "active";
  session.hostId = host.id;
  session.startedAt = new Date().toISOString();
  host.activeSessions += 1;
};

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

app.get("/api/control/summary", authMiddleware, (req, res) => {
  const db = readDb();
  const userSettings = getUserSettings(db, req.auth.user.id);
  const queuePosition = db.sessionQueue.findIndex((entry) => entry.userId === req.auth.user.id);

  res.json({
    user: req.auth.user,
    settings: userSettings,
    activeSessions: db.sessions.filter((entry) => entry.userId === req.auth.user.id && entry.status === "active"),
    queuedSessions: db.sessions.filter((entry) => entry.userId === req.auth.user.id && entry.status === "queued"),
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
    endedAt: null
  };

  db.sessions.push(session);

  if (host) {
    host.activeSessions += 1;
  } else {
    db.sessionQueue.push({ sessionId: session.id, userId: req.auth.user.id, requestedAt: session.requestedAt });
  }

  writeDb(db);

  const queuePosition =
    session.status === "queued"
      ? db.sessionQueue.findIndex((entry) => entry.sessionId === session.id) + 1
      : null;

  res.json({ session, queuePosition });
});

app.get("/api/sessions/me", authMiddleware, (req, res) => {
  const db = readDb();
  const sessions = db.sessions.filter(
    (entry) => entry.userId === req.auth.user.id && (entry.status === "queued" || entry.status === "active")
  );

  const hydrated = sessions.map((entry) => {
    const queuePosition =
      entry.status === "queued"
        ? db.sessionQueue.findIndex((queueEntry) => queueEntry.sessionId === entry.id) + 1
        : null;
    return { ...entry, queuePosition: queuePosition > 0 ? queuePosition : null };
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

app.use(express.static(publicDir));

app.get("*", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

ensureDb();

app.listen(PORT, () => {
  console.log(`NexForce running on http://localhost:${PORT}`);
});