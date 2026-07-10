import type { WorkLocationType } from "./use-home-query";

type TimeClockAction =
  | { action: "clock_in"; workLocationType: WorkLocationType }
  | { action: "clock_out" };

type TimeClockEnvironment = {
  now: () => Date;
  timeZone: () => string | undefined;
  offsetMinutes: (instant: Date) => number;
};

const defaultEnvironment: TimeClockEnvironment = {
  now: () => new Date(),
  timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  offsetMinutes: (instant) => -instant.getTimezoneOffset(),
};

export function createTimeClockPayload(
  action: TimeClockAction,
  environment: TimeClockEnvironment = defaultEnvironment,
) {
  try {
    const instant = environment.now();
    const timezone = environment.timeZone();
    const utcOffsetMinutes = environment.offsetMinutes(instant);

    if (!timezone || !Number.isInteger(utcOffsetMinutes)) {
      return action;
    }

    return {
      ...action,
      instant: instant.toISOString(),
      timezone,
      utcOffsetMinutes,
    };
  } catch {
    // Older devices without Intl still use the server's saved-timezone fallback.
    return action;
  }
}
