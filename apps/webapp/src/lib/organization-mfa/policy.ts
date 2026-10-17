import { Temporal } from "temporal-polyfill";
import type { Instant } from "@/lib/datetime/temporal-core";

export const MFA_GRACE_PERIODS = [0, 7, 14, 30] as const;
export type MfaGracePeriodDays = (typeof MFA_GRACE_PERIODS)[number];
export interface EnrollmentWindow {
	startsAt: string;
	deadline: string;
	gracePeriodDays: MfaGracePeriodDays;
}

export function assignEnrollmentWindow(
	input: { startsAt: string; gracePeriodDays: number },
	existing?: EnrollmentWindow,
): EnrollmentWindow {
	if (existing) return existing;
	if (!MFA_GRACE_PERIODS.some((days) => days === input.gracePeriodDays))
		throw new RangeError("Unsupported MFA enrollment window");
	return {
		startsAt: input.startsAt,
		gracePeriodDays: input.gracePeriodDays as MfaGracePeriodDays,
		deadline: Temporal.Instant.from(input.startsAt)
			.add({ hours: input.gracePeriodDays * 24 })
			.toString(),
	};
}

export function hasRecentVerification(
	verifiedAt: string | null | undefined,
	now: Instant,
): boolean {
	if (!verifiedAt) return false;
	const verified = Temporal.Instant.from(verifiedAt);
	return (
		Temporal.Instant.compare(verified, now) <= 0 &&
		Temporal.Instant.compare(verified, now.subtract({ minutes: 5 })) >= 0
	);
}
