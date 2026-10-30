import "./env";
import { existsSync } from "fs";
import path from "path";
import cookieParser from "cookie-parser";
import express, { type ErrorRequestHandler } from "express";
import multer from "multer";
import { db } from "./lib/db";
import { repoRoot } from "./lib/root";
import { checkLogin } from "./services/actions";
import { actionRoutes } from "./http/actions";
import { clearSession, publicUser, requireActor, setSession } from "./http/auth";
import { cors } from "./http/cors";
import { files } from "./http/files";
import { views } from "./http/views";
const port = 8080


const app = express();



app.set("trust proxy", 1);
app.use("/api", cors);
app.use(express.json());

app.get("/api/health", async (_req, res) => {
  try {
    await db.$queryRaw`SELECT 1`;
    res.json({ ok: true, database: "up" });
  } catch {
    res.status(503).json({ ok: false, database: "down" });
  }
});

app.post("/api/auth/login", multer().none(), async (req, res) => {
  const user = await checkLogin(String(req.body?.email || ""), String(req.body?.password || ""));
  if (!user) {
    res.json({ error: "Those credentials were not recognized." });
    return;
  }
  await setSession(res, user.id);
  res.json({ ok: "Signed in" });
});

app.post("/api/auth/logout", (_req, res) => {
  clearSession(res);
  res.json({ ok: "Signed out" });
});

/** Team list for the sign-in page, only when the demo hint is switched on. */
app.get("/api/auth/team", async (_req, res) => {
  if (process.env.DEMO_LOGIN_HINT !== "true") {
    res.json({ users: [] });
    return;
  }
  const users = await db.user.findMany({ where: { active: true }, orderBy: { name: "asc" } }).catch(() => []);
  res.json({ users: users.map(publicUser) });
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

app.listen(port, (error) => {
  if (error) {
    const busy = (error as NodeJS.ErrnoException).code === "EADDRINUSE";
    console.error(busy ? `Port ${port} is already in use. Stop the other server (for example npm run dev) or set PORT in server/.env.` : error);
    process.exit(1);
  }
  console.log(`Coal & Ash on http://localhost:${port}${existsSync(clientIndex) ? " (frontend + API)" : " (API only; run npm run build for the frontend)"}`);
});
