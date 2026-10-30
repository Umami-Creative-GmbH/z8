/**
 * PostgreSQL contract (#1438, Organization ADR 0006): manager notices skip
 * former managers; an actionable one whose every manager is former reaches the
 * organization's current admins, an informational one nobody.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { currentRosterManagerRecipients } from "./manager-notice-recipients";

describe("manager notice recipients", () => {
	let fixture: LifecycleDatabaseFixture;
	let deactivatedManager: SeededEmployee;
	let departedManager: SeededEmployee;
	let currentManager: SeededEmployee;
	/** Managed only by former managers. */
	let orphaned: SeededEmployee;
	/** Managed by a current and a former manager. */
	let managed: SeededEmployee;
	/** Primary manager former, secondary current. */
	let primaryFormer: SeededEmployee;
	let unmanaged: SeededEmployee;
	let otherOrganizationId: string;
	let otherAdmin: SeededEmployee;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		deactivatedManager = await fixture.seedEmployee({ isActive: false });
		departedManager = await fixture.seedEmployee();
		await dueDeparture(fixture.organizationId, departedManager);
		currentManager = await fixture.seedEmployee();
		orphaned = await fixture.seedEmployee();
		managed = await fixture.seedEmployee();
		primaryFormer = await fixture.seedEmployee();
		unmanaged = await fixture.seedEmployee();
		await link(orphaned, deactivatedManager, true);
		await link(orphaned, departedManager, false);
		await link(managed, currentManager, true);
		await link(managed, deactivatedManager, false);
		await link(primaryFormer, departedManager, true);
		await link(primaryFormer, currentManager, false);
		// Former admins never stand in.
		await fixture.seedEmployee({ role: "admin", isActive: false });
		const departedAdmin = await fixture.seedEmployee({ role: "admin" });
		await dueDeparture(fixture.organizationId, departedAdmin);
		// Nor do another organization's admins.
		otherOrganizationId = await fixture.createOrganization();
		otherAdmin = await fixture.seedEmployee({ organizationId: otherOrganizationId, role: "admin" });
	});

	afterAll(async () => {
		await fixture?.close();
	});

	async function link(report: SeededEmployee, manager: SeededEmployee, isPrimary: boolean) {
		await fixture.pool.query(
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, $3, $4)`,
			[report.employeeId, manager.employeeId, isPrimary, fixture.ownerUserId],
		);
	}

	/** A pending departure past its cutoff: a former employee before the worker runs. */
	async function dueDeparture(organizationId: string, target: SeededEmployee) {
		await fixture.pool.query(
			`insert into employee_departure
			 (organization_id, employee_id, employment_period_id, mode, last_working_day, timezone,
			  cutoff_at, created_by, request_id, request_fingerprint, revision, status)
			 values ($1, $2, $3, 'scheduled', '2026-09-14', 'UTC', '2026-09-15T00:00:00Z', $4,
			         gen_random_uuid(), 'test', 1, 'pending')`,
			[organizationId, target.employeeId, target.employmentPeriodId, fixture.ownerUserId],
		);
	}

	const recipients = (
		employee: SeededEmployee,
		notice: "actionable" | "informational",
		options: { primaryOnly?: boolean; excludeUserIds?: string[]; organizationId?: string } = {},
	) =>
		currentRosterManagerRecipients(fixture.db, {
			organizationId: options.organizationId ?? fixture.organizationId,
			employeeIds: [employee.employeeId],
			notice,
			primaryOnly: options.primaryOnly,
			excludeUserIds: options.excludeUserIds,
		});

	it("skips former managers and keeps current ones, whatever the notice", async () => {
		for (const notice of ["actionable", "informational"] as const) {
			await expect(recipients(managed, notice)).resolves.toEqual({
				userIds: [currentManager.userId],
				reason: "managers",
			});
		}
	});

	it("drops an informational notice whose every manager is former", async () => {
		await expect(recipients(orphaned, "informational")).resolves.toEqual({
			userIds: [],
			reason: "none",
		});
	});

	it("sends an actionable notice whose every manager is former to the current admins only", async () => {
		await expect(recipients(orphaned, "actionable")).resolves.toEqual({
			userIds: [fixture.ownerUserId],
			reason: "organization_admins",
		});
		await expect(
			recipients(orphaned, "actionable", { excludeUserIds: [fixture.ownerUserId] }),
		).resolves.toEqual({ userIds: [], reason: "none" });
	});

	it("reads only the primary manager when asked, with the same fallback", async () => {
		await expect(recipients(primaryFormer, "actionable", { primaryOnly: true })).resolves.toEqual({
			userIds: [fixture.ownerUserId],
			reason: "organization_admins",
		});
		await expect(recipients(primaryFormer, "actionable")).resolves.toEqual({
			userIds: [currentManager.userId],
			reason: "managers",
		});
	});

	it("keeps an employee without managers unaddressed, and stays in the organization", async () => {
		await expect(recipients(unmanaged, "actionable")).resolves.toEqual({
			userIds: [],
			reason: "none",
		});
		const elsewhere = await recipients(orphaned, "actionable", {
			organizationId: otherOrganizationId,
		});
		expect(elsewhere).toEqual({ userIds: [], reason: "none" });
		expect(elsewhere.userIds).not.toContain(otherAdmin.userId);
	});
});
