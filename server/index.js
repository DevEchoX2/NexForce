const express = require("express");
const path = require("path");
const crypto = require("crypto");
const Stripe = require("stripe");
const { promisify } = require("util");
const { ensureDb, readDb, writeDb } = require("./storage");
const {
  POSTGRES_ENABLED,
  initializePostgres,
  findUserByEmail,
  findUserById,
  createUser,
  updateUserUpdatedAt,
  pruneExpiredAuthSessions: pruneExpiredAuthSessionsPg,
  createAuthSession,
  findSessionByToken,
  revokeSessionByToken,
  storeLaunchTicket,
  getLaunchTicketById,
  consumeLaunchTicket,
  postgresHealth
} = require("./postgres");
const { createRateLimiter } = require("./rate-limit");
const { createMonitoring } = require("./monitoring");

const app = express();
const publicDir = path.join(__dirname, "..", "public");
const PORT = process.env.PORT || 5500;
const AUTH_SESSION_TTL_MS = Number(process.env.AUTH_SESSION_TTL_MS || 7 * 24 * 60 * 60 * 1000);
const SESSION_RECONNECT_GRACE_MS = Number(process.env.SESSION_RECONNECT_GRACE_MS || 5 * 60 * 1000);
const HOST_HEARTBEAT_TIMEOUT_MS = Number(process.env.HOST_HEARTBEAT_TIMEOUT_MS || 45000);
const MATCHMAKER_TICK_MS = Number(process.env.MATCHMAKER_TICK_MS || 5000);
const SCHEDULER_EVENT_LIMIT = Number(process.env.SCHEDULER_EVENT_LIMIT || 500);
const ORCHESTRATOR_KEY = process.env.NEXFORCE_ORCHESTRATOR_KEY || "nexforce-orchestrator-key";
const ORCHESTRATOR_EMBEDDED = (process.env.NEXFORCE_ORCHESTRATOR_EMBEDDED || "true").toLowerCase() !== "false";
const DEFAULT_RIG_CAPACITY = Number(process.env.NEXFORCE_DEFAULT_RIG_CAPACITY || 40);
const ADS_PER_RIG_SESSION = Number(process.env.NEXFORCE_ADS_PER_RIG_SESSION || 15);
const REQUIRE_STREAM_HEALTH = (process.env.NEXFORCE_REQUIRE_STREAM_HEALTH || "true").toLowerCase() !== "false";
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || "";
const STRIPE_DAY_PASS_PRICE_ID = process.env.STRIPE_DAY_PASS_PRICE_ID || "";
const DAY_PASS_PRICE_USD = Number(process.env.NEXFORCE_DAY_PASS_PRICE_USD || 7);
const PUBLIC_BASE_URL = process.env.NEXFORCE_PUBLIC_BASE_URL || "http://localhost:5500";
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

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
const INTEGRATION_TICKET_TTL_SEC = Number(process.env.INTEGRATION_TICKET_TTL_SEC || 300);
const TICKET_SIGNING_KEY = process.env.NEXFORCE_TICKET_SIGNING_KEY || "nexforce-ticket-signing-key";
const integrationProviders = {
  epic: {
    id: "epic",
    name: "Epic Games",
    games: ["fortnite"],
    launchUrlTemplate: "https://launcher.epicgames.com"
  },
  roblox: {
    id: "roblox",
    name: "Roblox",
    games: ["roblox"],
    launchUrlTemplate: "https://www.roblox.com/games"
  }
};

const gameProviderBySlug = {
  fortnite: "epic",
  roblox: "roblox"
};
const defaultSchedulerPolicy = {
  maxActiveSessionsPerUser: 1,
  maxQueuedSessionsPerUser: 1,
  agingBoostMinutes: 10,
  agingBoostPerStep: 1,
  eventRetentionLimit: SCHEDULER_EVENT_LIMIT
};

const createEmptySchedulerMetrics = () => ({
  since: new Date().toISOString(),
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
});

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

const orchestratorHealthState = {
  lastTickAt: null,
  lastResult: null
};

const SCHEDULER_GRACE_MS = Number(process.env.NEXFORCE_SCHEDULER_GRACE_MS || 15000);
const scryptAsync = promisify(crypto.scrypt);
const monitoring = createMonitoring();

const apiRateLimiter = createRateLimiter({
  label: "api",
  windowMs: Number(process.env.RATE_LIMIT_API_WINDOW_MS || 60_000),
  max: Number(process.env.RATE_LIMIT_API_MAX || 240)
});

const authRateLimiter = createRateLimiter({
  label: "auth",
  windowMs: Number(process.env.RATE_LIMIT_AUTH_WINDOW_MS || 60_000),
  max: Number(process.env.RATE_LIMIT_AUTH_MAX || 20)
});

const sessionRateLimiter = createRateLimiter({
  label: "session",
  windowMs: Number(process.env.RATE_LIMIT_SESSION_WINDOW_MS || 60_000),
  max: Number(process.env.RATE_LIMIT_SESSION_MAX || 40)
});

const allowedUserPlans = new Set(["free", "performance", "ultimate"]);

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

const sanitizeUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  tier: user.tier,
  createdAt: user.createdAt || null,
  updatedAt: user.updatedAt || null
});

const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const createPasswordHash = async (password) => {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = await scryptAsync(password, salt, 64);
  return {
    passwordSalt: salt,
    passwordHash: derivedKey.toString("hex")
  };
};

const verifyPassword = async (password, user) => {
  if (!user || !user.passwordSalt || !user.passwordHash) {
    return false;
  }

  const derivedKey = await scryptAsync(password, user.passwordSalt, 64);
  const userHash = Buffer.from(user.passwordHash, "hex");

  if (userHash.length !== derivedKey.length) {
    return false;
  }

  return crypto.timingSafeEqual(userHash, derivedKey);
};

const isSessionExpired = (session) => {
  const expiresAtMs = session?.expiresAt ? new Date(session.expiresAt).getTime() : Number.NaN;
  if (Number.isFinite(expiresAtMs)) {
    return expiresAtMs <= Date.now();
  }

  const createdAtMs = session?.createdAt ? new Date(session.createdAt).getTime() : Number.NaN;
  if (Number.isFinite(createdAtMs)) {
    return createdAtMs + AUTH_SESSION_TTL_MS <= Date.now();
  }

  return true;
};

const pruneExpiredAuthSessions = (db) => {
  const before = db.authSessions.length;
  db.authSessions = db.authSessions.filter((entry) => !isSessionExpired(entry));
  return db.authSessions.length !== before;
};

const issueAuthSession = (db, userId) => {
  const token = crypto.randomBytes(24).toString("hex");
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + AUTH_SESSION_TTL_MS).toISOString();

  db.authSessions = db.authSessions.filter((entry) => entry.userId !== userId && !isSessionExpired(entry));
  db.authSessions.push({ token, userId, createdAt, expiresAt });

  return token;
};

const asNonNegativeInt = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.floor(parsed);
};

const normalizeHostCapacity = (value, fallback = DEFAULT_RIG_CAPACITY) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return Math.max(1, Math.floor(fallback || DEFAULT_RIG_CAPACITY || 10));
  }
  return Math.floor(parsed);
};

const normalizeHostStreamHealth = (value = {}) => {
  const streamProfile = value?.streamProfile && typeof value.streamProfile === "object" ? value.streamProfile : {};

  const streamFps = Number(streamProfile.fps);
  const streamBitrateMbps = Number(streamProfile.bitrateMbps);

  return {
    streamSoftware:
      typeof value.streamSoftware === "string" && value.streamSoftware.trim() ? value.streamSoftware.trim().toLowerCase() : "sunshine",
    streamProtocol:
      typeof value.streamProtocol === "string" && value.streamProtocol.trim() ? value.streamProtocol.trim().toLowerCase() : "moonlight",
    remoteNetwork:
      typeof value.remoteNetwork === "string" && value.remoteNetwork.trim() ? value.remoteNetwork.trim().toLowerCase() : "tailscale",
    backupControl:
      typeof value.backupControl === "string" && value.backupControl.trim() ? value.backupControl.trim().toLowerCase() : "parsec",
    audioReady: value.audioReady !== false,
    networkOk: value.networkOk !== false,
    networkType:
      typeof value.networkType === "string" && value.networkType.trim() ? value.networkType.trim().toLowerCase() : "ethernet",
    uplinkMbps: Number.isFinite(Number(value.uplinkMbps)) ? Math.max(0, Math.floor(Number(value.uplinkMbps))) : 100,
    downlinkMbps: Number.isFinite(Number(value.downlinkMbps)) ? Math.max(0, Math.floor(Number(value.downlinkMbps))) : 100,
    jitterMs: Number.isFinite(Number(value.jitterMs)) ? Math.max(0, Math.floor(Number(value.jitterMs))) : 8,
    packetLossPct: Number.isFinite(Number(value.packetLossPct)) ? Math.max(0, Number(value.packetLossPct)) : 0,
    streamProfile: {
      resolution:
        typeof streamProfile.resolution === "string" && streamProfile.resolution.trim() ? streamProfile.resolution.trim() : "1080p",
      fps: Number.isFinite(streamFps) && streamFps > 0 ? Math.floor(streamFps) : 60,
      bitrateMbps: Number.isFinite(streamBitrateMbps) && streamBitrateMbps > 0 ? Math.floor(streamBitrateMbps) : 20,
      codec:
        typeof streamProfile.codec === "string" && streamProfile.codec.trim() ? streamProfile.codec.trim().toLowerCase() : "hevc"
    },
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString()
  };
};

const normalizeHostSlotPolicy = (slotPolicy = {}) => {
  return {
    freeReservedMin: asNonNegativeInt(slotPolicy.freeReservedMin, 0),
    performanceReservedMin: asNonNegativeInt(slotPolicy.performanceReservedMin, 0),
    ultimateReservedMin: asNonNegativeInt(slotPolicy.ultimateReservedMin, 0)
  };
};

const getSchedulerPolicy = (db) => {
  const merged = {
    ...defaultSchedulerPolicy,
    ...(db.schedulerPolicy || {})
  };

  return {
    maxActiveSessionsPerUser: Math.max(1, asNonNegativeInt(merged.maxActiveSessionsPerUser, 1)),
    maxQueuedSessionsPerUser: Math.max(1, asNonNegativeInt(merged.maxQueuedSessionsPerUser, 1)),
    agingBoostMinutes: Math.max(1, asNonNegativeInt(merged.agingBoostMinutes, 10)),
    agingBoostPerStep: Math.max(1, asNonNegativeInt(merged.agingBoostPerStep, 1)),
    eventRetentionLimit: Math.max(50, asNonNegativeInt(merged.eventRetentionLimit, SCHEDULER_EVENT_LIMIT))
  };
};

const getSchedulerMetrics = (db) => {
  if (!db.schedulerMetrics) {
    db.schedulerMetrics = createEmptySchedulerMetrics();
  }

  if (!db.schedulerMetrics.since) {
    db.schedulerMetrics.since = new Date().toISOString();
  }

  return db.schedulerMetrics;
};

const appendSchedulerEvent = (db, type, details = {}) => {
  const policy = getSchedulerPolicy(db);
  if (!Array.isArray(db.schedulerEvents)) {
    db.schedulerEvents = [];
  }

  db.schedulerEvents.push({
    id: `evt_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
    at: new Date().toISOString(),
    type,
    details
  });

  if (db.schedulerEvents.length > policy.eventRetentionLimit) {
    db.schedulerEvents.splice(0, db.schedulerEvents.length - policy.eventRetentionLimit);
  }
};

const recordSchedulerRejection = (db, reason, details = {}) => {
  const metrics = getSchedulerMetrics(db);
  metrics.rejections[reason] = (metrics.rejections[reason] || 0) + 1;
  appendSchedulerEvent(db, "rejection", { reason, ...details });
};

const recordQueueJoin = (db, session) => {
  const metrics = getSchedulerMetrics(db);
  metrics.queuedTotal += 1;
  metrics.lastQueueAt = new Date().toISOString();
  appendSchedulerEvent(db, "queue_join", {
    sessionId: session.id,
    userId: session.userId,
    plan: session.plan,
    gameSlug: session.gameSlug
  });
};

const recordAssignment = (db, session, host) => {
  const metrics = getSchedulerMetrics(db);
  metrics.assignmentsTotal += 1;
  metrics.lastAssignmentAt = new Date().toISOString();

  const planBucket = metrics.waitByPlanSec[session.plan] || { count: 0, total: 0, max: 0 };
  const requestedMs = new Date(session.requestedAt).getTime();
  const startedMs = new Date(session.startedAt).getTime();
  if (Number.isFinite(requestedMs) && Number.isFinite(startedMs) && startedMs >= requestedMs) {
    const waitSec = Math.floor((startedMs - requestedMs) / 1000);
    planBucket.count += 1;
    planBucket.total += waitSec;
    planBucket.max = Math.max(planBucket.max, waitSec);
    metrics.waitByPlanSec[session.plan] = planBucket;
  }

  appendSchedulerEvent(db, "assignment", {
    sessionId: session.id,
    userId: session.userId,
    hostId: host.id,
    plan: session.plan,
    assignedBy: session.assignedBy
  });
};

const recordTimeout = (db, session) => {
  const metrics = getSchedulerMetrics(db);
  metrics.timedOutTotal += 1;
  metrics.lastTimeoutAt = new Date().toISOString();
  appendSchedulerEvent(db, "session_timeout", {
    sessionId: session.id,
    userId: session.userId,
    plan: session.plan,
    hostId: session.hostId
  });
};

const normalizeProviderId = (value) => {
  const providerId = String(value || "").trim().toLowerCase();
  return integrationProviders[providerId] ? providerId : null;
};

const getLinkedAccounts = (db, userId) => {
  if (!db.linkedAccountsByUserId || typeof db.linkedAccountsByUserId !== "object") {
    db.linkedAccountsByUserId = {};
  }

  if (!db.linkedAccountsByUserId[userId] || typeof db.linkedAccountsByUserId[userId] !== "object") {
    db.linkedAccountsByUserId[userId] = {};
  }

  return db.linkedAccountsByUserId[userId];
};

const buildLaunchTicket = (payload) => {
  const nonce = crypto.randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + INTEGRATION_TICKET_TTL_SEC * 1000).toISOString();
  const ticket = {
    id: `lt_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
    issuedAt: new Date().toISOString(),
    expiresAt,
    nonce,
    ...payload
  };

  const signaturePayload = JSON.stringify({
    id: ticket.id,
    issuedAt: ticket.issuedAt,
    expiresAt: ticket.expiresAt,
    userId: ticket.userId,
    sessionId: ticket.sessionId,
    gameSlug: ticket.gameSlug,
    provider: ticket.provider,
    providerAccountId: ticket.providerAccountId,
    launchUrl: ticket.launchUrl,
    nonce: ticket.nonce
  });

  ticket.signature = crypto
    .createHmac("sha256", TICKET_SIGNING_KEY)
    .update(signaturePayload)
    .digest("hex");

  return ticket;
};

const verifyLaunchTicketSignature = (ticket) => {
  const signaturePayload = JSON.stringify({
    id: ticket.id,
    issuedAt: ticket.issuedAt,
    expiresAt: ticket.expiresAt,
    userId: ticket.userId,
    sessionId: ticket.sessionId,
    gameSlug: ticket.gameSlug,
    provider: ticket.provider,
    providerAccountId: ticket.providerAccountId,
    launchUrl: ticket.launchUrl,
    nonce: ticket.nonce
  });

  const expected = crypto
    .createHmac("sha256", TICKET_SIGNING_KEY)
    .update(signaturePayload)
    .digest("hex");

  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(String(ticket.signature || ""), "hex");
  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
};

app.use(express.json());
app.use(monitoring.middleware);
app.use("/api", apiRateLimiter);

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

const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (POSTGRES_ENABLED) {
    try {
      await pruneExpiredAuthSessionsPg();
      const session = await findSessionByToken(token);
      if (!session) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const user = await findUserById(session.userId);
      if (!user) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      req.auth = { token, user: sanitizeUser(user) };
      return next();
    } catch {
      return res.status(503).json({ error: "Auth backend unavailable" });
    }
  }

  const db = readDb();
  const hadExpiredSessions = pruneExpiredAuthSessions(db);
  const session = db.authSessions.find((entry) => entry.token === token);

  if (hadExpiredSessions) {
    writeDb(db);
  }

  if (!session) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const user = db.users.find((entry) => entry.id === session.userId);
  if (!user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  req.auth = { token, user: sanitizeUser(user) };
  next();
};

const hostAuthMiddleware = (req, res, next) => {
  const key = req.headers["x-host-key"];
  if (!key || key !== HOST_KEY) {
    return res.status(401).json({ error: "Invalid host key" });
  }
  next();
};

const orchestratorAuthMiddleware = (req, res, next) => {
  const key = req.headers["x-orchestrator-key"];
  if (!key || key !== ORCHESTRATOR_KEY) {
    return res.status(401).json({ error: "Invalid orchestrator key" });
  }
  next();
};

const requireSchedulerAvailable = (req, res, next) => {
  if (ORCHESTRATOR_EMBEDDED) {
    return next();
  }

  const lastTickAtMs = orchestratorHealthState.lastTickAt
    ? new Date(orchestratorHealthState.lastTickAt).getTime()
    : 0;
  const isFresh = Number.isFinite(lastTickAtMs) && Date.now() - lastTickAtMs <= SCHEDULER_GRACE_MS;

  if (!isFresh) {
    return res.status(503).json({
      error: "Scheduler unavailable",
      code: "scheduler_unavailable",
      orchestrator: {
        embedded: ORCHESTRATOR_EMBEDDED,
        lastTickAt: orchestratorHealthState.lastTickAt,
        graceMs: SCHEDULER_GRACE_MS
      }
    });
  }

  next();
};

const planRank = {
  free: 0,
  performance: 1,
  ultimate: 2
};

const hostMode = {
  active: "active",
  draining: "draining",
  maintenance: "maintenance"
};

const gpuTierRank = {
  basic: 0,
  performance: 1,
  ultimate: 2
};

const planHostRequirements = {
  free: { gpuTier: "basic", minFps: 60 },
  performance: { gpuTier: "performance", minFps: 120 },
  ultimate: { gpuTier: "ultimate", minFps: 120 }
};

const planSessionDurationMs = {
  free: 30 * 60 * 1000,
  performance: 6 * 60 * 60 * 1000,
  ultimate: 8 * 60 * 60 * 1000
};

const canAccessGame = (userPlan, gameMinPlan) => {
  return (planRank[userPlan] ?? 0) >= (planRank[gameMinPlan] ?? 0);
};

const getPlanRank = (plan) => planRank[plan] ?? 0;

const getGpuTierRank = (tier) => gpuTierRank[tier] ?? 0;

const normalizeHostCapabilities = (capabilities = {}) => {
  const supportedGames = Array.isArray(capabilities.supportedGames)
    ? capabilities.supportedGames.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim())
    : [];

  const gpuTier = typeof capabilities.gpuTier === "string" ? capabilities.gpuTier : "basic";
  const maxFps = Number(capabilities.maxFps);

  return {
    supportedGames,
    gpuTier: gpuTierRank[gpuTier] !== undefined ? gpuTier : "basic",
    maxFps: Number.isFinite(maxFps) && maxFps > 0 ? Math.floor(maxFps) : 60
  };
};

const normalizeHostMode = (mode) => {
  return mode === hostMode.draining || mode === hostMode.maintenance ? mode : hostMode.active;
};

const getPlanHostRequirement = (plan) => {
  return planHostRequirements[plan] || planHostRequirements.free;
};

const isHostCompatible = (host, session) => {
  if (host.status !== "online") {
    return false;
  }

  if (normalizeHostMode(host.mode) !== hostMode.active) {
    return false;
  }

  const normalizedCapacity = normalizeHostCapacity(host.capacity);

  if (host.activeSessions >= normalizedCapacity) {
    return false;
  }

  const streamHealth = normalizeHostStreamHealth(host.streamHealth);
  if (REQUIRE_STREAM_HEALTH && (!streamHealth.audioReady || !streamHealth.networkOk)) {
    return false;
  }

  const capabilities = normalizeHostCapabilities(host.capabilities);
  const required = getPlanHostRequirement(session.plan);

  if (getGpuTierRank(capabilities.gpuTier) < getGpuTierRank(required.gpuTier)) {
    return false;
  }

  if (capabilities.maxFps < required.minFps) {
    return false;
  }

  if (capabilities.supportedGames.length > 0 && !capabilities.supportedGames.includes(session.gameSlug)) {
    return false;
  }

  return true;
};

const getHostPlanActiveCounts = (db, hostId) => {
  const counts = { free: 0, performance: 0, ultimate: 0 };

  db.sessions.forEach((session) => {
    if (session.status !== "active" || session.hostId !== hostId) {
      return;
    }

    if (counts[session.plan] !== undefined) {
      counts[session.plan] += 1;
    }
  });

  return counts;
};

const canHostAcceptPlan = (db, host, plan) => {
  const policy = normalizeHostSlotPolicy(host.slotPolicy);
  const activeCounts = getHostPlanActiveCounts(db, host.id);
  const capacity = normalizeHostCapacity(host.capacity);
  const availableSlots = Math.max(0, capacity - host.activeSessions);

  let reservedForHigherTiers = 0;
  let activeHigherTiers = 0;

  if (plan === "free") {
    reservedForHigherTiers = policy.performanceReservedMin + policy.ultimateReservedMin;
    activeHigherTiers = activeCounts.performance + activeCounts.ultimate;
  } else if (plan === "performance") {
    reservedForHigherTiers = policy.ultimateReservedMin;
    activeHigherTiers = activeCounts.ultimate;
  }

  const remainingReservedNeed = Math.max(0, reservedForHigherTiers - activeHigherTiers);
  return availableSlots > remainingReservedNeed;
};

const isHostCompatibleForSession = (db, host, session) => {
  if (!isHostCompatible(host, session)) {
    return false;
  }

  return canHostAcceptPlan(db, host, session.plan);
};

const getAssignmentReason = (host, session) => {
  const capacity = normalizeHostCapacity(host.capacity);
  const loadRatio = capacity > 0 ? (host.activeSessions / capacity).toFixed(2) : "1.00";
  const regionLabel = session.preferredRegion ? `${host.region === session.preferredRegion ? "region_match" : "region_fallback"}` : "no_region_pref";
  return `${regionLabel}+load_${loadRatio}+capability`;
};

const getPlanSessionDurationMs = (plan) => {
  return planSessionDurationMs[plan] ?? planSessionDurationMs.free;
};

const normalizeLatencyMap = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const normalized = {};
  Object.entries(value).forEach(([region, latency]) => {
    const parsed = Number(latency);
    if (!region || !Number.isFinite(parsed) || parsed <= 0) {
      return;
    }
    normalized[String(region).trim()] = Math.floor(parsed);
  });

  return Object.keys(normalized).length > 0 ? normalized : null;
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
  const isActive = session.status === "active" || session.status === "disconnected";
  const remainingMs = isActive ? getSessionTimeRemainingMs(session, nowMs) : null;
  const reconnectRemainingMs = session.reconnectExpiresAt
    ? Math.max(0, new Date(session.reconnectExpiresAt).getTime() - nowMs)
    : null;

  return {
    ...session,
    maxDurationSec: Math.floor(maxDurationMs / 1000),
    remainingSec: remainingMs === null ? null : Math.floor(remainingMs / 1000),
    reconnectRemainingSec: reconnectRemainingMs === null ? null : Math.floor(reconnectRemainingMs / 1000)
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
  const streamHealth = normalizeHostStreamHealth(session.streamHealth || {});
  session.connection = {
    mode: "placeholder",
    playUrl: `/play.html?game=${encodeURIComponent(session.gameTitle)}`,
    rigId: session.hostId || null,
    adPolicy: {
      adsPlanned: Math.max(0, Math.floor(ADS_PER_RIG_SESSION)),
      adUnit: "video"
    },
    stream: {
      software: streamHealth.streamSoftware,
      protocol: streamHealth.streamProtocol,
      remoteNetwork: streamHealth.remoteNetwork,
      backupControl: streamHealth.backupControl,
      audioReady: streamHealth.audioReady,
      networkOk: streamHealth.networkOk,
      networkType: streamHealth.networkType,
      profile: streamHealth.streamProfile
    }
  };
};

const buildRigSummary = (host) => {
  const maxUsers = normalizeHostCapacity(host.capacity);
  const activeUsers = asNonNegativeInt(host.activeSessions, 0);
  const availableUsers = Math.max(0, maxUsers - activeUsers);
  const saturationPct = maxUsers > 0 ? Math.round((activeUsers / maxUsers) * 100) : 100;

  return {
    rigId: host.id,
    name: host.name,
    region: host.region,
    status: host.status,
    mode: normalizeHostMode(host.mode),
    activeUsers,
    maxUsers,
    availableUsers,
    saturationPct,
    acceptingUsers: host.status === "online" && normalizeHostMode(host.mode) === hostMode.active && availableUsers > 0,
    streamHealth: normalizeHostStreamHealth(host.streamHealth)
  };
};

const getLaunchServiceSnapshot = (db) => {
  const rigs = db.gameHosts.map(buildRigSummary);
  const totals = rigs.reduce(
    (accumulator, rig) => {
      accumulator.activeUsers += rig.activeUsers;
      accumulator.maxUsers += rig.maxUsers;
      accumulator.availableUsers += rig.availableUsers;
      if (rig.availableUsers === 0) {
        accumulator.saturatedRigs += 1;
      }
      return accumulator;
    },
    {
      rigsTotal: rigs.length,
      activeUsers: 0,
      maxUsers: 0,
      availableUsers: 0,
      saturatedRigs: 0
    }
  );

  return {
    ...totals,
    queueDepth: db.sessionQueue.length,
    adPolicy: {
      adsPerSession: Math.max(0, Math.floor(ADS_PER_RIG_SESSION)),
      adUnit: "video"
    },
    rigs
  };
};

const reconcileHostsAndSessions = (db) => {
  const now = new Date().toISOString();
  const hostById = new Map(db.gameHosts.map((host) => [host.id, host]));
  let changed = false;

  db.gameHosts.forEach((host) => {
    const normalizedCapacity = normalizeHostCapacity(host.capacity);
    if (host.capacity !== normalizedCapacity) {
      host.capacity = normalizedCapacity;
      changed = true;
    }

    const normalizedMode = normalizeHostMode(host.mode);
    if (host.mode !== normalizedMode) {
      host.mode = normalizedMode;
      changed = true;
    }

    const normalizedCapabilities = normalizeHostCapabilities(host.capabilities);
    if (JSON.stringify(host.capabilities || {}) !== JSON.stringify(normalizedCapabilities)) {
      host.capabilities = normalizedCapabilities;
      changed = true;
    }

    const normalizedSlotPolicy = normalizeHostSlotPolicy(host.slotPolicy);
    if (JSON.stringify(host.slotPolicy || {}) !== JSON.stringify(normalizedSlotPolicy)) {
      host.slotPolicy = normalizedSlotPolicy;
      changed = true;
    }

    const normalizedStreamHealth = normalizeHostStreamHealth(host.streamHealth);
    if (JSON.stringify(host.streamHealth || {}) !== JSON.stringify(normalizedStreamHealth)) {
      host.streamHealth = normalizedStreamHealth;
      changed = true;
    }

    const previousStatus = host.status;
    if (!isHostFresh(host)) {
      host.status = "offline";
    }

    if (host.mode === hostMode.maintenance && host.status !== "offline") {
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
    if (session.status !== "active" && session.status !== "disconnected") {
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
    if (session.status !== "active" && session.status !== "disconnected") {
      return;
    }

    const remainingMs = getSessionTimeRemainingMs(session, nowMs);
    if (remainingMs > 0) {
      return;
    }

    session.status = "ended";
    session.endedAt = nowIso;
    session.endReason = "session_timeout";
    recordTimeout(db, session);
    session.hostId = null;
    changed = true;
    timedOutCount += 1;
  });

  db.sessions.forEach((session) => {
    if (session.status !== "disconnected") {
      return;
    }

    const reconnectExpiresAtMs = session.reconnectExpiresAt ? new Date(session.reconnectExpiresAt).getTime() : Number.NaN;
    if (!Number.isFinite(reconnectExpiresAtMs) || reconnectExpiresAtMs > nowMs) {
      return;
    }

    session.status = "ended";
    session.endedAt = nowIso;
    session.endReason = "reconnect_timeout";
    session.hostId = null;
    session.reconnectToken = null;
    session.reconnectExpiresAt = null;
    session.disconnectedAt = null;
    appendSchedulerEvent(db, "session_reconnect_timeout", {
      sessionId: session.id,
      userId: session.userId
    });
    changed = true;
  });

  return { changed, timedOutCount };
};

const getAvailableHostForSession = (db, session) => {
  return db.gameHosts
    .filter((host) => isHostCompatibleForSession(db, host, session))
    .sort((left, right) => {
      const leftLatency = Number(session.clientLatencyMsByRegion?.[left.region]);
      const rightLatency = Number(session.clientLatencyMsByRegion?.[right.region]);
      const leftHasLatency = Number.isFinite(leftLatency);
      const rightHasLatency = Number.isFinite(rightLatency);
      if (leftHasLatency || rightHasLatency) {
        if (leftHasLatency && !rightHasLatency) {
          return -1;
        }
        if (!leftHasLatency && rightHasLatency) {
          return 1;
        }
        if (leftLatency !== rightLatency) {
          return leftLatency - rightLatency;
        }
      }

      const leftRegionScore = session.preferredRegion && left.region === session.preferredRegion ? 0 : 1;
      const rightRegionScore = session.preferredRegion && right.region === session.preferredRegion ? 0 : 1;
      if (leftRegionScore !== rightRegionScore) {
        return leftRegionScore - rightRegionScore;
      }

      const leftLoad = left.activeSessions / normalizeHostCapacity(left.capacity);
      const rightLoad = right.activeSessions / normalizeHostCapacity(right.capacity);
      if (leftLoad !== rightLoad) {
        return leftLoad - rightLoad;
      }
      const leftHeartbeat = new Date(left.lastHeartbeatAt || 0).getTime();
      const rightHeartbeat = new Date(right.lastHeartbeatAt || 0).getTime();
      return rightHeartbeat - leftHeartbeat;
    })[0];
};

const sortQueue = (db) => {
  const schedulerPolicy = getSchedulerPolicy(db);
  const nowMs = Date.now();

  const score = (entry) => {
    const base = getPlanRank(entry.plan) * 1000;
    const requestedAtMs = new Date(entry.requestedAt).getTime();
    if (!Number.isFinite(requestedAtMs)) {
      return base;
    }

    const waitedMinutes = Math.max(0, (nowMs - requestedAtMs) / (1000 * 60));
    const agingSteps = Math.floor(waitedMinutes / schedulerPolicy.agingBoostMinutes);
    return base + agingSteps * schedulerPolicy.agingBoostPerStep;
  };

  db.sessionQueue.sort((left, right) => {
    const scoreDelta = score(right) - score(left);
    if (scoreDelta !== 0) {
      return scoreDelta;
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
    let assignedInPass = false;

    for (let index = 0; index < db.sessionQueue.length; index += 1) {
      const queueItem = db.sessionQueue[index];
      const session = db.sessions.find((entry) => entry.id === queueItem.sessionId);

      if (!session || session.status !== "queued") {
        db.sessionQueue.splice(index, 1);
        index -= 1;
        changed = true;
        continue;
      }

      const host = getAvailableHostForSession(db, session);
      if (!host) {
        continue;
      }

      db.sessionQueue.splice(index, 1);
      session.status = "active";
      session.hostId = host.id;
      session.startedAt = new Date().toISOString();
      session.assignedBy = getAssignmentReason(host, session);
      session.streamHealth = normalizeHostStreamHealth(host.streamHealth);
      assignConnection(session);
      host.activeSessions += 1;
      recordAssignment(db, session, host);
      changed = true;
      promotedCount += 1;
      assignedInPass = true;
      break;
    }

    if (!assignedInPass) {
      break;
    }
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
      onlineHosts: db.gameHosts.filter((entry) => entry.status === "online").length,
      assignmentsTotal: getSchedulerMetrics(db).assignmentsTotal
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

app.get("/api/health", async (_req, res) => {
  const postgres = await postgresHealth();
  res.json({
    status: postgres.status === "error" ? "degraded" : "ok",
    postgres,
    monitoring: {
      uptimeSec: monitoring.snapshot().uptimeSec
    }
  });
});

app.get("/api/games", (_req, res) => {
  const db = readDb();
  res.json(db.games);
});

app.get("/api/plans", (_req, res) => {
  const db = readDb();
  res.json(db.plans);
});

app.get("/api/payments/config", (_req, res) => {
  res.json({
    stripeEnabled: Boolean(stripe),
    publishableKey: STRIPE_PUBLISHABLE_KEY || null,
    dayPassPriceUsd: Number.isFinite(DAY_PASS_PRICE_USD) && DAY_PASS_PRICE_USD > 0 ? DAY_PASS_PRICE_USD : 7,
    setupUrl: "https://dashboard.stripe.com/register"
  });
});

app.post("/api/payments/day-pass/checkout", authMiddleware, sessionRateLimiter, async (req, res) => {
  if (!stripe) {
    return res.status(503).json({
      error: "Stripe is not configured",
      setupUrl: "https://dashboard.stripe.com/register"
    });
  }

  const body = req.body || {};
  const requestedSuccessUrl = typeof body.successUrl === "string" ? body.successUrl.trim() : "";
  const requestedCancelUrl = typeof body.cancelUrl === "string" ? body.cancelUrl.trim() : "";

  const fallbackSuccessUrl = `${PUBLIC_BASE_URL}/plans.html?checkout=success`;
  const fallbackCancelUrl = `${PUBLIC_BASE_URL}/plans.html?checkout=cancel`;

  const successUrl = requestedSuccessUrl.startsWith("http") ? requestedSuccessUrl : fallbackSuccessUrl;
  const cancelUrl = requestedCancelUrl.startsWith("http") ? requestedCancelUrl : fallbackCancelUrl;
  const amountUsd = Number.isFinite(DAY_PASS_PRICE_USD) && DAY_PASS_PRICE_USD > 0 ? DAY_PASS_PRICE_USD : 7;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: STRIPE_DAY_PASS_PRICE_ID
        ? [
            {
              price: STRIPE_DAY_PASS_PRICE_ID,
              quantity: 1
            }
          ]
        : [
            {
              quantity: 1,
              price_data: {
                currency: "usd",
                unit_amount: Math.round(amountUsd * 100),
                product_data: {
                  name: "NexForce Day Pass",
                  description: "Skip queue for one launch window"
                }
              }
            }
          ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        userId: req.auth.user.id,
        paymentType: "day_pass"
      }
    });

    return res.json({
      checkoutId: session.id,
      url: session.url
    });
  } catch (error) {
    return res.status(502).json({
      error: "Failed to create Stripe checkout session",
      details: error?.message || "unknown_error"
    });
  }
});

app.get("/api/hosts", authMiddleware, requireSchedulerAvailable, (_req, res) => {
  const db = readDb();
  promoteQueue(db);
  writeDb(db);
  res.json(db.gameHosts);
});

app.get("/api/launch/service/rigs", authMiddleware, requireSchedulerAvailable, (_req, res) => {
  const db = readDb();
  promoteQueue(db);
  writeDb(db);
  res.json(getLaunchServiceSnapshot(db));
});

app.put("/api/launch/service/rigs/:rigId/capacity", hostAuthMiddleware, (req, res) => {
  const { rigId } = req.params;
  const { maxUsers } = req.body || {};

  const db = readDb();
  const host = db.gameHosts.find((entry) => entry.id === rigId);
  if (!host) {
    return res.status(404).json({ error: "Rig not found" });
  }

  host.capacity = normalizeHostCapacity(maxUsers, host.capacity || DEFAULT_RIG_CAPACITY);
  appendSchedulerEvent(db, "rig_capacity_updated", {
    rigId: host.id,
    maxUsers: host.capacity
  });

  promoteQueue(db);
  writeDb(db);
  res.json(buildRigSummary(host));
});

app.put("/api/hosts/:hostId/stream-health", hostAuthMiddleware, (req, res) => {
  const { hostId } = req.params;
  const db = readDb();
  const host = db.gameHosts.find((entry) => entry.id === hostId);

  if (!host) {
    return res.status(404).json({ error: "Host not found" });
  }

  host.streamHealth = normalizeHostStreamHealth({
    ...(host.streamHealth || {}),
    ...(req.body || {}),
    updatedAt: new Date().toISOString()
  });

  appendSchedulerEvent(db, "host_stream_health_updated", {
    hostId: host.id,
    audioReady: host.streamHealth.audioReady,
    networkOk: host.streamHealth.networkOk,
    networkType: host.streamHealth.networkType
  });

  promoteQueue(db);
  writeDb(db);
  res.json({ success: true, host: buildRigSummary(host) });
});

app.post("/api/hosts/register", hostAuthMiddleware, (req, res) => {
  const { hostId, name, region = "local", capacity = DEFAULT_RIG_CAPACITY, capabilities, mode, slotPolicy, streamHealth } = req.body || {};
  if (!hostId || !name) {
    return res.status(400).json({ error: "hostId and name are required" });
  }

  const db = readDb();
  const existing = db.gameHosts.find((entry) => entry.id === hostId);

  if (existing) {
    existing.name = name;
    existing.region = region;
    existing.capacity = normalizeHostCapacity(capacity, existing.capacity || DEFAULT_RIG_CAPACITY);
    existing.capabilities = normalizeHostCapabilities(capabilities || existing.capabilities);
    existing.mode = normalizeHostMode(mode || existing.mode);
    existing.slotPolicy = normalizeHostSlotPolicy(slotPolicy || existing.slotPolicy);
    existing.streamHealth = normalizeHostStreamHealth(streamHealth || existing.streamHealth);
    existing.status = "online";
    if (existing.mode === hostMode.maintenance) {
      existing.status = "offline";
    }
    existing.lastHeartbeatAt = new Date().toISOString();
    appendSchedulerEvent(db, "host_register", {
      hostId: existing.id,
      region: existing.region,
      mode: existing.mode
    });
    promoteQueue(db);
    writeDb(db);
    return res.json(existing);
  }

  const host = {
    id: hostId,
    name,
    region,
    capacity: normalizeHostCapacity(capacity, DEFAULT_RIG_CAPACITY),
    activeSessions: 0,
    status: "online",
    mode: normalizeHostMode(mode),
    capabilities: normalizeHostCapabilities(capabilities),
    slotPolicy: normalizeHostSlotPolicy(slotPolicy),
    streamHealth: normalizeHostStreamHealth(streamHealth),
    lastHeartbeatAt: new Date().toISOString()
  };

  if (host.mode === hostMode.maintenance) {
    host.status = "offline";
  }

  db.gameHosts.push(host);
  appendSchedulerEvent(db, "host_register", {
    hostId: host.id,
    region: host.region,
    mode: host.mode
  });
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

  if (normalizeHostMode(host.mode) !== hostMode.maintenance) {
    host.status = "online";
  }

  if (req.body && typeof req.body === "object" && req.body.streamHealth) {
    host.streamHealth = normalizeHostStreamHealth({
      ...(host.streamHealth || {}),
      ...req.body.streamHealth,
      updatedAt: new Date().toISOString()
    });
  }

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

app.put("/api/hosts/:hostId/capabilities", hostAuthMiddleware, (req, res) => {
  const { hostId } = req.params;
  const db = readDb();
  const host = db.gameHosts.find((entry) => entry.id === hostId);

  if (!host) {
    return res.status(404).json({ error: "Host not found" });
  }

  host.capabilities = normalizeHostCapabilities(req.body || host.capabilities);
  appendSchedulerEvent(db, "host_capabilities_updated", {
    hostId: host.id,
    capabilities: host.capabilities
  });
  promoteQueue(db);
  writeDb(db);
  res.json({ success: true, host });
});

app.put("/api/hosts/:hostId/policy", hostAuthMiddleware, (req, res) => {
  const { hostId } = req.params;
  const db = readDb();
  const host = db.gameHosts.find((entry) => entry.id === hostId);

  if (!host) {
    return res.status(404).json({ error: "Host not found" });
  }

  host.slotPolicy = normalizeHostSlotPolicy(req.body || host.slotPolicy);
  appendSchedulerEvent(db, "host_policy_updated", {
    hostId: host.id,
    slotPolicy: host.slotPolicy
  });
  promoteQueue(db);
  writeDb(db);
  res.json({ success: true, host });
});

app.put("/api/hosts/:hostId/mode", hostAuthMiddleware, (req, res) => {
  const { hostId } = req.params;
  const { mode } = req.body || {};
  const normalizedMode = normalizeHostMode(mode);
  const db = readDb();
  const host = db.gameHosts.find((entry) => entry.id === hostId);

  if (!host) {
    return res.status(404).json({ error: "Host not found" });
  }

  host.mode = normalizedMode;

  if (normalizedMode === hostMode.maintenance) {
    host.status = "offline";
  } else if (normalizedMode === hostMode.active) {
    host.status = "online";
    host.lastHeartbeatAt = new Date().toISOString();
  }

  appendSchedulerEvent(db, "host_mode_updated", {
    hostId: host.id,
    mode: host.mode,
    status: host.status
  });

  promoteQueue(db);
  writeDb(db);
  res.json({ success: true, host });
});

app.get("/api/control/summary", authMiddleware, requireSchedulerAvailable, (req, res) => {
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

app.post("/api/auth/register", authRateLimiter, async (req, res) => {
  const { name, email, password, tier } = req.body || {};
  const normalizedName = String(name || "").trim();
  const normalizedEmail = normalizeEmail(email);
  const normalizedPassword = String(password || "");

  if (!normalizedName || normalizedName.length < 2) {
    return res.status(400).json({ error: "Name must be at least 2 characters" });
  }

  if (!isValidEmail(normalizedEmail)) {
    return res.status(400).json({ error: "A valid email is required" });
  }

  if (normalizedPassword.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  try {
    if (POSTGRES_ENABLED) {
      await initializePostgres();
      const existingUser = await findUserByEmail(normalizedEmail);
      if (existingUser) {
        return res.status(409).json({ error: "Email already registered" });
      }

      const credentials = await createPasswordHash(normalizedPassword);
      const selectedTier = allowedUserPlans.has(String(tier || "").toLowerCase())
        ? String(tier).toLowerCase()
        : "free";
      const timestamp = new Date().toISOString();
      const user = {
        id: `user_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
        name: normalizedName,
        email: normalizedEmail,
        tier: selectedTier,
        ...credentials,
        createdAt: timestamp,
        updatedAt: timestamp
      };

      await createUser(user);
      const token = crypto.randomBytes(24).toString("hex");
      const createdAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + AUTH_SESSION_TTL_MS).toISOString();
      await createAuthSession({ token, userId: user.id, createdAt, expiresAt });

      return res.status(201).json({ token, user: sanitizeUser(user) });
    }

    const db = readDb();
    const existingUser = db.users.find((entry) => normalizeEmail(entry.email) === normalizedEmail);
    if (existingUser) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const credentials = await createPasswordHash(normalizedPassword);
    const selectedTier = allowedUserPlans.has(String(tier || "").toLowerCase())
      ? String(tier).toLowerCase()
      : "free";
    const timestamp = new Date().toISOString();
    const user = {
      id: `user_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
      name: normalizedName,
      email: normalizedEmail,
      tier: selectedTier,
      ...credentials,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    db.users.push(user);
    db.settingsByUserId[user.id] = {
      preferredDevice: "PC",
      networkProfile: "Balanced",
      selectedPlan: selectedTier
    };

    const token = issueAuthSession(db, user.id);
    writeDb(db);

    res.status(201).json({ token, user: sanitizeUser(user) });
  } catch {
    res.status(500).json({ error: "Failed to register user" });
  }
});

app.post("/api/auth/login", authRateLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  const normalizedEmail = normalizeEmail(email);
  const normalizedPassword = String(password || "");

  if (!isValidEmail(normalizedEmail) || !normalizedPassword) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  if (POSTGRES_ENABLED) {
    try {
      await initializePostgres();
      await pruneExpiredAuthSessionsPg();
      const user = await findUserByEmail(normalizedEmail);
      const passwordValid = await verifyPassword(normalizedPassword, user);
      if (!passwordValid) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      const token = crypto.randomBytes(24).toString("hex");
      const createdAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + AUTH_SESSION_TTL_MS).toISOString();
      await createAuthSession({ token, userId: user.id, createdAt, expiresAt });
      await updateUserUpdatedAt(user.id, createdAt);
      const refreshedUser = { ...user, updatedAt: createdAt };
      return res.json({ token, user: sanitizeUser(refreshedUser) });
    } catch {
      return res.status(503).json({ error: "Auth backend unavailable" });
    }
  }

  const db = readDb();
  pruneExpiredAuthSessions(db);
  const user = db.users.find((entry) => normalizeEmail(entry.email) === normalizedEmail);

  const passwordValid = await verifyPassword(normalizedPassword, user);
  if (!passwordValid) {
    writeDb(db);
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const token = issueAuthSession(db, user.id);
  user.updatedAt = new Date().toISOString();
  writeDb(db);

  res.json({ token, user: sanitizeUser(user) });
});

app.post("/api/auth/logout", authMiddleware, async (req, res) => {
  if (POSTGRES_ENABLED) {
    try {
      await revokeSessionByToken(req.auth.token);
      return res.json({ success: true });
    } catch {
      return res.status(503).json({ error: "Auth backend unavailable" });
    }
  }

  const db = readDb();
  db.authSessions = db.authSessions.filter((entry) => entry.token !== req.auth.token);
  writeDb(db);
  res.json({ success: true });
});

app.get("/api/auth/me", authMiddleware, (req, res) => {
  res.json({ user: req.auth.user });
});

app.get("/api/integrations/providers", authMiddleware, (_req, res) => {
  res.json(Object.values(integrationProviders));
});

app.get("/api/integrations/accounts", authMiddleware, (req, res) => {
  const db = readDb();
  const linkedAccounts = getLinkedAccounts(db, req.auth.user.id);
  res.json(linkedAccounts);
});

app.post("/api/integrations/:provider/link", authMiddleware, (req, res) => {
  const providerId = normalizeProviderId(req.params.provider);
  if (!providerId) {
    return res.status(400).json({ error: "Unsupported provider" });
  }

  const { accountId, displayName = null } = req.body || {};
  if (!accountId || typeof accountId !== "string") {
    return res.status(400).json({ error: "accountId is required" });
  }

  const db = readDb();
  const linkedAccounts = getLinkedAccounts(db, req.auth.user.id);
  linkedAccounts[providerId] = {
    provider: providerId,
    accountId: accountId.trim(),
    displayName: typeof displayName === "string" && displayName.trim() ? displayName.trim() : null,
    linkedAt: new Date().toISOString()
  };

  appendSchedulerEvent(db, "integration_linked", {
    userId: req.auth.user.id,
    provider: providerId
  });
  writeDb(db);
  res.json(linkedAccounts[providerId]);
});

app.delete("/api/integrations/:provider/unlink", authMiddleware, (req, res) => {
  const providerId = normalizeProviderId(req.params.provider);
  if (!providerId) {
    return res.status(400).json({ error: "Unsupported provider" });
  }

  const db = readDb();
  const linkedAccounts = getLinkedAccounts(db, req.auth.user.id);
  delete linkedAccounts[providerId];

  appendSchedulerEvent(db, "integration_unlinked", {
    userId: req.auth.user.id,
    provider: providerId
  });
  writeDb(db);
  res.json({ success: true });
});

app.post("/api/launch/ticket", authMiddleware, sessionRateLimiter, async (req, res) => {
  const { gameSlug, sessionId = null } = req.body || {};
  if (!gameSlug) {
    return res.status(400).json({ error: "gameSlug is required" });
  }

  const db = readDb();
  const game = db.games.find((entry) => entry.slug === gameSlug);
  if (!game) {
    return res.status(404).json({ error: "Game not found" });
  }

  const providerId = gameProviderBySlug[game.slug] || null;
  const linkedAccounts = getLinkedAccounts(db, req.auth.user.id);
  const providerAccount = providerId ? linkedAccounts[providerId] : null;

  if (providerId && !providerAccount) {
    appendSchedulerEvent(db, "launch_ticket_rejected", {
      userId: req.auth.user.id,
      gameSlug: game.slug,
      reason: "provider_not_linked",
      provider: providerId
    });
    writeDb(db);
    return res.status(403).json({
      error: "Provider account not linked",
      provider: providerId
    });
  }

  const activeSession = db.sessions.find(
    (entry) =>
      entry.userId === req.auth.user.id &&
      entry.status === "active" &&
      entry.gameSlug === game.slug &&
      (!sessionId || entry.id === sessionId)
  );

  if (!activeSession) {
    return res.status(404).json({ error: "No active session for game" });
  }

  const externalLaunchUrl = providerId
    ? `${integrationProviders[providerId].launchUrlTemplate}?ticket=${encodeURIComponent(activeSession.id)}`
    : `/play.html?game=${encodeURIComponent(game.title)}`;

  const ticket = buildLaunchTicket({
    userId: req.auth.user.id,
    sessionId: activeSession.id,
    gameSlug: game.slug,
    provider: providerId,
    providerAccountId: providerAccount?.accountId || null,
    launchUrl: externalLaunchUrl
  });

  if (POSTGRES_ENABLED) {
    try {
      await initializePostgres();
      await storeLaunchTicket(ticket);
    } catch {
      return res.status(503).json({ error: "Ticket backend unavailable" });
    }
  } else {
    if (!Array.isArray(db.launchTickets)) {
      db.launchTickets = [];
    }
    db.launchTickets.push(ticket);
    db.launchTickets = db.launchTickets.slice(-500);
  }

  appendSchedulerEvent(db, "launch_ticket_issued", {
    userId: req.auth.user.id,
    sessionId: activeSession.id,
    gameSlug: game.slug,
    provider: providerId
  });
  writeDb(db);

  res.json(ticket);
});

app.post("/api/launch/ticket/verify", authMiddleware, sessionRateLimiter, async (req, res) => {
  const { ticketId, signature, consume = false } = req.body || {};
  if (!ticketId || !signature) {
    return res.status(400).json({ error: "ticketId and signature are required" });
  }

  let ticket;
  if (POSTGRES_ENABLED) {
    try {
      ticket = await getLaunchTicketById(ticketId);
    } catch {
      return res.status(503).json({ error: "Ticket backend unavailable" });
    }
  } else {
    const db = readDb();
    ticket = Array.isArray(db.launchTickets) ? db.launchTickets.find((entry) => entry.id === ticketId) : null;
  }

  if (!ticket) {
    return res.status(404).json({ error: "Ticket not found" });
  }

  if (ticket.userId !== req.auth.user.id) {
    return res.status(403).json({ error: "Ticket does not belong to user" });
  }

  if (ticket.signature !== signature || !verifyLaunchTicketSignature(ticket)) {
    return res.status(400).json({ error: "Invalid ticket signature" });
  }

  const expiresAtMs = new Date(ticket.expiresAt).getTime();
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    return res.status(410).json({ error: "Ticket expired" });
  }

  if (consume && POSTGRES_ENABLED) {
    try {
      await consumeLaunchTicket(ticket.id);
    } catch {
      return res.status(503).json({ error: "Ticket backend unavailable" });
    }
  }

  res.json({ valid: true, ticketId: ticket.id, expiresAt: ticket.expiresAt, launchUrl: ticket.launchUrl });
});

app.get("/api/control/monitoring", authMiddleware, (_req, res) => {
  res.json(monitoring.snapshot());
});

app.get("/api/metrics", (_req, res) => {
  res.type("text/plain").send(monitoring.prometheus());
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

app.post("/api/sessions/request", authMiddleware, requireSchedulerAvailable, sessionRateLimiter, (req, res) => {
  const { gameSlug, preferredRegion = null, clientLatencyMsByRegion = null } = req.body || {};
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
    recordSchedulerRejection(db, "plan_restricted", {
      userId: req.auth.user.id,
      gameSlug,
      selectedPlan: settings.selectedPlan,
      requiredPlan: game.minPlan
    });
    writeDb(db);
    return res.status(403).json({
      error: "Plan upgrade required",
      requiredPlan: game.minPlan,
      selectedPlan: settings.selectedPlan
    });
  }

  const schedulerPolicy = getSchedulerPolicy(db);
  const userActiveSessions = db.sessions.filter((entry) => entry.userId === req.auth.user.id && entry.status === "active");
  const userQueuedSessions = db.sessions.filter((entry) => entry.userId === req.auth.user.id && entry.status === "queued");

  if (userActiveSessions.length >= schedulerPolicy.maxActiveSessionsPerUser) {
    recordSchedulerRejection(db, "concurrency_limit", {
      userId: req.auth.user.id,
      reason: "active_limit",
      limit: schedulerPolicy.maxActiveSessionsPerUser
    });
    writeDb(db);
    return res.status(409).json({
      error: "Active session limit reached",
      limit: schedulerPolicy.maxActiveSessionsPerUser,
      activeSessions: userActiveSessions
    });
  }

  if (userQueuedSessions.length >= schedulerPolicy.maxQueuedSessionsPerUser) {
    recordSchedulerRejection(db, "concurrency_limit", {
      userId: req.auth.user.id,
      reason: "queue_limit",
      limit: schedulerPolicy.maxQueuedSessionsPerUser
    });
    writeDb(db);
    return res.status(409).json({
      error: "Queued session limit reached",
      limit: schedulerPolicy.maxQueuedSessionsPerUser,
      queuedSessions: userQueuedSessions
    });
  }

  const queuedSessionShape = {
    plan: settings.selectedPlan,
    gameSlug: game.slug,
    preferredRegion: typeof preferredRegion === "string" && preferredRegion.trim() ? preferredRegion.trim() : null,
    clientLatencyMsByRegion: normalizeLatencyMap(clientLatencyMsByRegion)
  };
  const host = getAvailableHostForSession(db, queuedSessionShape);
  const id = `sess_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const session = {
    id,
    userId: req.auth.user.id,
    gameSlug: game.slug,
    gameTitle: game.title,
    plan: settings.selectedPlan,
    preferredRegion: queuedSessionShape.preferredRegion,
    clientLatencyMsByRegion: queuedSessionShape.clientLatencyMsByRegion,
    status: host ? "active" : "queued",
    hostId: host ? host.id : null,
    assignedBy: host ? getAssignmentReason(host, queuedSessionShape) : null,
    requestedAt: new Date().toISOString(),
    startedAt: host ? new Date().toISOString() : null,
    endedAt: null,
    disconnectedAt: null,
    reconnectExpiresAt: null,
    reconnectToken: null,
    connection: null
  };

  db.sessions.push(session);

  if (host) {
    session.streamHealth = normalizeHostStreamHealth(host.streamHealth);
    assignConnection(session);
    host.activeSessions += 1;
    recordAssignment(db, session, host);
  } else {
    db.sessionQueue.push({
      sessionId: session.id,
      userId: req.auth.user.id,
      requestedAt: session.requestedAt,
      plan: session.plan
    });
    recordQueueJoin(db, session);
    recordSchedulerRejection(db, "no_capacity", {
      userId: req.auth.user.id,
      sessionId: session.id,
      plan: session.plan,
      gameSlug: session.gameSlug
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

app.get("/api/sessions/me", authMiddleware, requireSchedulerAvailable, (req, res) => {
  const db = readDb();
  promoteQueue(db);
  writeDb(db);
  const sessions = db.sessions.filter(
    (entry) => entry.userId === req.auth.user.id && (entry.status === "queued" || entry.status === "active" || entry.status === "disconnected")
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

app.get("/api/stream/sessions/:sessionId/bootstrap", authMiddleware, requireSchedulerAvailable, (req, res) => {
  const { sessionId } = req.params;
  const db = readDb();
  const session = db.sessions.find((entry) => entry.id === sessionId && entry.userId === req.auth.user.id);

  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  if (session.status !== "active" && session.status !== "disconnected") {
    return res.status(409).json({ error: "Session is not stream-ready" });
  }

  const host = db.gameHosts.find((entry) => entry.id === session.hostId);
  if (!host) {
    return res.status(409).json({ error: "Assigned host unavailable" });
  }

  const streamHealth = normalizeHostStreamHealth(host.streamHealth);

  res.json({
    sessionId: session.id,
    gameSlug: session.gameSlug,
    gameTitle: session.gameTitle,
    status: session.status,
    host: {
      id: host.id,
      name: host.name,
      region: host.region
    },
    stream: {
      software: streamHealth.streamSoftware,
      protocol: streamHealth.streamProtocol,
      remoteNetwork: streamHealth.remoteNetwork,
      backupControl: streamHealth.backupControl,
      profile: streamHealth.streamProfile,
      audioReady: streamHealth.audioReady,
      networkOk: streamHealth.networkOk,
      networkType: streamHealth.networkType,
      uplinkMbps: streamHealth.uplinkMbps,
      downlinkMbps: streamHealth.downlinkMbps,
      jitterMs: streamHealth.jitterMs,
      packetLossPct: streamHealth.packetLossPct
    },
    adPolicy: {
      adsPlanned: Math.max(0, Math.floor(ADS_PER_RIG_SESSION)),
      adUnit: "video"
    },
    playUrl: `/play.html?game=${encodeURIComponent(session.gameTitle)}`
  });
});

app.post("/api/sessions/:sessionId/disconnect", authMiddleware, requireSchedulerAvailable, sessionRateLimiter, (req, res) => {
  const { sessionId } = req.params;
  const db = readDb();
  const session = db.sessions.find((entry) => entry.id === sessionId && entry.userId === req.auth.user.id);

  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  if (session.status === "ended" || session.status === "queued") {
    return res.status(409).json({ error: "Session is not active" });
  }

  if (session.status === "disconnected") {
    return res.json({ success: true, session: withSessionRuntime(session) });
  }

  session.status = "disconnected";
  session.disconnectedAt = new Date().toISOString();
  session.reconnectExpiresAt = new Date(Date.now() + SESSION_RECONNECT_GRACE_MS).toISOString();
  session.reconnectToken = crypto.randomBytes(20).toString("hex");

  appendSchedulerEvent(db, "session_disconnected", {
    sessionId: session.id,
    userId: session.userId,
    reconnectExpiresAt: session.reconnectExpiresAt
  });

  writeDb(db);
  res.json({
    success: true,
    session: withSessionRuntime(session),
    reconnectToken: session.reconnectToken,
    reconnectExpiresAt: session.reconnectExpiresAt
  });
});

app.post("/api/sessions/:sessionId/reconnect", authMiddleware, requireSchedulerAvailable, sessionRateLimiter, (req, res) => {
  const { sessionId } = req.params;
  const { reconnectToken } = req.body || {};
  const db = readDb();
  const session = db.sessions.find((entry) => entry.id === sessionId && entry.userId === req.auth.user.id);

  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  if (session.status === "active") {
    return res.json({ success: true, session: withSessionRuntime(session) });
  }

  if (session.status !== "disconnected") {
    return res.status(409).json({ error: "Session is not reconnectable" });
  }

  if (!reconnectToken || reconnectToken !== session.reconnectToken) {
    return res.status(401).json({ error: "Invalid reconnect token" });
  }

  const reconnectExpiresAtMs = session.reconnectExpiresAt ? new Date(session.reconnectExpiresAt).getTime() : Number.NaN;
  if (!Number.isFinite(reconnectExpiresAtMs) || reconnectExpiresAtMs <= Date.now()) {
    session.status = "ended";
    session.endedAt = new Date().toISOString();
    session.endReason = "reconnect_timeout";
    session.hostId = null;
    session.reconnectToken = null;
    session.reconnectExpiresAt = null;
    session.disconnectedAt = null;
    writeDb(db);
    return res.status(410).json({ error: "Reconnect window expired" });
  }

  const host = db.gameHosts.find((entry) => entry.id === session.hostId);
  if (!host || host.status !== "online") {
    session.status = "ended";
    session.endedAt = new Date().toISOString();
    session.endReason = "host_offline";
    session.hostId = null;
    session.reconnectToken = null;
    session.reconnectExpiresAt = null;
    session.disconnectedAt = null;
    writeDb(db);
    return res.status(409).json({ error: "Host unavailable" });
  }

  session.status = "active";
  session.disconnectedAt = null;
  session.reconnectExpiresAt = null;
  session.reconnectToken = null;

  appendSchedulerEvent(db, "session_reconnected", {
    sessionId: session.id,
    userId: session.userId,
    hostId: session.hostId
  });

  writeDb(db);
  res.json({ success: true, session: withSessionRuntime(session) });
});

app.post("/api/sessions/:sessionId/end", authMiddleware, requireSchedulerAvailable, (req, res) => {
  const { sessionId } = req.params;
  const db = readDb();
  const session = db.sessions.find((entry) => entry.id === sessionId && entry.userId === req.auth.user.id);

  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  if (session.status === "ended") {
    return res.json({ session });
  }

  if ((session.status === "active" || session.status === "disconnected") && session.hostId) {
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
  session.disconnectedAt = null;
  session.reconnectExpiresAt = null;
  session.reconnectToken = null;
  appendSchedulerEvent(db, "session_ended", {
    sessionId: session.id,
    userId: session.userId,
    endedBy: "user"
  });

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
  res.json({
    ...getWorkerSnapshot(),
    orchestrator: {
      embedded: ORCHESTRATOR_EMBEDDED,
      lastTickAt: orchestratorHealthState.lastTickAt,
      lastResult: orchestratorHealthState.lastResult,
      graceMs: SCHEDULER_GRACE_MS
    }
  });
});

app.post("/api/control/worker/tick", authMiddleware, (_req, res) => {
  const result = runMatchmakerTick({ forceWrite: true });
  res.json({ worker: getWorkerSnapshot(), result });
});

app.get("/internal/orchestrator/health", orchestratorAuthMiddleware, (_req, res) => {
  res.json({ status: "ok", embedded: ORCHESTRATOR_EMBEDDED });
});

app.post("/internal/orchestrator/tick", orchestratorAuthMiddleware, (req, res) => {
  const forceWrite = Boolean(req.body?.forceWrite);
  const result = runMatchmakerTick({ forceWrite });
  orchestratorHealthState.lastTickAt = new Date().toISOString();
  orchestratorHealthState.lastResult = result;
  res.json({ worker: getWorkerSnapshot(), result });
});

app.get("/api/control/scheduler", authMiddleware, (_req, res) => {
  const db = readDb();
  const policy = getSchedulerPolicy(db);
  const metrics = getSchedulerMetrics(db);

  res.json({
    policy,
    metrics,
    queueDepth: db.sessionQueue.length,
    activeSessions: db.sessions.filter((entry) => entry.status === "active").length,
    eventsStored: Array.isArray(db.schedulerEvents) ? db.schedulerEvents.length : 0
  });
});

app.get("/api/control/autoscale", authMiddleware, (_req, res) => {
  const db = readDb();
  const onlineActiveHosts = db.gameHosts.filter(
    (entry) => entry.status === "online" && normalizeHostMode(entry.mode) === hostMode.active
  );
  const queueDepth = db.sessionQueue.length;
  const activeOrDisconnected = db.sessions.filter(
    (entry) => entry.status === "active" || entry.status === "disconnected"
  ).length;
  const totalCapacity = onlineActiveHosts.reduce((sum, entry) => sum + Math.max(0, Number(entry.capacity) || 0), 0);
  const desiredSpareCapacity = Math.max(1, Math.ceil(totalCapacity * 0.15));
  const freeSlots = Math.max(0, totalCapacity - activeOrDisconnected);
  const shortfall = Math.max(0, queueDepth - freeSlots + desiredSpareCapacity);
  const defaultHostCapacity = Math.max(
    1,
    onlineActiveHosts.length > 0
      ? Math.round(totalCapacity / onlineActiveHosts.length)
      : 1
  );

  const recommendedAdditionalHosts = Math.ceil(shortfall / defaultHostCapacity);

  res.json({
    queueDepth,
    activeOrDisconnectedSessions: activeOrDisconnected,
    onlineActiveHosts: onlineActiveHosts.length,
    totalCapacity,
    freeSlots,
    desiredSpareCapacity,
    shortfall,
    recommendedAdditionalHosts,
    defaultHostCapacity,
    recommendation: recommendedAdditionalHosts > 0 ? "scale_up" : "stable"
  });
});

app.get("/api/control/scheduler/events", authMiddleware, (req, res) => {
  const db = readDb();
  const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 50));
  const events = Array.isArray(db.schedulerEvents) ? db.schedulerEvents : [];
  res.json(events.slice(-limit).reverse());
});

app.put("/api/control/scheduler/policy", authMiddleware, (req, res) => {
  const db = readDb();
  const current = getSchedulerPolicy(db);
  const payload = req.body || {};

  db.schedulerPolicy = {
    ...current,
    ...payload
  };

  db.schedulerPolicy = getSchedulerPolicy(db);
  appendSchedulerEvent(db, "scheduler_policy_updated", {
    updatedBy: req.auth.user.id,
    policy: db.schedulerPolicy
  });
  promoteQueue(db);
  writeDb(db);
  res.json(db.schedulerPolicy);
});

app.post("/api/control/scheduler/metrics/reset", authMiddleware, (req, res) => {
  const db = readDb();
  db.schedulerMetrics = createEmptySchedulerMetrics();
  appendSchedulerEvent(db, "scheduler_metrics_reset", {
    resetBy: req.auth.user.id
  });
  writeDb(db);
  res.json({ success: true, metrics: db.schedulerMetrics });
});

app.use(express.static(publicDir));

app.get("*", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

ensureDb();

if (POSTGRES_ENABLED) {
  initializePostgres()
    .then(() => {
      console.log("Postgres initialized");
    })
    .catch((error) => {
      console.error("Postgres initialization failed", error);
    });
}

if (ORCHESTRATOR_EMBEDDED) {
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
}

app.listen(PORT, () => {
  console.log(`NexForce running on http://localhost:${PORT}`);
});