// ========================================
// PATCH FOR server-ultimate.ts
// ========================================
// Replace the bottom section (after error handler) with this:

// ---------- Production Safety Checks ----------
if (NODE_ENV === "production") {
  if (API_KEYS.length === 0) {
    logger.fatal({ at: "startup", error: "PRODUCTION without API_KEYS is unsafe" });
    process.exit(1);
  }
  if (ALLOWED_ORIGINS.length === 0) {
    logger.fatal({ at: "startup", error: "PRODUCTION without ALLOWED_ORIGINS is unsafe" });
    process.exit(1);
  }
  if (ALLOWED_FETCH_HOSTS.length === 0) {
    logger.fatal({ at: "startup", error: "PRODUCTION without ALLOWED_FETCH_HOSTS is unsafe" });
    process.exit(1);
  }
}

// ---------- Export app for tests ----------
export { app };

// ---------- Start server (only when not in tests) ----------
if (!process.env.JEST_WORKER_ID) {
  const server = app.listen(PORT, () => {
    logger.info({
      at: "startup",
      env: NODE_ENV,
      port: PORT,
      apiKeys: API_KEYS.length,
      allowedOrigins: ALLOWED_ORIGINS.length,
      allowedFetchHosts: ALLOWED_FETCH_HOSTS.length,
      maxConcurrent: MAX_INFLIGHT
    });
  });

  function shutdown(signal: string) {
    logger.info({ at: "shutdown", signal });
    
    server.close(() => {
      logger.info({ at: "shutdown_complete" });
      process.exit(0);
    });
    
    // Hard exit after 10 seconds
    setTimeout(() => {
      logger.warn({ at: "shutdown_timeout", msg: "Forcing exit" });
      process.exit(1);
    }, 10_000).unref();
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // Unhandled rejections
  process.on("unhandledRejection", (reason) => {
    logger.error({ at: "unhandled_rejection", reason });
  });

  process.on("uncaughtException", (error) => {
    logger.fatal({ at: "uncaught_exception", error: error.message });
    process.exit(1);
  });
}
