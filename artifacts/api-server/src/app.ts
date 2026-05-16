import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { isSentryEnabled, Sentry } from "./lib/sentry";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

if (isSentryEnabled()) {
  app.use((req: Request, _res: Response, next: NextFunction) => {
    // Tag the per-request isolation scope established by Sentry's Express
    // integration. Unlike withScope(next), this propagates through async
    // continuations within the request lifecycle.
    const scope = Sentry.getIsolationScope();
    const reqId = (req as { id?: string | number }).id;
    if (reqId !== undefined) scope.setTag("request_id", String(reqId));
    scope.setTag("route", req.path);
    scope.setTag("method", req.method);
    next();
  });
}

app.use("/api", router);

if (isSentryEnabled()) {
  Sentry.setupExpressErrorHandler(app);
}

app.use(
  (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
    const r = req as Request & { log?: { error: (...args: unknown[]) => void } };
    r.log?.error({ err }, "unhandled_error");
    if (res.headersSent) return;
    res.status(500).json({ error: "internal_server_error" });
  },
);

if (isSentryEnabled()) {
  process.on("unhandledRejection", (reason) => {
    Sentry.captureException(reason);
  });
  // For uncaught exceptions the Node process is in an undefined state — flush
  // the event then exit so the supervisor can restart cleanly. Sentry's flush
  // is async; we cap the wait at 2s so a wedged transport can't block exit.
  process.on("uncaughtException", (err) => {
    Sentry.captureException(err);
    void Sentry.flush(2000).finally(() => process.exit(1));
  });
}

export default app;
