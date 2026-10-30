import { Router } from "express";
import multer from "multer";
import { db } from "../db";
import { checkLogin } from "../services/actions";
import { clearSession, publicUser, setSession } from "../middleware/auth";

export const authRouter = Router();

authRouter.post("/login", multer().none(), async (req, res) => {
  const user = await checkLogin(String(req.body?.email || ""), String(req.body?.password || ""));
  if (!user) {
    res.json({ error: "Those credentials were not recognized." });
    return;
  }
  await setSession(res, user.id);
  res.json({ ok: "Signed in" });
});

authRouter.post("/logout", (_req, res) => {
  clearSession(res);
  res.json({ ok: "Signed out" });
});

/** Team list for the sign-in page, only when the demo hint is switched on. */
authRouter.get("/team", async (_req, res) => {
  if (process.env.DEMO_LOGIN_HINT !== "true") {
    res.json({ users: [] });
    return;
  }
  const users = await db.user.findMany({ where: { active: true }, orderBy: { name: "asc" } }).catch(() => []);
  res.json({ users: users.map(publicUser) });
});
