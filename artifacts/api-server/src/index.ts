import { initSentry } from "./lib/sentry";

initSentry();

async function main() {
  const { default: app } = await import("./app");
  const { logger } = await import("./lib/logger");
  const { startExpiryWorker } = await import("./routes/rides");
  const { startTandemExpiryWorker } = await import("./routes/tandemMatching");
  const { seedAdminsFromEnv } = await import("./lib/adminAuth");
  const { startWeeklyPayoutScheduler } = await import(
    "./lib/weeklyPayoutScheduler"
  );

  const rawPort = process.env["PORT"];

  if (!rawPort) {
    throw new Error(
      "PORT environment variable is required but was not provided.",
    );
  }

  const port = Number(rawPort);

  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
    startExpiryWorker();
    startTandemExpiryWorker();
    void seedAdminsFromEnv();
    startWeeklyPayoutScheduler();
  });
}

void main();
