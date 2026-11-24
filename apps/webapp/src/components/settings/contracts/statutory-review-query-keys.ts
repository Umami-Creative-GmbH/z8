import type { QueryClient } from "@tanstack/react-query";
import type { StatutoryAcknowledgementKind } from "@/lib/statutory/acknowledgement-kinds";
import { queryKeys } from "@/lib/query/keys";

// TanStack Query keys of the unified Reviews & Conflicts inbox (#1994), scoped to the organization.

/** "Statutory limits to act on": the findings no review list carries. */
export const statutoryMonitorFindingsQueryKey = (organizationId: string) =>
	["contracts", "statutory-monitor-findings", organizationId] as const;

/** The Youth & Apprentice review lists (#1993, #2022). */
export const youthReviewQueryKeys = {
	sectorExceptions: (organizationId: string) =>
		["contracts", "youth-sector-exceptions", organizationId] as const,
	minorContractors: (organizationId: string) =>
		["contracts", "minor-contractor-reviews", organizationId] as const,
};

/** Working-student data (#1991): the monitor cards on Employee Detail and the review list. */
export const workingStudentQueryKeys = {
	/** Every working-student monitor card of the organization. */
	monitorScope: (organizationId: string) => ["working-student-monitor", organizationId] as const,
	monitor: (organizationId: string, employeeId: string) =>
		[...workingStudentQueryKeys.monitorScope(organizationId), employeeId] as const,
	reviews: (organizationId: string) =>
		["contracts", "working-student-reviews", organizationId] as const,
};

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

/**
 * After a change to the organization's statutory preferences (warning tiers, the JArbSchG publish
 * block, the working-student daytime band, #2017): every view of its statutory warnings judges
 * anew, the working-student monitor cards, the review lists, Scheduling's compliance warnings and
 * Staffing's suggestions.
 */
export function invalidateOrganizationStatutoryFindings(
	queryClient: QueryClient,
	organizationId: string,
): Promise<unknown> {
	return Promise.all([
		queryClient.invalidateQueries({
			queryKey: workingStudentQueryKeys.monitorScope(organizationId),
		}),
		queryClient.invalidateQueries({ queryKey: workingStudentQueryKeys.reviews(organizationId) }),
		invalidateStatutoryReviewViews(queryClient, organizationId),
		queryClient.invalidateQueries({
			queryKey: queryKeys.compliance.scheduleWarningsScope(organizationId),
		}),
		queryClient.invalidateQueries({
			queryKey: queryKeys.shifts.staffingSuggestionsScope(organizationId),
		}),
		// #2022: judging minor contractors under JArbSchG changes both youth review lists.
		queryClient.invalidateQueries({
			queryKey: youthReviewQueryKeys.sectorExceptions(organizationId),
		}),
		queryClient.invalidateQueries({
			queryKey: youthReviewQueryKeys.minorContractors(organizationId),
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
