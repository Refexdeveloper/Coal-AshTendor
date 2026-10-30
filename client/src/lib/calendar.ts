/** Copy of server/src/lib/calendar.ts (no server dependencies). Keep the two in step. */
const WEEKDAY: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

export type Calendar = {
  timeZone: string;
  startMin: number;
  endMin: number;
  workingDays: Set<number>;
  holidays: Set<string>;
};

export type Zoned = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
};

export function parseClock(value: string) {
  const [h, m] = value.split(":").map((part) => Number(part));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 9 * 60;
  return h * 60 + m;
}

export function zonedParts(date: Date, timeZone: string): Zoned {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    fmt
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAY[parts.weekday] ?? 1,
  };
}

export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
) {
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let i = 0; i < 4; i += 1) {
    const got = zonedParts(new Date(utc), timeZone);
    const diff =
      Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute, got.second) -
      Date.UTC(year, month - 1, day, hour, minute, 0);
    if (diff === 0) break;
    utc -= diff;
  }
  return new Date(utc);
}

function dateKey(part: { year: number; month: number; day: number }) {
  return `${part.year}-${String(part.month).padStart(2, "0")}-${String(part.day).padStart(2, "0")}`;
}

function addCalendarDays(year: number, month: number, day: number, days: number) {
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

function isOpenDay(part: Zoned, calendar: Calendar) {
  return calendar.workingDays.has(part.weekday) && !calendar.holidays.has(dateKey(part));
}

function atMinutes(part: Zoned, minutes: number, timeZone: string) {
  return zonedTimeToUtc(part.year, part.month, part.day, Math.floor(minutes / 60), minutes % 60, timeZone);
}

export function alignToBusinessOpen(date: Date, calendar: Calendar) {
  let cursor = date;
  for (let i = 0; i < 400; i += 1) {
    const part = zonedParts(cursor, calendar.timeZone);
    const mins = part.hour * 60 + part.minute;
    if (isOpenDay(part, calendar)) {
      if (mins < calendar.startMin) return atMinutes(part, calendar.startMin, calendar.timeZone);
      if (mins < calendar.endMin) {
        return zonedTimeToUtc(part.year, part.month, part.day, part.hour, part.minute, calendar.timeZone);
      }
    }
    const next = addCalendarDays(part.year, part.month, part.day, 1);
    cursor = zonedTimeToUtc(next.year, next.month, next.day, 0, 0, calendar.timeZone);
  }
  return date;
}

function plusMinutes(date: Date, minutes: number, timeZone: string) {
  const part = zonedParts(date, timeZone);
  const total = part.hour * 60 + part.minute + minutes;
  const extraDays = Math.floor(total / (24 * 60));
  const within = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const rolled = addCalendarDays(part.year, part.month, part.day, extraDays);
  return zonedTimeToUtc(rolled.year, rolled.month, rolled.day, Math.floor(within / 60), within % 60, timeZone);
}

export function addBusinessMinutes(start: Date, minutes: number, calendar: Calendar) {
  if (minutes <= 0) return alignToBusinessOpen(start, calendar);
  let cursor = alignToBusinessOpen(start, calendar);
  let left = minutes;
  for (let guard = 0; guard < 4000 && left > 0; guard += 1) {
    const part = zonedParts(cursor, calendar.timeZone);
    const current = part.hour * 60 + part.minute;
    const available = calendar.endMin - current;
    if (available <= 0) {
      cursor = alignToBusinessOpen(new Date(cursor.getTime() + 60_000), calendar);
      continue;
    }
    const step = Math.min(available, left);
    cursor = plusMinutes(cursor, step, calendar.timeZone);
    left -= step;
    if (left > 0) cursor = alignToBusinessOpen(new Date(cursor.getTime() + 60_000), calendar);
  }
  return cursor;
}

export function businessMinutesBetween(start: Date, end: Date, calendar: Calendar) {
  if (end.getTime() <= start.getTime()) return 0;
  let cursor = alignToBusinessOpen(start, calendar);
  if (cursor.getTime() >= end.getTime()) return 0;
  let total = 0;
  for (let guard = 0; guard < 4000; guard += 1) {
    const part = zonedParts(cursor, calendar.timeZone);
    const current = part.hour * 60 + part.minute;
    const available = calendar.endMin - current;
    if (available <= 0) {
      cursor = alignToBusinessOpen(new Date(cursor.getTime() + 60_000), calendar);
      if (cursor.getTime() >= end.getTime()) break;
      continue;
    }
    const endPart = zonedParts(end, calendar.timeZone);
    if (dateKey(part) === dateKey(endPart)) {
      const endMin = endPart.hour * 60 + endPart.minute;
      if (endMin <= current) break;
      total += Math.min(available, endMin - current);
      break;
    }
    total += available;
    cursor = alignToBusinessOpen(new Date(plusMinutes(cursor, available, calendar.timeZone).getTime() + 60_000), calendar);
    if (cursor.getTime() >= end.getTime()) break;
  }
  return total;
}

export function dayLengthMinutes(calendar: Calendar) {
  return Math.max(60, calendar.endMin - calendar.startMin);
}

export function formatWhen(date: Date | null | undefined, timeZone: string) {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export function formatDay(date: Date | null | undefined, timeZone: string) {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function formatDuration(minutes: number, dayLength: number) {
  const sign = minutes < 0 ? "-" : "";
  const abs = Math.abs(Math.round(minutes));
  const days = Math.floor(abs / dayLength);
  const rem = abs % dayLength;
  const hours = Math.floor(rem / 60);
  const mins = rem % 60;
  if (days > 0) return `${sign}${days}d ${hours}h`;
  if (hours > 0) return `${sign}${hours}h ${mins}m`;
  return `${sign}${mins}m`;
}

export function istDate(year: number, month: number, day: number, hour: number, minute: number) {
  return zonedTimeToUtc(year, month, day, hour, minute, "Asia/Kolkata");
}