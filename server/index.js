const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { ensureDb, readDb, writeDb } = require("./storage");

const app = express();
const publicDir = path.join(__dirname, "..", "public");
const PORT = process.env.PORT || 5500;

const defaultAllowedOrigins = [
  "https://devechox2.github.io",
  "https://wafflev1.me",
  "http://wafflev1.me",
  "https://nexforce-production.up.railway.app"
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
  const session = db.sessions.find((entry) => entry.token === token);

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

app.post("/api/auth/demo-login", (_req, res) => {
  const db = readDb();
  const user = db.users[0];

  if (!user) {
    return res.status(500).json({ error: "No user configured" });
  }

  const token = crypto.randomBytes(24).toString("hex");
  db.sessions = db.sessions.filter((entry) => entry.userId !== user.id);
  db.sessions.push({ token, userId: user.id, createdAt: new Date().toISOString() });
  writeDb(db);

  res.json({ token, user });
});

app.post("/api/auth/logout", authMiddleware, (req, res) => {
  const db = readDb();
  db.sessions = db.sessions.filter((entry) => entry.token !== req.auth.token);
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