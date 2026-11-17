"use client";

import { ORGANIZATION_CONTEXT_HEADERS } from "@/lib/auth/organization-display-context";
import type {
	ClockComplianceMode,
	ClockComplianceScope,
	ClockComplianceSnapshot,
} from "@/lib/compliance/clock-compliance-types";
import { ApiError, fetchApi } from "@/lib/fetch";

export async function fetchClockCompliance(
	scope: ClockComplianceScope,
	mode: ClockComplianceMode,
	currentSessionMinutes: number,
	signal: AbortSignal,
): Promise<ClockComplianceSnapshot> {
	const search = new URLSearchParams({
		mode,
		currentSessionMinutes: String(currentSessionMinutes),
	});
	const snapshot = await fetchApi<ClockComplianceSnapshot>(
		`/api/time-entries/compliance?${search}`,
		{
			cache: "no-store",
			signal,
			headers: {
				[ORGANIZATION_CONTEXT_HEADERS.user]: scope.userId,
				[ORGANIZATION_CONTEXT_HEADERS.organization]: scope.organizationId,
			},
		},
	);
	if (
		snapshot.mode !== mode ||
		snapshot.scope.userId !== scope.userId ||
		snapshot.scope.organizationId !== scope.organizationId ||
		snapshot.scope.employeeId !== scope.employeeId
	) {
		throw new ApiError("Organization context changed. Refresh to continue.", 409);
	}
	return snapshot;
}
