import type { DeactivationPreview } from "@/lib/employee-lifecycle/deactivation/types";

/**
 * A deactivation preview in which nothing changes but what every deactivation
 * does (retention starts, the seat is released), for the UI tests (#1440).
 */
export function emptyDeactivationPreview(
	overrides: Partial<DeactivationPreview> = {},
): DeactivationPreview {
	return {
		at: "2026-10-24T08:00:00Z",
		timeZone: "Europe/Berlin",
		managerLinks: {
			reportsNeedingReplacement: [],
			reportsKeepingAnotherManager: [],
			formerReports: [],
			ownManagerLinks: [],
			replacementOptions: [],
		},
		teamLinks: { teams: [], projectAssignments: [], projectManagerLinks: [] },
		approvalDuties: { handovers: [], reviews: [] },
		shifts: { shiftsToOpen: [] },
		absences: { absencesToCancel: [], absencesSpanning: [], absencesInClosedMonths: [] },
		accessEnds: {
			grants: [],
			drivingAuthorizations: [],
			kioskBadges: [],
			kioskFobs: [],
			shareLinks: [],
		},
		retentionStarts: true,
		seatReleased: true,
		refusals: [],
		...overrides,
	};
}
