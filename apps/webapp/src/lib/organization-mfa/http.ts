import { NextResponse } from "next/server";
export function mfaChallengeFromSession(
	value: unknown,
): { organizationId: string; deadline: string | null } | null {
	if (!value || typeof value !== "object" || !("mfaRequired" in value))
		return null;
	const requirement = value.mfaRequired;
	if (
		!requirement ||
		typeof requirement !== "object" ||
		!("organizationId" in requirement) ||
		typeof requirement.organizationId !== "string"
	)
		return null;
	return {
		organizationId: requirement.organizationId,
		deadline:
			"deadline" in requirement && typeof requirement.deadline === "string"
				? requirement.deadline
				: null,
	};
}
/** Keep the existing access hold code so frozen records retain their identity and bytes. */
export function mfaAccessHold(value: unknown, operationId?: string) {
	const requirement = mfaChallengeFromSession(value);
	if (!requirement) return null;
	return NextResponse.json(
		{
			outcome: "rejected",
			code: "access_denied",
			authenticationRequired: "MFA_REQUIRED",
			...requirement,
			...(operationId ? { operationId } : {}),
			verificationUrl: `/mfa?organizationId=${encodeURIComponent(requirement.organizationId)}`,
		},
		{ status: 403, headers: { "Cache-Control": "no-store" } },
	);
}
