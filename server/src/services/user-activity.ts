import { randomBytes } from "node:crypto";
import { db } from "../db";
import { getCalendar } from "./domain";
import { zonedParts, zonedTimeToUtc } from "../utils/calendar";
import { OPEN_TASK } from "../utils/labels";

/**
 * Daily usage per person: one UserActivity row per user per calendar day (company time zone) holding when they were
 * first and last seen, how many signed-in requests they made and how many times they signed in. A sign-in session
 * lasts a week, so "used the app that day" is the activity, not only the sign-in itself.
 *
 * Requests are written at most once every few minutes per person, so ordinary use costs almost nothing.
 */

const WRITE_EVERY_MS = 5 * 60 * 1000;
const lastWrite = new Map<string, { at: number; day: string; requests: number }>();
let zone = { name: "Asia/Kolkata", at: 0 };

async function timeZone() {
  if (Date.now() - zone.at > 10 * 60 * 1000) {
    const calendar = await getCalendar().catch(() => null);
    zone = { name: calendar?.timeZone ?? zone.name, at: Date.now() };
  }
  return zone.name;
}

export function dayKeyOf(date: Date, tz: string) {
  const part = zonedParts(date, tz);
  return `${part.year}-${String(part.month).padStart(2, "0")}-${String(part.day).padStart(2, "0")}`;
}

function dayBounds(day: string, tz: string) {
  const [year, month, date] = day.split("-").map(Number);
  const start = zonedTimeToUtc(year, month, date, 0, 0, tz);
  const next = new Date(Date.UTC(year, month - 1, date + 1));
  const end = zonedTimeToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, tz);
  return { start, end };
}

async function write(userId: string, day: string, requests: number, signIns: number, method: string) {
  const now = new Date();
  await db.$queryRaw`INSERT INTO UserActivity (id, userId, day, firstSeenAt, lastSeenAt, requests, signIns, lastMethod)
    VALUES (${randomBytes(16).toString("hex")}, ${userId}, ${day}, ${now}, ${now}, ${requests}, ${signIns}, ${method})
    ON DUPLICATE KEY UPDATE lastSeenAt = VALUES(lastSeenAt), requests = requests + VALUES(requests), signIns = signIns + VALUES(signIns),
    lastMethod = IF(VALUES(lastMethod) = '', lastMethod, VALUES(lastMethod))`;
}

/** A signed-in request. Counted in memory and written every few minutes, or straight away on a new day. */
export async function noteRequest(userId: string) {
  const tz = await timeZone();
  const day = dayKeyOf(new Date(), tz);
  const seen = lastWrite.get(userId);
  if (seen && seen.day === day && Date.now() - seen.at < WRITE_EVERY_MS) {
    seen.requests += 1;
    return;
  }
  const requests = (seen && seen.day === day ? seen.requests : 0) + 1;
  lastWrite.set(userId, { at: Date.now(), day, requests: 0 });
  await write(userId, day, requests, 0, "");
}

/** A sign-in: with the password form or through Refex One. */
export async function noteSignIn(userId: string, method: "PASSWORD" | "REFEXONE") {
  const tz = await timeZone();
  const day = dayKeyOf(new Date(), tz);
  lastWrite.set(userId, { at: Date.now(), day, requests: 0 });
  await write(userId, day, 1, 1, method);
}

type Row = Record<string, any>;
const parseIds = (value: string) => {
  try {
    return JSON.parse(value || "[]") as string[];
  } catch {
    return [];
  }
};

/** The person-wise report for one day: used the app or not, and their tasks. */
export async function userReport(dayParam?: string) {
  const tz = await timeZone();
  const today = dayKeyOf(new Date(), tz);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(dayParam ?? "") ? dayParam! : today;
  const { start, end } = dayBounds(day, tz);
  // The seven days ending on the chosen day, for the activity strip.
  const week = Array.from({ length: 7 }, (_, index) => dayKeyOf(new Date(start.getTime() - (6 - index) * 864e5 + 12 * 3600e3), tz));

  const [users, activity, tasks]: Row[][] = await Promise.all([
    db.user.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.userActivity.findMany({}),
    db.workflowTask.findMany({ include: { tender: true } }),
  ]);
  const now = Date.now();
  const inDay = (value: unknown) => {
    if (!value) return false;
    const time = new Date(value as string).getTime();
    return time >= start.getTime() && time < end.getTime();
  };

  const people = users.map((user) => {
    const mine = activity.filter((row) => row.userId === user.id);
    const onDay = mine.find((row) => row.day === day);
    const last = mine.reduce<Date | null>((latest, row) => {
      const seen = new Date(row.lastSeenAt);
      return !latest || seen > latest ? seen : latest;
    }, null);
    const assigned = tasks.filter((task) => parseIds(task.assigneeIds).includes(user.id));
    const open = assigned.filter((task) => OPEN_TASK.includes(task.status));
    const overdue = open.filter((task) => task.dueAt && new Date(task.dueAt).getTime() < now);
    const dueOnDay = open.filter((task) => inDay(task.dueAt));
    const doneOnDay = tasks.filter((task) => task.completedById === user.id && inDay(task.completedAt));
    const assignedOnDay = assigned.filter((task) => inDay(task.createdAt));
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      loggedIn: Boolean(onDay),
      firstSeenAt: onDay?.firstSeenAt ?? null,
      lastSeenAt: onDay?.lastSeenAt ?? null,
      requests: onDay?.requests ?? 0,
      signIns: onDay?.signIns ?? 0,
      method: onDay?.lastMethod ?? "",
      lastSeenEver: last,
      week: week.map((key) => ({ day: key, active: mine.some((row) => row.day === key) })),
      counts: {
        assignedTotal: assigned.length,
        open: open.length,
        overdue: overdue.length,
        dueOnDay: dueOnDay.length,
        assignedOnDay: assignedOnDay.length,
        doneOnDay: doneOnDay.length,
        completedTotal: assigned.filter((task) => task.status === "COMPLETED").length,
      },
      tasks: open
        .sort((a, b) => (a.dueAt ? new Date(a.dueAt).getTime() : Infinity) - (b.dueAt ? new Date(b.dueAt).getTime() : Infinity))
        .map((task) => ({
          id: task.id,
          tenderId: task.tenderId,
          recordId: task.tender?.recordId ?? "",
          project: task.tender?.projectName ?? "",
          client: task.tender?.clientName ?? "",
          stage: task.stage,
          title: task.title,
          status: task.status,
          dueAt: task.dueAt,
          overdue: Boolean(task.dueAt && new Date(task.dueAt).getTime() < now),
        })),
    };
  });

  const loggedIn = people.filter((person) => person.loggedIn).length;
  return {
    day,
    today,
    timeZone: tz,
    week,
    trackingSince: activity.reduce<string | null>((first, row) => (!first || row.day < first ? row.day : first), null),
    totals: {
      users: people.length,
      loggedIn,
      notLoggedIn: people.length - loggedIn,
      openTasks: people.reduce((sum, person) => sum + person.counts.open, 0),
      overdue: people.reduce((sum, person) => sum + person.counts.overdue, 0),
      doneOnDay: people.reduce((sum, person) => sum + person.counts.doneOnDay, 0),
      dueOnDay: people.reduce((sum, person) => sum + person.counts.dueOnDay, 0),
    },
    people,
  };
}
