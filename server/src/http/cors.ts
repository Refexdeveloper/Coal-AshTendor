import type { NextFunction, Request, Response } from "express";

/** Frontend addresses allowed to call this API from another origin, from CLIENT_ORIGIN (comma separated). */
export function allowedOrigins() {
  return (process.env.CLIENT_ORIGIN || "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

/** CORS with credentials, so a React client on another host can send the session cookie. */
export function cors(req: Request, res: Response, next: NextFunction) {
  const origin = req.headers.origin;
  if (origin && allowedOrigins().includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
}
