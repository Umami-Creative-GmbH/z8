import { DateTime } from "luxon";

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
});

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const pad = (value: number) => value.toString().padStart(2, "0");

export function formatElapsedTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export function formatClockTime(timestamp: string): string {
  const dateTime = DateTime.fromISO(timestamp);
  if (!dateTime.isValid) {
    return "Unknown time";
  }

  return timeFormatter.format(dateTime.toJSDate());
}

export function formatActionTime(timestamp: string): string {
  const dateTime = DateTime.fromISO(timestamp);
  if (!dateTime.isValid) {
    return "Unknown time";
  }

  const localDateTime = dateTime.toLocal();
  const isToday = localDateTime.hasSame(DateTime.local(), "day");
  const date = localDateTime.toJSDate();
  return isToday ? timeFormatter.format(date) : dateTimeFormatter.format(date);
}
