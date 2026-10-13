import type { Schedule } from "../shared/types";
export function localDay(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function due(s: Schedule, now: Date) {
  return (
    s.enabled &&
    s.lastRun !== localDay(now) &&
    `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}` >=
      s.time
  );
}
