import { DateTime } from "luxon";

export type QualificationStatus = "valid" | "expiringSoon" | "expired";
export type RequirementEnforcementMode = "warning" | "blocking";

export function getQualificationStatus(input: {
	expiresAt: Date | null;
	warningDays: number;
	now?: DateTime;
}): QualificationStatus {
	if (!input.expiresAt) return "valid";

	const now = input.now ?? DateTime.now();
	const expiry = DateTime.fromJSDate(input.expiresAt);

	if (expiry <= now) return "expired";
	if (expiry <= now.plus({ days: Math.max(input.warningDays, 0) })) return "expiringSoon";

	return "valid";
}

export function mergeRequirementMode(
	left: RequirementEnforcementMode,
	right: RequirementEnforcementMode,
): RequirementEnforcementMode {
	return left === "blocking" || right === "blocking" ? "blocking" : "warning";
}
