/**
 * #858: assigned locations through the settings server actions and the
 * active-assignment query on PostgreSQL. Only the session is mocked.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
}));

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);

vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () =>
				harness.userId
					? {
							user: { id: harness.userId, role: "user" },
							session: {
								id: `t858-session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));

vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);

const actions = await import("@/app/[locale]/(app)/settings/locations/assigned-location-actions");
const { listActiveEmployeesAssignedToLocation, isEmployeeActivelyAssignedToLocation } =
	await import("./queries");

const NOW = parseInstant("2026-09-15T12:00:00Z");

describe("assigned locations on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

	let fixture: LifecycleDatabaseFixture;
	let organizationId: string;
	let otherOrganizationId: string;
	let owner: { userId: string; employeeId: string };
	let admin: SeededEmployee;
	let manager: SeededEmployee;
	let member: SeededEmployee;
	let foreignOwner: SeededEmployee;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		organizationId = fixture.organizationId;
		owner = { userId: fixture.ownerUserId, employeeId: fixture.ownerEmployeeId };
		admin = await fixture.seedEmployee({ role: "admin" });
		manager = await fixture.seedEmployee();
		await fixture.pool.query(`update employee set role = 'manager' where id = $1`, [
			manager.employeeId,
		]);
		await fixture.pool.query(
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, true, $3)`,
			[fixture.employeeId, manager.employeeId, owner.userId],
		);
		member = await fixture.seedEmployee();
		otherOrganizationId = await fixture.createOrganization();
		foreignOwner = await fixture.seedEmployee({
			organizationId: otherOrganizationId,
			role: "owner",
		});
	});

	afterAll(async () => {
		await fixture?.close();
	});

	beforeEach(async () => {
		await fixture.pool.query("delete from location where organization_id = any($1::text[])", [
			[organizationId, otherOrganizationId],
		]);
	});

	function actAs(userId: string, activeOrganizationId: string = organizationId) {
		harness.userId = userId;
		harness.organizationId = activeOrganizationId;
	}

	async function createLocation(
		name: string,
		input: { organizationId?: string; isActive?: boolean } = {},
	): Promise<string> {
		const id = randomUUID();
		await fixture.pool.query(
			`insert into location (id, organization_id, name, is_active, created_by, updated_at)
			 values ($1, $2, $3, $4, $5, now())`,
			[id, input.organizationId ?? organizationId, name, input.isActive ?? true, owner.userId],
		);
		return id;
	}

	async function assign(employeeId: string, locationId: string, asUser = owner.userId) {
		actAs(asUser);
		return actions.addAssignedLocationAction({ employeeId, locationId });
	}

	it("lets an admin assign an employee to several locations and remove them from either side", async () => {
		const store = await createLocation("Store");
		const warehouse = await createLocation("Warehouse");
		const employeeId = fixture.employeeId;

		expect(await assign(employeeId, store, admin.userId)).toMatchObject({ success: true });
		expect(await assign(employeeId, warehouse, admin.userId)).toMatchObject({ success: true });
		// Assigning again changes nothing.
		expect(await assign(employeeId, store, admin.userId)).toMatchObject({ success: true });

		actAs(admin.userId);
		const fromEmployee = await actions.getEmployeeAssignedLocationsAction({ employeeId });
		expect(fromEmployee.success && fromEmployee.data.assigned).toEqual([
			{ locationId: store, name: "Store", isActive: true },
			{ locationId: warehouse, name: "Warehouse", isActive: true },
		]);
		expect(fromEmployee.success && fromEmployee.data.available).toEqual([]);

		const fromLocation = await actions.getLocationAssignedEmployeesAction({ locationId: store });
		expect(fromLocation.success && fromLocation.data.assigned.map((row) => row.employeeId)).toEqual(
			[employeeId],
		);
		expect(
			fromLocation.success && fromLocation.data.available.map((row) => row.employeeId),
		).not.toContain(employeeId);

		// Removed from the location's settings.
		expect(
			await actions.removeAssignedLocationAction({ employeeId, locationId: store }),
		).toMatchObject({ success: true });
		// Removed from the employee's settings.
		expect(
			await actions.removeAssignedLocationAction({ employeeId, locationId: warehouse }),
		).toMatchObject({ success: true });

		const afterRemoval = await actions.getEmployeeAssignedLocationsAction({ employeeId });
		expect(afterRemoval.success && afterRemoval.data.assigned).toEqual([]);
		expect(afterRemoval.success && afterRemoval.data.available.map((row) => row.name)).toEqual([
			"Store",
			"Warehouse",
		]);
	});

	it("refuses managers and members, for reads and writes", async () => {
		const store = await createLocation("Store");
		expect(await assign(member.employeeId, store)).toMatchObject({ success: true });

		for (const userId of [manager.userId, member.userId]) {
			expect(await assign(fixture.employeeId, store, userId)).toMatchObject({
				success: false,
				code: "admin_only",
			});
			actAs(userId);
			expect(
				await actions.removeAssignedLocationAction({
					employeeId: member.employeeId,
					locationId: store,
				}),
			).toMatchObject({ success: false, code: "admin_only" });
			expect(
				await actions.getEmployeeAssignedLocationsAction({ employeeId: member.employeeId }),
			).toMatchObject({ success: false, code: "admin_only" });
			expect(await actions.getLocationAssignedEmployeesAction({ locationId: store })).toMatchObject(
				{ success: false, code: "admin_only" },
			);
		}

		const active = await listActiveEmployeesAssignedToLocation(db, {
			organizationId,
			locationId: store,
		});
		expect(active.map((row) => row.employeeId)).toEqual([member.employeeId]);
	});

	it("refuses cross-organization assignments, in the actions and in the database", async () => {
		const store = await createLocation("Store");
		const foreignStore = await createLocation("Foreign store", {
			organizationId: otherOrganizationId,
		});

		expect(await assign(fixture.employeeId, foreignStore)).toMatchObject({
			success: false,
			code: "location_not_found",
		});
		expect(await assign(foreignOwner.employeeId, store)).toMatchObject({
			success: false,
			code: "employee_not_found",
		});

		for (const row of [
			[organizationId, fixture.employeeId, foreignStore],
			[organizationId, foreignOwner.employeeId, store],
			[otherOrganizationId, fixture.employeeId, foreignStore],
		]) {
			await expect(
				fixture.pool.query(
					`insert into employee_assigned_location (organization_id, employee_id, location_id)
					 values ($1, $2, $3)`,
					row,
				),
			).rejects.toMatchObject({ code: "23503" });
		}
	});

	it("returns only active employees at active locations from the active-assignment query", async () => {
		const store = await createLocation("Store");
		const closed = await createLocation("Closed", { isActive: true });
		const present = await fixture.seedEmployee();
		const inactive = await fixture.seedEmployee();
		const departing = await fixture.seedEmployee();
		for (const employeeId of [present.employeeId, inactive.employeeId, departing.employeeId]) {
			expect(await assign(employeeId, store)).toMatchObject({ success: true });
		}
		expect(await assign(present.employeeId, closed)).toMatchObject({ success: true });

		await fixture.pool.query(`update employee set is_active = false where id = $1`, [
			inactive.employeeId,
		]);
		await fixture.pool.query(
			`insert into employee_departure
			 (organization_id, employee_id, employment_period_id, mode, last_working_day, timezone,
			  cutoff_at, created_by, request_id, request_fingerprint, revision, status)
			 values ($1, $2, $3, 'scheduled', '2026-09-14', 'UTC', '2026-09-15T00:00:00Z', $4,
			         gen_random_uuid(), 'test', 1, 'pending')`,
			[organizationId, departing.employeeId, departing.employmentPeriodId, owner.userId],
		);
		await fixture.pool.query(`update location set is_active = false where id = $1`, [closed]);

		const active = await listActiveEmployeesAssignedToLocation(db, {
			organizationId,
			locationId: store,
			now: NOW,
		});
		expect(active).toEqual([
			expect.objectContaining({ employeeId: present.employeeId, userId: present.userId }),
		]);
		expect(
			await listActiveEmployeesAssignedToLocation(db, {
				organizationId,
				locationId: closed,
				now: NOW,
			}),
		).toEqual([]);
		// The query is scoped to the organization asked for.
		expect(
			await listActiveEmployeesAssignedToLocation(db, {
				organizationId: otherOrganizationId,
				locationId: store,
				now: NOW,
			}),
		).toEqual([]);

		const isActive = (employeeId: string, locationId: string, org = organizationId) =>
			isEmployeeActivelyAssignedToLocation(db, {
				organizationId: org,
				employeeId,
				locationId,
				now: NOW,
			});
		expect(await isActive(present.employeeId, store)).toBe(true);
		expect(await isActive(present.employeeId, closed)).toBe(false);
		expect(await isActive(inactive.employeeId, store)).toBe(false);
		expect(await isActive(departing.employeeId, store)).toBe(false);
		expect(await isActive(member.employeeId, store)).toBe(false);
		expect(await isActive(present.employeeId, store, otherOrganizationId)).toBe(false);

		// Deactivation keeps the assignment: the settings still list it.
		actAs(owner.userId);
		const settings = await actions.getEmployeeAssignedLocationsAction({
			employeeId: present.employeeId,
		});
		expect(settings.success && settings.data.assigned).toEqual([
			{ locationId: closed, name: "Closed", isActive: false },
			{ locationId: store, name: "Store", isActive: true },
		]);
	});

	it("leaves location supervisors untouched", async () => {
		const store = await createLocation("Store");
		await fixture.pool.query(
			`insert into location_employee (location_id, employee_id, is_primary, created_by)
			 values ($1, $2, true, $3)`,
			[store, manager.employeeId, owner.userId],
		);

		expect(await assign(member.employeeId, store)).toMatchObject({ success: true });
		actAs(owner.userId);
		expect(
			await actions.removeAssignedLocationAction({
				employeeId: member.employeeId,
				locationId: store,
			}),
		).toMatchObject({ success: true });

		const supervisors = await fixture.pool.query(
			"select employee_id, is_primary from location_employee where location_id = $1",
			[store],
		);
		expect(supervisors.rows).toEqual([{ employee_id: manager.employeeId, is_primary: true }]);
		// A supervisor is not an assigned employee.
		expect(
			await isEmployeeActivelyAssignedToLocation(db, {
				organizationId,
				employeeId: manager.employeeId,
				locationId: store,
			}),
		).toBe(false);
	});
});
