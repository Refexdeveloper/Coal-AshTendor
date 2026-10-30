import { existsSync } from "fs";
import path from "path";
import cookieParser from "cookie-parser";
import express, { type ErrorRequestHandler } from "express";
import multer from "multer";
import { db } from "./db";
import { repoRoot } from "./utils/root";
import { cors } from "./middleware/cors";
import { requireActor } from "./middleware/auth";
import { authRouter } from "./routes/auth";
import { refexOneLoginUrl, refexOneReady, safeNext, serviceProviderMetadata } from "./services/refexone";
import { actionRoutes } from "./routes/actions";
import { files } from "./routes/files";
import { views } from "./routes/views";

export function createApp() {
  const app = express();

  app.set("trust proxy", 1);
  app.use("/api", cors);
  app.use(cookieParser());
  app.use(express.json());
  app.use(express.urlencoded({ extended: false, limit: "2mb" }));

  app.get("/api/health", async (_req, res) => {
    const { storageBackend, storageLabel } = await import("./services/files");
    const clientReady = existsSync(path.join(repoRoot(), "public", "index.html"));
    try {
      await db.$queryRaw`SELECT 1`;
      res.json({
        ok: true,
        database: "up",
        storage: storageBackend(),
        storage_target: storageLabel(),
        serve_client: clientReady,
        cloud_sql: Boolean(process.env.INSTANCE_CONNECTION_NAME || process.env.DB_SOCKET_PATH),
      });
    } catch {
      res.status(503).json({ ok: false, database: "down", storage: storageBackend(), serve_client: clientReady });
    }
  });

  app.use("/api/auth", authRouter);

  app.get("/auth/refexone/saml", (req, res) => {
    res.type("application/xml").send(serviceProviderMetadata(req));
  });
  app.get("/auth/refexone/launch", async (req, res) => {
    if (!refexOneReady()) {
      res
        .status(503)
        .type("html")
        .send(
          `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Refex One</title></head><body style="font-family:sans-serif;max-width:36rem;margin:4rem auto;padding:0 1rem"><h1>Refex One is not configured</h1><p>Set REFEXONE_SAML_APP_ID (or REFEXONE_SSO_URL) and REFEXONE_IDP_CERT on the server, then restart it. The Administration page lists the addresses to register in Refex One.</p><p><a href="/login?admin=1">Administrator sign-in</a></p></body></html>`,
        );
      return;
    }
    try {
      res.redirect(await refexOneLoginUrl(req, safeNext(req.query.next)));
    } catch (error) {
      console.error(error);
      res.status(502).type("html").send("Refex One could not be opened. Use administrator sign-in.");
    }
  });
  app.use("/api", files);
  app.use("/api/actions", requireActor, actionRoutes);
  app.use("/api", requireActor, views);
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  // The built React client (npm run build → server/public) is served from the same origin, so cookies and /api links just work.
  // Checked per request, so a build made while the server is running is picked up without a restart.
  const clientDist = path.join(repoRoot(), "public");
  const clientIndex = path.join(clientDist, "index.html");
  app.use(express.static(clientDist, { index: false }));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    if (existsSync(clientIndex)) res.sendFile(clientIndex);
    else res.status(404).send("The frontend is not built yet. Run: npm run build");
  });

  const onError: ErrorRequestHandler = (error, _req, res, _next) => {
    console.error(error);
    if (error instanceof multer.MulterError) {
      res.status(400).json({ error: error.code === "LIMIT_FILE_SIZE" ? "Each file must be 25 MB or smaller." : error.message });
      return;
    }
    res.status(500).json({ error: "The server could not complete that request." });
  };
  app.use(onError);

  return app;
}
