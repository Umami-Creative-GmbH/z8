/**
 * PostgreSQL contract (#692): a manager link stays inside one organization.
 * The runner owns, migrates, and removes the disposable database.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

/** The migration's first statement: the one-off removal of cross-organization links. */
function repairStatement() {
	const migration = readFileSync(
		join(process.cwd(), "drizzle", "0134_employee_manager_same_organization.sql"),
		"utf8",
	);
	const [statement] = migration.split("--> statement-breakpoint");
	if (!statement?.includes('DELETE FROM "employee_managers"')) {
		throw new Error("0134 no longer starts with the cross-organization repair");
	}
	return statement;
}

describe("employee_managers organization guard", () => {
	let fixture: LifecycleDatabaseFixture;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	function insertLink(employeeId: string, managerId: string) {
		return fixture.pool.query<{ id: string }>(
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, true, $3)
			 returning id`,
			[employeeId, managerId, fixture.ownerUserId],
		);
	}

	it("accepts a manager from the employee's organization", async () => {
		const manager = await fixture.seedEmployee();

		await expect(insertLink(fixture.employeeId, manager.employeeId)).resolves.toMatchObject({
			rowCount: 1,
		});
	});

	it("rejects a manager from another organization", async () => {
		const foreignOrganizationId = await fixture.createOrganization();
		const foreignManager = await fixture.seedEmployee({ organizationId: foreignOrganizationId });
		const employee = await fixture.seedEmployee();

		await expect(insertLink(employee.employeeId, foreignManager.employeeId)).rejects.toMatchObject({
			code: "23514",
		});
	});

	it("rejects moving an existing link to a manager in another organization", async () => {
		const foreignOrganizationId = await fixture.createOrganization();
		const foreignManager = await fixture.seedEmployee({ organizationId: foreignOrganizationId });
		const employee = await fixture.seedEmployee();
		const manager = await fixture.seedEmployee();
		const link = await insertLink(employee.employeeId, manager.employeeId);

		await expect(
			fixture.pool.query("update employee_managers set manager_id = $2 where id = $1", [
				link.rows[0]?.id,
				foreignManager.employeeId,
			]),
		).rejects.toMatchObject({ code: "23514" });
	});

	it("rejects moving an existing link to an employee in another organization", async () => {
		const foreignOrganizationId = await fixture.createOrganization();
		const foreignEmployee = await fixture.seedEmployee({ organizationId: foreignOrganizationId });
		const employee = await fixture.seedEmployee();
		const manager = await fixture.seedEmployee();
		const link = await insertLink(employee.employeeId, manager.employeeId);

		await expect(
			fixture.pool.query("update employee_managers set employee_id = $2 where id = $1", [
				link.rows[0]?.id,
				foreignEmployee.employeeId,
			]),
		).rejects.toMatchObject({ code: "23514" });
	});

	it("repairs existing cross-organization links and keeps same-organization ones", async () => {
		const foreignOrganizationId = await fixture.createOrganization();
		const foreignManager = await fixture.seedEmployee({ organizationId: foreignOrganizationId });
		const employee = await fixture.seedEmployee();
		const manager = await fixture.seedEmployee();
		const kept = await insertLink(employee.employeeId, manager.employeeId);
		const client = await fixture.pool.connect();
		let planted: string | undefined;
		try {
			// Plant a pre-guard row the way the old demo writer left it.
			await client.query("begin");
			await client.query(
				"alter table employee_managers disable trigger employee_managers_guard_same_organization_trigger",
			);
			const row = await client.query<{ id: string }>(
				`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
				 values ($1, $2, false, $3) returning id`,
				[employee.employeeId, foreignManager.employeeId, fixture.ownerUserId],
			);
			planted = row.rows[0]?.id;
			await client.query(
				"alter table employee_managers enable trigger employee_managers_guard_same_organization_trigger",
			);
			await client.query("commit");
		} finally {
			client.release();
		}

		await fixture.pool.query(repairStatement());

		const remaining = await fixture.pool.query<{ id: string }>(
			"select id from employee_managers where employee_id = $1 order by id",
			[employee.employeeId],
		);
		expect(planted).toBeDefined();
		expect(remaining.rows.map((row) => row.id)).toEqual([kept.rows[0]?.id]);
	});

	it("rejects moving a linked employee to another organization", async () => {
		const foreignOrganizationId = await fixture.createOrganization();
		// Without periods no composite foreign key pins the employees' organization.
		const employee = await fixture.seedEmployee({ withPeriod: false });
		const manager = await fixture.seedEmployee({ withPeriod: false });
		await insertLink(employee.employeeId, manager.employeeId);

		await expect(
			fixture.pool.query("update employee set organization_id = $2 where id = $1", [
				manager.employeeId,
				foreignOrganizationId,
			]),
		).rejects.toMatchObject({ code: "23514" });
	});

	it("still lets an unlinked employee change organization", async () => {
		const foreignOrganizationId = await fixture.createOrganization();
		const employee = await fixture.seedEmployee({ withPeriod: false });

		await expect(
			fixture.pool.query("update employee set organization_id = $2 where id = $1", [
				employee.employeeId,
				foreignOrganizationId,
			]),
		).resolves.toMatchObject({ rowCount: 1 });
	});
});
