import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionState } from "./action-state";
import type { Calendar } from "../utils/calendar";
import type { CalendarJson } from "../lib/types";

/**
 * Where the backend lives. Empty (the default) means the same origin: in development Vite proxies /api
 * to the server, and in production the server serves this app. Set VITE_API_URL in client/.env to talk
 * to a backend on another host, e.g. VITE_API_URL=https://api.example.com
 */
export const API_BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

export function apiUrl(path: string) {
  return `${API_BASE}/api${path}`;
}

/** Link to a stored tender document, for <a href> and <iframe src>. */
export function documentUrl(id: string) {
  return apiUrl(`/documents/${encodeURIComponent(id)}`);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

/** JSON reviver that turns the API's ISO timestamps back into Date objects. */
function reviveDates(_key: string, value: unknown) {
  return typeof value === "string" && ISO_DATE.test(value) ? new Date(value) : value;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function toSignIn() {
  const path = window.location.pathname;
  if (path.startsWith("/login")) return;
  if (path.startsWith("/admin")) {
    const next = `${path}${window.location.search}`;
    window.location.assign(`/login?admin=1&next=${encodeURIComponent(next)}`);
    return;
  }
  window.location.assign("/auth/refexone/launch");
}

async function parse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const body = text ? JSON.parse(text, reviveDates) : null;
  if (response.status === 401) toSignIn();
  if (!response.ok) throw new ApiError(body?.error || `Request failed (${response.status})`, response.status);
  return body as T;
}

export async function apiGet<T>(path: string): Promise<T> {
  return parse<T>(await fetch(apiUrl(path), { credentials: "include", headers: { Accept: "application/json" } }));
}

export async function apiPost<T>(path: string, body?: FormData): Promise<T> {
  return parse<T>(await fetch(apiUrl(path), { method: "POST", credentials: "include", body }));
}

/** Loaders currently on screen. After any change, every one of them fetches again (like revalidating the page). */
const loaders = new Set<() => Promise<void>>();

export function revalidate() {
  return Promise.all([...loaders].map((load) => load())).then(() => undefined);
}

function requestSummary(formData: FormData) {
  return [...formData.entries()]
    .map(([key, value]) => (value instanceof File ? `${key}: ${value.name} (${value.size} bytes, ${value.type || "unknown type"})` : `${key}: ${String(value)}`))
    .join("\n");
}

/** Posts a form to /api/actions/<name>, refreshes the data on screen, then returns the action's result. */
export async function postAction(name: string, formData: FormData): Promise<ActionState> {
  const url = apiUrl(`/actions/${name}`);
  const request = requestSummary(formData);
  let response: Response;
  try {
    response = await fetch(url, { method: "POST", credentials: "include", body: formData });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The action could not be completed.";
    return { error: message, exchange: { method: "POST", url, status: 0, request, response: message } };
  }
  const text = await response.text();
  let body: ActionState = null;
  try {
    body = text ? (JSON.parse(text, reviveDates) as ActionState) : null;
  } catch {
    body = { error: text.slice(0, 500) || `Request failed (${response.status})` };
  }
  if (response.status === 401) toSignIn();
  const exchange = { method: "POST", url, status: response.status, request, response: text.slice(0, 8000) };
  if (!response.ok) return { error: body?.error || `Request failed (${response.status})`, exchange };
  await revalidate();
  return body?.error ? { ...body, exchange } : body;
}

/** Fetches `/api${path}` and keeps it current; the last good data stays on screen while it refreshes. */
export function useApi<T>(path: string) {
  const [state, setState] = useState<{ path?: string; data?: T; error?: Error }>({});
  const latest = useRef(0);
  const load = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const data = await apiGet<T>(path);
      if (ticket === latest.current) setState({ path, data });
    } catch (error) {
      if (ticket === latest.current) setState((previous) => ({ ...previous, path, error: error as Error }));
    }
  }, [path]);
  useEffect(() => {
    loaders.add(load);
    void load();
    return () => {
      loaders.delete(load);
    };
  }, [load]);
  const current = state.path === path;
  return { data: current ? state.data : undefined, error: current ? state.error : undefined, reload: load };
}

export function toCalendar(raw: CalendarJson): Calendar {
  return { ...raw, workingDays: new Set(raw.workingDays), holidays: new Set(raw.holidays) };
}
