const defaultKey = (req) => req.ip || req.headers["x-forwarded-for"] || "unknown";

const createRateLimiter = ({
  windowMs,
  max,
  keyFn = defaultKey,
  label = "rate_limit"
}) => {
  const buckets = new Map();

  return (req, res, next) => {
    const now = Date.now();
    const key = `${label}:${keyFn(req)}`;
    const bucket = buckets.get(key) || { count: 0, resetAt: now + windowMs };

    if (now > bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = now + windowMs;
    }

    bucket.count += 1;
    buckets.set(key, bucket);

    const remaining = Math.max(0, max - bucket.count);
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.floor(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      return res.status(429).json({
        error: "Too many requests",
        code: "rate_limited",
        retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
      });
    }

    next();
  };
};

module.exports = {
  createRateLimiter
};
