const IST: Intl.DateTimeFormatOptions = {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
};

/** Mongo stores UTC. A value with no zone is still UTC; JS would otherwise read it as local. */
function asUtcDate(value: string | number | Date): Date {
  if (value instanceof Date || typeof value === "number") return new Date(value);
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(raw) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) {
    return new Date(`${raw.replace(" ", "T")}Z`);
  }
  return new Date(raw);
}

/** Format a UTC timestamp in Indian time. */
export function istDate(value: string | number | Date | null | undefined): string {
  if (value == null || value === "") return "—";
  try {
    const date = asUtcDate(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString("en-IN", IST);
  } catch {
    return String(value);
  }
}

/** Clock only, in Indian time. */
export function istTime(value: string | number | Date | null | undefined): string {
  if (value == null || value === "") return "—";
  try {
    const date = asUtcDate(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
  } catch {
    return String(value);
  }
}
