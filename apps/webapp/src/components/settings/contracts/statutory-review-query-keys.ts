import type { QueryClient } from "@tanstack/react-query";
import type { StatutoryAcknowledgementKind } from "@/lib/statutory/acknowledgement-kinds";

// TanStack Query keys of the unified Reviews & Conflicts inbox (#1994), scoped to the organization.

/** "Statutory limits to act on": the findings no review list carries. */
export const statutoryMonitorFindingsQueryKey = (organizationId: string) =>
	["contracts", "statutory-monitor-findings", organizationId] as const;

export interface StatutoryAcknowledgementHistorySubject {
	readonly employeeId: string;
	readonly acknowledgementKind: StatutoryAcknowledgementKind;
	readonly findingKind: string;
	readonly subjectKey: string;
}

/** Every acknowledgement history of the organization. */
export const statutoryAcknowledgementHistoryScope = (organizationId: string) =>
	["contracts", "statutory-acknowledgement-history", organizationId] as const;

/**
 * After an acknowledgement in the inbox, beside the domain's own review list and monitor: the
 * statutory limits to act on (a documented Minijob month leaves the rolling 12-month sum) and the
 * organization's acknowledgement histories. The Compliance Command Center renders on the server
 * and reads the figures afresh on each visit.
 */
export function invalidateStatutoryReviewViews(
	queryClient: QueryClient,
	organizationId: string,
): Promise<unknown> {
	return Promise.all([
		queryClient.invalidateQueries({ queryKey: statutoryMonitorFindingsQueryKey(organizationId) }),
		queryClient.invalidateQueries({
			queryKey: statutoryAcknowledgementHistoryScope(organizationId),
		}),
	]);
}

export function statutoryAcknowledgementHistoryQueryKey(
	organizationId: string,
	subject: StatutoryAcknowledgementHistorySubject,
	currentInputFingerprint: string,
	currentStatus: string,
) {
	return [
		...statutoryAcknowledgementHistoryScope(organizationId),
		subject.employeeId,
		subject.acknowledgementKind,
		subject.findingKind,
		subject.subjectKey,
		currentInputFingerprint,
		currentStatus,
	] as const;
}
