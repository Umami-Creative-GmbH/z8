import { DateTime, IANAZone } from "luxon";

type IntlApi = Pick<typeof Intl, "DateTimeFormat"> | null;

interface ClockActionOptions {
  type: "clock_in" | "clock_out";
  now?: DateTime;
  intlApi?: IntlApi;
  actionId?: string;
}

export interface ClockAction {
  id: string;
  type: "clock_in" | "clock_out";
  timestamp: string;
  browserTimezone: string;
  utcOffsetMinutes: number;
}

export function toReplayClockAction(action: ClockAction): ClockAction & { replay: true } {
  return { ...action, replay: true };
}

export function getActionTimezone(intlApi: IntlApi = Intl): string | null {
  try {
    const timezone = intlApi?.DateTimeFormat().resolvedOptions().timeZone;
    return timezone && IANAZone.isValidZone(timezone) ? timezone : null;
  } catch {
    return null;
  }
}

export function createClockAction({
  type,
  now = DateTime.utc(),
  intlApi,
  actionId = crypto.randomUUID(),
}: ClockActionOptions): ClockAction {
  const browserTimezone = getActionTimezone(intlApi) ?? "UTC";
  const instant = now.toUTC();
  const timestamp = instant.toISO({ suppressMilliseconds: false });

  if (!timestamp) {
    throw new Error("Unable to capture clock action instant");
  }

  return {
    id: actionId,
    type,
    timestamp,
    browserTimezone,
    utcOffsetMinutes: instant.setZone(browserTimezone).offset,
  };
}
