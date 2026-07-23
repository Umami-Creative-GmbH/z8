import { DateTime, IANAZone } from "luxon";
import type { WorkLocationType } from "./use-home-query";

type IntlApi = Pick<typeof Intl, "DateTimeFormat"> | null;

interface ActionEvidenceOptions {
	now?: DateTime;
	intlApi?: IntlApi;
}

export function getActionTimeTimezone(intlApi: IntlApi = Intl): string | null {
	try {
		const timezone = intlApi?.DateTimeFormat().resolvedOptions().timeZone;
		return timezone && IANAZone.isValidZone(timezone) ? timezone : null;
	} catch {
		return null;
	}
}

function captureActionEvidence({
	now = DateTime.utc(),
	intlApi,
}: ActionEvidenceOptions) {
	const browserTimezone = getActionTimeTimezone(intlApi) ?? "UTC";
	const instant = now.toUTC();

	return {
		timestamp: instant.toISO({ suppressMilliseconds: false }),
		browserTimezone,
		utcOffsetMinutes: instant.setZone(browserTimezone).offset,
	};
}

export function createMobileClockInAction({
	workLocationType,
	...options
}: ActionEvidenceOptions & { workLocationType: WorkLocationType }) {
	return {
		action: "clock_in" as const,
		workLocationType,
		...captureActionEvidence(options),
	};
}

export function createMobileClockOutAction(
	options: ActionEvidenceOptions = {},
) {
	return {
		action: "clock_out" as const,
		submissionId: crypto.randomUUID(),
		...captureActionEvidence(options),
	};
}
