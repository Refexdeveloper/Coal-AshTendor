import { Router } from "express";
import multer from "multer";
import { db } from "../db";
import { checkLogin } from "../services/actions";
import { clearSession, publicUser, setSession } from "../middleware/auth";
import { consumeRefexOne } from "../services/refexone";

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

function signInPage(title: string, message: string) {
  const text = message.replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char] || char);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body style="font-family:sans-serif;max-width:36rem;margin:4rem auto;padding:0 1rem"><h1>${title}</h1><p>${text}</p><p><a href="/login?admin=1">Administrator sign-in</a></p></body></html>`;
}

/** Refex One posts the signed assertion here. The browser is then sent into the app with a session cookie. */
authRouter.post("/refexone/saml/acs", async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, string>;
    const result = await consumeRefexOne(req, body);
    if ("error" in result) {
      res.status(401).type("html").send(signInPage("Refex One sign-in failed", result.error));
      return;
    }
    await setSession(res, result.userId);
    res.redirect(result.next);
  } catch (error) {
    console.error(error);
    const message = error instanceof Error && error.message ? error.message : "Refex One sign-in failed.";
    res.status(401).type("html").send(signInPage("Refex One sign-in failed", message));
  }
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
