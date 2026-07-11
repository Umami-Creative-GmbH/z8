import { parseIanaTimeZone } from "./validation";

export type TimezoneResolutionSource = "user" | "organization" | "digest_schedule" | "default";
export type PersistedTimezoneSource = Exclude<TimezoneResolutionSource, "default">;

export interface InvalidTimezoneCandidate {
	source: PersistedTimezoneSource;
	value: unknown;
}

export interface ResolvedTimezone<
	Source extends TimezoneResolutionSource = TimezoneResolutionSource,
> {
	timezone: string;
	source: Source;
	invalidCandidates: InvalidTimezoneCandidate[];
}

interface PersonalTimezoneCandidates {
	userTimezone?: unknown;
	organizationTimezone?: unknown;
}

interface DigestScheduleTimezoneCandidates {
	digestTimezone?: unknown;
	organizationTimezone?: unknown;
}

function resolveCandidate(
	value: unknown,
	source: PersistedTimezoneSource,
	invalidCandidates: InvalidTimezoneCandidate[],
): string | undefined {
	if (value === undefined) {
		return undefined;
	}

	try {
		return parseIanaTimeZone(value);
	} catch {
		invalidCandidates.push({ source, value });
		return undefined;
	}
}

export function resolvePersonalTimezone({
	userTimezone,
	organizationTimezone,
}: PersonalTimezoneCandidates): ResolvedTimezone<"user" | "organization" | "default"> {
	const invalidCandidates: InvalidTimezoneCandidate[] = [];
	const user = resolveCandidate(userTimezone, "user", invalidCandidates);
	if (user !== undefined) {
		return { timezone: user, source: "user", invalidCandidates };
	}

	const organization = resolveCandidate(organizationTimezone, "organization", invalidCandidates);
	if (organization !== undefined) {
		return { timezone: organization, source: "organization", invalidCandidates };
	}

	return { timezone: "UTC", source: "default", invalidCandidates };
}

export function resolveOrganizationTimezone(
	value?: unknown,
): ResolvedTimezone<"organization" | "default"> {
	const invalidCandidates: InvalidTimezoneCandidate[] = [];
	const organization = resolveCandidate(value, "organization", invalidCandidates);
	if (organization !== undefined) {
		return { timezone: organization, source: "organization", invalidCandidates };
	}

	return { timezone: "UTC", source: "default", invalidCandidates };
}

export function resolveDigestScheduleTimezone({
	digestTimezone,
	organizationTimezone,
}: DigestScheduleTimezoneCandidates): ResolvedTimezone<
	"digest_schedule" | "organization" | "default"
> {
	const invalidCandidates: InvalidTimezoneCandidate[] = [];
	const digestSchedule = resolveCandidate(digestTimezone, "digest_schedule", invalidCandidates);
	if (digestSchedule !== undefined) {
		return { timezone: digestSchedule, source: "digest_schedule", invalidCandidates };
	}

	const organization = resolveCandidate(organizationTimezone, "organization", invalidCandidates);
	if (organization !== undefined) {
		return { timezone: organization, source: "organization", invalidCandidates };
	}

	return { timezone: "UTC", source: "default", invalidCandidates };
}
