/**
 * The reactivation checklist reads the ledger's jsonb columns (#1441, #1624):
 * what Employment ending stored per participant, or the `accessEnds` of a
 * deactivation stored before it, validated before any item is built.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadReactivationChecklist } from "./reactivation-checklist-store";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "./testing/database.test.fixture";

let fixture: LifecycleDatabaseFixture;

beforeAll(async () => {
	fixture = await createLifecycleDatabaseFixture();
});

afterAll(async () => {
	await fixture?.close();
});

const rosterAreasEnded = {
	managerLinks: { removedLinks: [], addedLinks: [], promotedLinks: [] },
	teamLinks: { teamIds: [], projectAssignmentProjectIds: [], projectManagerProjectIds: [] },
	approvalDuties: { handoverTaskIds: [], reviewIds: [] },
	shifts: { openedShiftIds: [] },
	absences: { cancelledAbsenceIds: [] },
};

/** A reactivated deactivation of the employee whose ledger row stored `ended`. */
async function reactivatedDeactivation(
	person: SeededEmployee,
	ended: Record<string, unknown>,
	plan: Record<string, unknown> | null = null,
) {
	await fixture.pool.query(
		`insert into employee_deactivation
		 (organization_id, employee_id, deactivated_at, created_by, reason, status, request_id,
			request_fingerprint, applied, plan, reactivated_at, reactivated_by)
		 values ($1, $2, '2026-09-01T08:00:00Z', $3, 'employee_deactivated', 'applied', $4, 'fingerprint',
			$5, $6, '2026-09-10T08:00:00Z', $3)`,
		[
			fixture.organizationId,
			person.employeeId,
			fixture.ownerUserId,
			randomUUID(),
			JSON.stringify({ ...rosterAreasEnded, ...ended }),
			plan === null ? null : JSON.stringify(plan),
		],
	);
}

function checklist(person: SeededEmployee) {
	return loadReactivationChecklist(fixture.db, {
		organizationId: fixture.organizationId,
		employeeId: person.employeeId,
	});
}

describe("loadReactivationChecklist", () => {
	it("lists what Employment ending stored, per participant", async () => {
		const person = await fixture.seedEmployee();
		await reactivatedDeactivation(person, {
			employmentEnding: {
				officerGrants: { grants: [{ kind: "payroll_access", grantId: randomUUID() }] },
				reportShareLinks: { revokedLinkIds: [randomUUID()] },
			},
		});

		expect((await checklist(person))?.items).toEqual([
			{ group: "grants", kind: "grant", grant: "payroll_access", href: "/settings/payroll-access" },
			{
				group: "shareLinks",
				kind: "share_links",
				count: 1,
				href: "/settings/report-share-links",
			},
		]);
	});

	it("shows no checklist for a stored ending it cannot read, instead of failing", async () => {
		const person = await fixture.seedEmployee();
		await reactivatedDeactivation(person, {
			employmentEnding: { officerGrants: { grants: "not a list" } },
		});

		await expect(checklist(person)).resolves.toBeNull();
	});

	it("still lists what a deactivation stored before Employment ending ended", async () => {
		const person = await fixture.seedEmployee();
		const grantId = randomUUID();
		await reactivatedDeactivation(
			person,
			{
				accessEnds: {
					grantIds: [grantId],
					drivingAuthorizationIds: [],
					kioskBadgeIds: [randomUUID()],
					shareLinkIds: [],
				},
			},
			{ accessEnds: { grants: [{ kind: "expense_officer", grantId }] } },
		);

		expect((await checklist(person))?.items).toEqual([
			{
				group: "grants",
				kind: "grant",
				grant: "expense_officer",
				href: "/settings/travel-expenses?tab=access",
			},
			{
				group: "access",
				kind: "kiosk_badges",
				count: 1,
				href: `/settings/employees/${person.employeeId}`,
			},
		]);
	});
});
