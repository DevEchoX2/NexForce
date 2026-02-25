const fs = require("fs");
const path = require("path");

const dbPath = path.join(__dirname, "data", "db.json");
const DEFAULT_RIG_CAPACITY = Number(process.env.NEXFORCE_DEFAULT_RIG_CAPACITY || 40);

const normalizeHostCapacity = (value, fallback = DEFAULT_RIG_CAPACITY) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return Math.max(1, Math.floor(fallback || DEFAULT_RIG_CAPACITY || 10));
  }
  return Math.floor(parsed);
};

const defaultDb = {
  users: [
    {
      id: "demo-user-001",
      name: "NexForce Player",
      email: "player@nexforce.gg",
      tier: "performance",
      passwordSalt: null,
      passwordHash: null,
      createdAt: null,
      updatedAt: null
    }
  ],
  authSessions: [],
  linkedAccountsByUserId: {},
  launchTickets: [],
  settingsByUserId: {
    "demo-user-001": {
      preferredDevice: "PC",
      networkProfile: "Balanced",
      selectedPlan: "performance"
    }
  },
  gameHosts: [
    {
      id: "host-1",
      name: "NexForce Host 1",
      region: "local",
      capacity: DEFAULT_RIG_CAPACITY,
      activeSessions: 0,
      status: "online",
      mode: "active",
      slotPolicy: {
        freeReservedMin: 0,
        performanceReservedMin: 0,
        ultimateReservedMin: 0
      },
      capabilities: {
        supportedGames: [],
        gpuTier: "ultimate",
        maxFps: 144
      }
    }
  ],
  schedulerPolicy: {
    maxActiveSessionsPerUser: 1,
    maxQueuedSessionsPerUser: 1,
    agingBoostMinutes: 10,
    agingBoostPerStep: 1,
    eventRetentionLimit: 500
  },
  schedulerMetrics: {
    since: null,
    queuedTotal: 0,
    assignmentsTotal: 0,
    timedOutTotal: 0,
    rejections: {
      concurrency_limit: 0,
      plan_restricted: 0,
      no_capacity: 0
    },
    waitByPlanSec: {
      free: { count: 0, total: 0, max: 0 },
      performance: { count: 0, total: 0, max: 0 },
      ultimate: { count: 0, total: 0, max: 0 }
    },
    lastQueueAt: null,
    lastAssignmentAt: null,
    lastTimeoutAt: null
  },
  schedulerEvents: [],
  sessionQueue: [],
  sessions: [],
  plans: [
    {
      id: "free",
      name: "Free",
      description: "Queue-based sessions for casual play.",
      monthly: "$0",
      yearly: "$0",
      features: ["Up to 1-hour sessions", "Standard queue", "1080p up to 60 FPS"],
      recommended: false
    },
    {
      id: "performance",
      name: "Performance",
      description: "Lower latency and priority access.",
      monthly: "$9.99/mo",
      yearly: "$99/yr",
      features: ["Up to 6-hour sessions", "Priority queue", "1440p up to 120 FPS"],
      recommended: true
    },
    {
      id: "ultimate",
      name: "Ultimate",
      description: "Best cloud rigs and max quality stream.",
      monthly: "$19.99/mo",
      yearly: "$199/yr",
      features: ["Up to 8-hour sessions", "Fastest queue tier", "4K up to 120 FPS"],
      recommended: false
    }
  ],
  games: [
    {
      title: "Roblox",
      slug: "roblox",
      description: "User-generated worlds and social play.",
      genre: "Sandbox",
      platform: "Cross-Platform",
      status: "Available",
      minPlan: "free",
      image: "./assets/images/roblox.png",
      featured: true
    },
    {
      title: "Fortnite",
      slug: "fortnite",
      description: "Battle royale with smooth cloud controls.",
      genre: "Shooter",
      platform: "Cross-Platform",
      status: "Available",
      minPlan: "free",
      image: "./assets/images/fortnite.png",
      featured: true
    },
    {
      title: "Fall Guys",
      slug: "fall-guys",
      description: "Party chaos and obstacle races online.",
      genre: "Party",
      platform: "PC",
      status: "Available",
      minPlan: "performance",
      image: "./assets/images/fallguys.jpeg",
      featured: true
    },
    {
      title: "Rocket League",
      slug: "rocket-league",
      description: "Fast car-soccer matches with low latency.",
      genre: "Sports",
      platform: "PC",
      status: "Available",
      minPlan: "performance",
      image: "./assets/images/rocketleague.jpeg",
      featured: true
    }
  ]
};

const ensureDb = () => {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify(defaultDb, null, 2));
  }
};

const normalizeDb = (data) => {
  const normalized = { ...data };

  if (!Array.isArray(normalized.users)) {
    normalized.users = defaultDb.users;
  } else {
    normalized.users = normalized.users
      .filter((entry) => entry && typeof entry === "object")
      .map((entry, index) => ({
        id: typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : `user_${index + 1}`,
        name: typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : "NexForce User",
        email: typeof entry.email === "string" && entry.email.trim() ? entry.email.trim().toLowerCase() : `user${index + 1}@nexforce.gg`,
        tier: typeof entry.tier === "string" && entry.tier.trim() ? entry.tier.trim().toLowerCase() : "free",
        passwordSalt: typeof entry.passwordSalt === "string" && entry.passwordSalt.trim() ? entry.passwordSalt : null,
        passwordHash: typeof entry.passwordHash === "string" && entry.passwordHash.trim() ? entry.passwordHash : null,
        createdAt: typeof entry.createdAt === "string" ? entry.createdAt : null,
        updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : null
      }));

    if (normalized.users.length === 0) {
      normalized.users = defaultDb.users;
    }
  }

  if (!normalized.settingsByUserId || typeof normalized.settingsByUserId !== "object") {
    normalized.settingsByUserId = defaultDb.settingsByUserId;
  }

  if (!Array.isArray(normalized.plans)) {
    normalized.plans = defaultDb.plans;
  }

  if (!Array.isArray(normalized.games)) {
    normalized.games = defaultDb.games;
  }

  if (!Array.isArray(normalized.authSessions)) {
    const legacyAuthSessions = Array.isArray(normalized.sessions)
      ? normalized.sessions.filter((entry) => entry && typeof entry.token === "string")
      : [];
    normalized.authSessions = legacyAuthSessions;
  } else {
    normalized.authSessions = normalized.authSessions
      .filter((entry) => entry && typeof entry.token === "string" && typeof entry.userId === "string")
      .map((entry) => ({
        token: entry.token,
        userId: entry.userId,
        createdAt: typeof entry.createdAt === "string" ? entry.createdAt : new Date().toISOString(),
        expiresAt: typeof entry.expiresAt === "string" ? entry.expiresAt : null
      }));
  }

  if (!normalized.linkedAccountsByUserId || typeof normalized.linkedAccountsByUserId !== "object") {
    normalized.linkedAccountsByUserId = {};
  }

  if (!Array.isArray(normalized.launchTickets)) {
    normalized.launchTickets = [];
  }

  if (!Array.isArray(normalized.sessions)) {
    normalized.sessions = [];
  } else if (normalized.sessions.some((entry) => entry && typeof entry.token === "string")) {
    normalized.sessions = normalized.sessions.filter((entry) => entry && typeof entry.token !== "string");
  } else {
    normalized.sessions = normalized.sessions
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => ({
        ...entry,
        clientLatencyMsByRegion:
          entry.clientLatencyMsByRegion && typeof entry.clientLatencyMsByRegion === "object" && !Array.isArray(entry.clientLatencyMsByRegion)
            ? entry.clientLatencyMsByRegion
            : null,
        disconnectedAt: typeof entry.disconnectedAt === "string" ? entry.disconnectedAt : null,
        reconnectExpiresAt: typeof entry.reconnectExpiresAt === "string" ? entry.reconnectExpiresAt : null,
        reconnectToken: typeof entry.reconnectToken === "string" ? entry.reconnectToken : null
      }));
  }

  if (!Array.isArray(normalized.sessionQueue)) {
    normalized.sessionQueue = [];
  }

  if (!normalized.schedulerPolicy || typeof normalized.schedulerPolicy !== "object") {
    normalized.schedulerPolicy = defaultDb.schedulerPolicy;
  }

  if (!normalized.schedulerMetrics || typeof normalized.schedulerMetrics !== "object") {
    normalized.schedulerMetrics = defaultDb.schedulerMetrics;
  }

  if (!Array.isArray(normalized.schedulerEvents)) {
    normalized.schedulerEvents = [];
  }

  if (!Array.isArray(normalized.gameHosts) || normalized.gameHosts.length === 0) {
    normalized.gameHosts = defaultDb.gameHosts;
  } else {
    normalized.gameHosts = normalized.gameHosts.map((entry) => ({
      ...entry,
      capacity: normalizeHostCapacity(entry.capacity),
      mode: entry.mode || "active",
      slotPolicy: {
        freeReservedMin: Number.isFinite(Number(entry.slotPolicy?.freeReservedMin)) ? Math.max(0, Math.floor(Number(entry.slotPolicy.freeReservedMin))) : 0,
        performanceReservedMin: Number.isFinite(Number(entry.slotPolicy?.performanceReservedMin)) ? Math.max(0, Math.floor(Number(entry.slotPolicy.performanceReservedMin))) : 0,
        ultimateReservedMin: Number.isFinite(Number(entry.slotPolicy?.ultimateReservedMin)) ? Math.max(0, Math.floor(Number(entry.slotPolicy.ultimateReservedMin))) : 0
      },
      capabilities: {
        supportedGames: Array.isArray(entry.capabilities?.supportedGames) ? entry.capabilities.supportedGames : [],
        gpuTier: entry.capabilities?.gpuTier || "basic",
        maxFps: Number.isFinite(Number(entry.capabilities?.maxFps)) ? Math.floor(Number(entry.capabilities.maxFps)) : 60
      },
      lastHeartbeatAt: entry.lastHeartbeatAt || null
    }));
  }

  return normalized;
};

const readDb = () => {
  ensureDb();
  const raw = fs.readFileSync(dbPath, "utf8");
  const parsed = JSON.parse(raw);
  const normalized = normalizeDb(parsed);

  if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
    writeDb(normalized);
  }

  return normalized;
};

const writeDb = (data) => {
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
};

module.exports = {
  ensureDb,
  readDb,
  writeDb
};