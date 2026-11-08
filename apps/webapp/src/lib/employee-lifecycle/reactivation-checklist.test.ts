import { describe, expect, it } from "vitest";
import { emptyEmploymentEndingPlan } from "@/components/organization/testing/deactivation-preview.test.fixture";
import type { DeactivationApplied, DeactivationPlan } from "./deactivation/types";
import { reactivationItems } from "./employment-ending";
import type { EmploymentEndingApplied } from "./employment-ending/types";
import {
	buildReactivationChecklistItems,
	type ChecklistApplied,
	checklistPlanSnapshot,
	legacyAccessEndsItems,
	type ReactivationChecklistItem,
} from "./reactivation-checklist";

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
		employmentEnding: emptyEmploymentEndingPlan(),
		retentionStarts: true,
		seatReleased: true,
		refusals: [],
	};
}

function rosterApplied(): ChecklistApplied {
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
		// The second shift was reassigned before the submit: it was not opened.
		shifts: { openedShiftIds: ["shift-1"] },
		absences: { cancelledAbsenceIds: ["absence-1"] },
	};
}

function endedEverything(): EmploymentEndingApplied {
	return {
		equipment: { revokedOfficerGrantIds: [PERSON] },
		drivingLicence: {
			endedAuthorizationIds: ["auth-b", "auth-c"],
			revokedVerifierGrantIds: ["grant-verifier"],
		},
		officerGrants: { grants: [{ kind: "expense_officer", grantId: "grant-expense" }] },
		documentRequests: { cancelledRequestIds: ["request-1", "request-2"] },
		kioskBadges: { revokedBadgeIds: ["badge-1"] },
		// Nothing to grant again: the employee registers a fob themselves at a kiosk.
		kioskFobs: { endedFobIds: ["fob-1"] },
		reportShareLinks: { revokedLinkIds: ["link-1"] },
		// Nothing to grant again: the absence names a new deputy.
		deputyAssignments: {
			eventKey: "employee_deactivated:1",
			assignments: [
				{
					absenceId: "absence-9",
					absentEmployeeId: KEEPS,
					startDate: "2026-11-02",
					endDate: "2026-11-03",
				},
			],
		},
	};
}

const holding: ReactivationChecklistItem = {
	group: "shareLinks",
	kind: "share_links",
	count: 1,
	href: "/settings/report-share-links",
};

describe("reactivation checklist", () => {
	it("lists exactly what the roster areas applied, each with the page it is granted again on, with Employment ending's items after the managers", () => {
		expect(
			buildReactivationChecklistItems({
				employeeId: PERSON,
				applied: rosterApplied(),
				plan: plan(),
				holdings: [holding],
			}),
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
			holding,
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
		]);
	});

	it("lists what Employment ending ended, from each participant, in participant order", () => {
		expect(reactivationItems(endedEverything(), { employeeId: PERSON })).toEqual([
			{
				group: "grants",
				kind: "grant",
				grant: "equipment_officer",
				href: "/settings/equipment",
			},
			{
				group: "grants",
				kind: "grant",
				grant: "driving_licence_verifier",
				href: "/settings/driving-licence?tab=verifiers",
			},
			{
				group: "access",
				kind: "driving_authorizations",
				count: 2,
				href: `/driving-licence/checks/${PERSON}`,
			},
			{
				group: "grants",
				kind: "grant",
				grant: "expense_officer",
				href: "/settings/travel-expenses?tab=access",
			},
			{
				group: "documentRequests",
				kind: "document_requests",
				count: 2,
				href: `/personnel-files/${PERSON}`,
			},
			{
				group: "access",
				kind: "kiosk_badges",
				count: 1,
				href: `/settings/employees/${PERSON}`,
			},
			{
				group: "shareLinks",
				kind: "share_links",
				count: 1,
				href: "/settings/report-share-links",
			},
		]);
	});

	it("lists what a deactivation stored before Employment ending ended, named from its plan's grants", () => {
		const accessEnds = {
			grantIds: ["grant-expense", "grant-verifier", "grant-unknown"],
			drivingAuthorizationIds: ["auth-b", "auth-c"],
			kioskBadgeIds: ["badge-1"],
			kioskFobIds: ["fob-1"],
			shareLinkIds: ["link-1"],
		};
		const plannedGrants = [
			{ kind: "expense_officer" as const, grantId: "grant-expense" },
			{ kind: "driving_licence_verifier" as const, grantId: "grant-verifier" },
		];

		expect(legacyAccessEndsItems({ employeeId: PERSON, accessEnds, plannedGrants })).toEqual([
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
			{ group: "grants", kind: "grant", grant: null, href: "/settings" },
			{ group: "access", kind: "kiosk_badges", count: 1, href: `/settings/employees/${PERSON}` },
			{
				group: "access",
				kind: "driving_authorizations",
				count: 2,
				href: `/driving-licence/checks/${PERSON}`,
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
			employmentEnding: {
				equipment: { revokedOfficerGrantIds: [] },
				drivingLicence: { endedAuthorizationIds: [], revokedVerifierGrantIds: [] },
				officerGrants: { grants: [] },
				documentRequests: { cancelledRequestIds: [] },
				kioskBadges: { revokedBadgeIds: [] },
				kioskFobs: { endedFobIds: [] },
				reportShareLinks: { revokedLinkIds: [] },
				deputyAssignments: { eventKey: "employee_deactivated:1", assignments: [] },
			},
		};
		expect(
			buildReactivationChecklistItems({
				employeeId: PERSON,
				applied: nothing,
				plan: plan(),
				holdings: reactivationItems(nothing.employmentEnding, { employeeId: PERSON }),
			}),
		).toEqual([]);
	});

	it("still lists every applied item without the stored plan, unnamed", () => {
		const items = buildReactivationChecklistItems({
			employeeId: PERSON,
			applied: rosterApplied(),
			plan: null,
			holdings: [],
		});
		expect(items).toHaveLength(8);
		expect(items[0]).toMatchObject({ kind: "report_moved", name: null, newManagerName: null });
		expect(items[6]).toMatchObject({ kind: "shift", date: null, startTime: null });
		expect(items[7]).toMatchObject({ kind: "absence", categoryName: null, startDate: null });
	});

	it("keeps only the chosen replacements' names in the stored plan", () => {
		const snapshot = checklistPlanSnapshot(plan());
		expect(snapshot.managerLinks.replacementOptions).toEqual([
			{ employeeId: REPLACEMENT, name: "Anna Admin" },
		]);
		expect(snapshot.absences).toEqual(plan().absences);
	});
});
