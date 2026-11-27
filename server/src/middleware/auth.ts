import type { NextFunction, Request, Response } from "express";
import { db, type User } from "../db";
import { COOKIE, readSession, signSession } from "../utils/token";
import { allowedOrigins } from "./cors";
import { noteRequest } from "../services/user-activity";
import { userFromBearer } from "../services/api-tokens";

declare module "express-serve-static-core" {
  interface Request {
    actor?: User;
  }
}

/**
 * Who is calling: Authorization Bearer (admin API token) first, otherwise the signed session cookie.
 * Bearer does not set a cookie; the browser SSO path stays unchanged.
 */
export async function loadActor(req: Request) {
  const fromToken = await userFromBearer(req.get("authorization") || undefined);
  if (fromToken) return fromToken;
  const userId = await readSession(req.cookies?.[COOKIE]);
  if (!userId) return null;
  const user = await db.user.findUnique({ where: { id: userId } });
  return user?.active ? user : null;
}

/** Rejects the request with 401 unless a signed-in, active user is on the session cookie or a Bearer API token. */
export async function requireActor(req: Request, res: Response, next: NextFunction) {
  const user = await loadActor(req);
  if (!user) {
    res.status(401).json({ error: "Sign in required. Use a session cookie or Authorization: Bearer <api-token>." });
    return;
  }
  req.actor = user;
  // Daily usage report: this person used the app today.
  noteRequest(user.id).catch((error) => console.error("Could not record activity", error));
  next();
}

/** A frontend on another site needs SameSite=None (which browsers only accept over HTTPS) to send the cookie back. */
function cookieOptions() {
  const crossSite = allowedOrigins().length > 0;
  return {
    httpOnly: true,
    sameSite: crossSite ? ("none" as const) : ("lax" as const),
    secure: crossSite || process.env.NODE_ENV === "production",
    path: "/",
  };
}

export async function setSession(res: Response, userId: string) {
  res.cookie(COOKIE, await signSession(userId), { ...cookieOptions(), maxAge: 1000 * 60 * 60 * 24 * 7 });
}

export function clearSession(res: Response) {
  res.clearCookie(COOKIE, cookieOptions());
}

/** The fields the browser may see about a user; never the password hash. */
export function publicUser(user: User) {
  return { id: user.id, name: user.name, email: user.email, role: user.role, personKey: user.personKey, active: user.active };
}
