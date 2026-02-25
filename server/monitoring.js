const createMonitoring = () => {
  const startedAt = new Date();
  const totals = {
    requests: 0,
    responses4xx: 0,
    responses5xx: 0,
    durationsMsTotal: 0
  };

  const byRoute = new Map();

  const middleware = (req, res, next) => {
    const start = process.hrtime.bigint();

    res.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
      const routeKey = `${req.method} ${req.route?.path || req.path}`;
      const routeStats = byRoute.get(routeKey) || {
        requests: 0,
        responses4xx: 0,
        responses5xx: 0,
        durationsMsTotal: 0,
        maxDurationMs: 0
      };

      totals.requests += 1;
      totals.durationsMsTotal += durationMs;
      routeStats.requests += 1;
      routeStats.durationsMsTotal += durationMs;
      routeStats.maxDurationMs = Math.max(routeStats.maxDurationMs, durationMs);

      if (res.statusCode >= 400 && res.statusCode < 500) {
        totals.responses4xx += 1;
        routeStats.responses4xx += 1;
      } else if (res.statusCode >= 500) {
        totals.responses5xx += 1;
        routeStats.responses5xx += 1;
      }

      byRoute.set(routeKey, routeStats);
    });

    next();
  };

  const snapshot = () => {
    const routes = Array.from(byRoute.entries())
      .map(([route, stats]) => ({
        route,
        ...stats,
        avgDurationMs: stats.requests > 0 ? Number((stats.durationsMsTotal / stats.requests).toFixed(2)) : 0
      }))
      .sort((left, right) => right.requests - left.requests)
      .slice(0, 50);

    return {
      startedAt: startedAt.toISOString(),
      uptimeSec: Math.floor((Date.now() - startedAt.getTime()) / 1000),
      totals: {
        ...totals,
        avgDurationMs: totals.requests > 0 ? Number((totals.durationsMsTotal / totals.requests).toFixed(2)) : 0,
        errorRate: totals.requests > 0 ? Number((((totals.responses4xx + totals.responses5xx) / totals.requests) * 100).toFixed(2)) : 0
      },
      routes
    };
  };

  const prometheus = () => {
    const s = snapshot();
    const lines = [
      "# HELP nexforce_requests_total Total HTTP requests",
      "# TYPE nexforce_requests_total counter",
      `nexforce_requests_total ${s.totals.requests}`,
      "# HELP nexforce_responses_4xx_total Total 4xx responses",
      "# TYPE nexforce_responses_4xx_total counter",
      `nexforce_responses_4xx_total ${s.totals.responses4xx}`,
      "# HELP nexforce_responses_5xx_total Total 5xx responses",
      "# TYPE nexforce_responses_5xx_total counter",
      `nexforce_responses_5xx_total ${s.totals.responses5xx}`,
      "# HELP nexforce_avg_duration_ms Average request duration in ms",
      "# TYPE nexforce_avg_duration_ms gauge",
      `nexforce_avg_duration_ms ${s.totals.avgDurationMs}`
    ];

    return `${lines.join("\n")}\n`;
  };

  return {
    middleware,
    snapshot,
    prometheus
  };
};

module.exports = {
  createMonitoring
};
