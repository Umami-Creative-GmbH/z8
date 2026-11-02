import { describe, expect, it } from "vitest";
import type { DeactivationApplied, DeactivationPlan } from "./deactivation/types";
import { buildReactivationChecklistItems, checklistPlanSnapshot } from "./reactivation-checklist";

const PERSON = "00000000-0000-4000-8000-000000000001";
const ORPHAN = "00000000-0000-4000-8000-000000000002";
const KEEPS = "00000000-0000-4000-8000-000000000003";
const MANAGER = "00000000-0000-4000-8000-000000000004";
const REPLACEMENT = "00000000-0000-4000-8000-000000000005";
const BYSTANDER = "00000000-0000-4000-8000-000000000006";

function plan(): DeactivationPlan {
	return {
		at: "2026-10-24T08:00:00Z",
		timeZone: "Europe/Berlin",
		managerLinks: {
			reportsNeedingReplacement: [
				{
					employeeId: ORPHAN,
					name: "Rita Report",
					wasPrimary: true,
					replacementEmployeeId: REPLACEMENT,
					refusal: null,
				},
			],
			reportsKeepingAnotherManager: [
				{ employeeId: KEEPS, name: "Kim Keeps", newPrimaryManagerId: MANAGER },
			],
			formerReports: [],
			ownManagerLinks: [{ employeeId: MANAGER, name: "Mia Manager", isPrimary: true }],
			replacementOptions: [
				{ employeeId: REPLACEMENT, name: "Anna Admin" },
				{ employeeId: BYSTANDER, name: "Bea Bystander" },
			],
		},
		teamLinks: {
			teams: [{ teamId: "team-1", name: "Floor team" }],
			projectAssignments: [{ projectId: "project-1", name: "Relaunch" }],
			projectManagerLinks: [{ projectId: "project-2", name: "Audit" }],
		},
		approvalDuties: { handovers: [], reviews: [] },
		shifts: {
			shiftsToOpen: [
				{ shiftId: "shift-1", date: "2026-10-27", startTime: "09:00", endTime: "17:00" },
				{ shiftId: "shift-2", date: "2026-10-28", startTime: "09:00", endTime: "17:00" },
			],
			plannerRecipientUserIds: ["user-manager"],
		},
		absences: {
			absencesToCancel: [
				{
					absenceId: "absence-1",
					categoryName: "Annual leave",
					startDate: "2026-11-02",
					endDate: "2026-11-03",
					status: "pending",
				},
			],
			absencesSpanning: [
				{
					absenceId: "absence-spanning",
					categoryName: "Annual leave",
					startDate: "2026-10-23",
					endDate: "2026-10-27",
					status: "approved",
				},
			],
			absencesInClosedMonths: [],
		},
		accessEnds: {
			grants: [
				{ kind: "expense_officer", grantId: "grant-expense" },
				{ kind: "driving_licence_verifier", grantId: "grant-verifier" },
			],
			drivingAuthorizations: [
				{ authorizationId: "auth-b", state: "suspended" },
				{ authorizationId: "auth-c", state: "suspended" },
			],
			kioskBadges: [{ badgeId: "badge-1" }],
			kioskFobs: [{ fobId: "fob-1" }],
			shareLinks: [{ linkId: "link-1", kind: "project" }],
		},
		retentionStarts: true,
		seatReleased: true,
		refusals: [],
	};
}

function applied(): DeactivationApplied {
	return {
		managerLinks: {
			removedLinks: [
				{ employeeId: KEEPS, managerId: PERSON },
				{ employeeId: ORPHAN, managerId: PERSON },
				{ employeeId: PERSON, managerId: MANAGER },
			],
			addedLinks: [{ employeeId: ORPHAN, managerId: REPLACEMENT, isPrimary: true }],
			promotedLinks: [{ employeeId: KEEPS, managerId: MANAGER }],
		},
		teamLinks: {
			teamIds: ["team-1"],
			projectAssignmentProjectIds: ["project-1"],
			projectManagerProjectIds: ["project-2"],
		},
		approvalDuties: { handoverTaskIds: ["task-1"], reviewIds: [] },
		// The second shift was reassigned before the submit: it was not opened.
		shifts: { openedShiftIds: ["shift-1"] },
		absences: { cancelledAbsenceIds: ["absence-1"] },
		accessEnds: {
			grantIds: ["grant-expense", "grant-verifier"],
			drivingAuthorizationIds: ["auth-b", "auth-c"],
			kioskBadgeIds: ["badge-1"],
			// Nothing to grant again: the employee registers a fob themselves at a kiosk.
			kioskFobIds: ["fob-1"],
			shareLinkIds: ["link-1"],
		},
	};
}

describe("reactivation checklist", () => {
	it("lists exactly what the deactivation applied, each with the page it is granted again on", () => {
		expect(
			buildReactivationChecklistItems({ employeeId: PERSON, applied: applied(), plan: plan() }),
		).toEqual([
			{
				group: "managers",
				kind: "report_moved",
				employeeId: ORPHAN,
				name: "Rita Report",
				newManagerName: "Anna Admin",
				href: `/settings/employees/${ORPHAN}`,
			},
			{
				group: "managers",
				kind: "report_link_ended",
				employeeId: KEEPS,
				name: "Kim Keeps",
				href: `/settings/employees/${KEEPS}`,
			},
			{
				group: "managers",
				kind: "own_manager",
				employeeId: MANAGER,
				name: "Mia Manager",
				href: `/settings/employees/${PERSON}`,
			},
			{
				group: "grants",
				kind: "grant",
				grant: "expense_officer",
				href: "/settings/travel-expenses?tab=access",
			},
			{
				group: "grants",
				kind: "grant",
				grant: "driving_licence_verifier",
				href: "/settings/driving-licence?tab=verifiers",
			},
			{
				group: "access",
				kind: "kiosk_badges",
				count: 1,
				href: `/settings/employees/${PERSON}`,
			},
			{
				group: "access",
				kind: "driving_authorizations",
				count: 2,
				href: `/driving-licence/checks/${PERSON}`,
			},
			{
				group: "teams",
				kind: "team",
				id: "team-1",
				name: "Floor team",
				href: "/settings/teams/team-1",
			},
			{
				group: "teams",
				kind: "project_assignment",
				id: "project-1",
				name: "Relaunch",
				href: "/settings/projects",
			},
			{
				group: "teams",
				kind: "project_manager",
				id: "project-2",
				name: "Audit",
				href: "/settings/projects",
			},
			{
				group: "shifts",
				kind: "shift",
				id: "shift-1",
				date: "2026-10-27",
				startTime: "09:00",
				endTime: "17:00",
				href: "/scheduling",
			},
			{
				group: "absences",
				kind: "absence",
				id: "absence-1",
				categoryName: "Annual leave",
				startDate: "2026-11-02",
				endDate: "2026-11-03",
				href: "/team/absences",
			},
			{
				group: "shareLinks",
				kind: "share_links",
				count: 1,
				href: "/settings/report-share-links",
			},
		]);
	});

	it("lists nothing for a deactivation that ended nothing", () => {
		const nothing: DeactivationApplied = {
			managerLinks: { removedLinks: [], addedLinks: [], promotedLinks: [] },
			teamLinks: { teamIds: [], projectAssignmentProjectIds: [], projectManagerProjectIds: [] },
			approvalDuties: { handoverTaskIds: [], reviewIds: [] },
			shifts: { openedShiftIds: [] },
			absences: { cancelledAbsenceIds: [] },
			accessEnds: {
				grantIds: [],
				drivingAuthorizationIds: [],
				kioskBadgeIds: [],
				kioskFobIds: [],
				shareLinkIds: [],
			},
		};
		expect(
			buildReactivationChecklistItems({ employeeId: PERSON, applied: nothing, plan: plan() }),
		).toEqual([]);
	});

	it("still lists every applied item without the stored plan, unnamed", () => {
		const items = buildReactivationChecklistItems({
			employeeId: PERSON,
			applied: applied(),
			plan: null,
		});
		expect(items).toHaveLength(13);
		expect(items[0]).toMatchObject({ kind: "report_moved", name: null, newManagerName: null });
		expect(items[3]).toMatchObject({ kind: "grant", grant: null, href: "/settings" });
		expect(items[10]).toMatchObject({ kind: "shift", date: null, startTime: null });
		expect(items[11]).toMatchObject({ kind: "absence", categoryName: null, startDate: null });
	});

	it("keeps only the chosen replacements' names in the stored plan", () => {
		const snapshot = checklistPlanSnapshot(plan());
		expect(snapshot.managerLinks.replacementOptions).toEqual([
			{ employeeId: REPLACEMENT, name: "Anna Admin" },
		]);
		expect(snapshot.absences).toEqual(plan().absences);
	});
});
