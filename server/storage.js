const fs = require("fs");
const path = require("path");

const dbPath = path.join(__dirname, "data", "db.json");

const defaultDb = {
  users: [
    {
      id: "demo-user-001",
      name: "NexForce Player",
      email: "player@nexforce.gg",
      tier: "performance"
    }
  ],
  sessions: [],
  settingsByUserId: {
    "demo-user-001": {
      preferredDevice: "PC",
      networkProfile: "Balanced",
      selectedPlan: "performance"
    }
  },
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
      image: null,
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
      image: null,
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

const readDb = () => {
  ensureDb();
  const raw = fs.readFileSync(dbPath, "utf8");
  return JSON.parse(raw);
};

const writeDb = (data) => {
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
};

module.exports = {
  ensureDb,
  readDb,
  writeDb
};