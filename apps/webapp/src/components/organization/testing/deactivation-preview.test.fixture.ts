import type { DeactivationPreview } from "@/lib/employee-lifecycle/deactivation/types";
import type { EmploymentEndingPlan } from "@/lib/employee-lifecycle/employment-ending/types";

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
		absences: {
			absencesToCancel: [],
			absencesSpanning: [],
			absencesInClosedMonths: [],
		},
		employmentEnding: emptyEmploymentEndingPlan(),
		retentionStarts: true,
		seatReleased: true,
		refusals: [],
		...overrides,
	};
}

/** An Employment ending plan that ends nothing. */
export function emptyEmploymentEndingPlan(
	overrides: Partial<EmploymentEndingPlan> = {},
): EmploymentEndingPlan {
	return {
		equipment: { returns: [], officerGrantIds: [] },
		drivingLicence: { authorizations: [], verifierGrantIds: [] },
		officerGrants: { grants: [] },
		documentRequests: { requestIds: [] },
		kioskBadges: { badgeIds: [] },
		kioskFobs: { fobIds: [] },
		reportShareLinks: { links: [] },
		deputyAssignments: { assignments: [] },
		...overrides,
	};
}
