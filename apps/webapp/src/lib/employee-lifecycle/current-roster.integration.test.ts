/**
 * PostgreSQL contract for the current-roster rule (#1438, Organization ADR 0006).
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { employee, employeeManagers } from "@/db/schema";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { isFormerEmployee, onCurrentRoster } from "./current-roster";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "./testing/database.test.fixture";

const CUTOFF = "2026-09-15T00:00:00Z";
const BEFORE = parseInstant("2026-09-14T23:59:00Z");
const AFTER = parseInstant("2026-09-15T00:01:00Z");

describe("current roster", () => {
	let fixture: LifecycleDatabaseFixture;
	let active: SeededEmployee;
	let deactivated: SeededEmployee;
	let due: SeededEmployee;
	let departed: SeededEmployee;
	let rehired: SeededEmployee;
	let otherOrganizationId: string;
	let otherOrganizationEmployee: SeededEmployee;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		active = await fixture.seedEmployee();
		deactivated = await fixture.seedEmployee({ isActive: false });
		due = await fixture.seedEmployee();
		await departure(due, { status: "pending", mode: "scheduled" });
		departed = await fixture.seedEmployee({ isActive: false });
		await departure(departed, { status: "effective", mode: "immediate" });
		rehired = await fixture.seedEmployee();
		await departure(rehired, { status: "effective", mode: "immediate" });
		await fixture.pool.query(
			`update employee_employment_period set status = 'closed', ended_at = $2 where id = $1`,
			[rehired.employmentPeriodId, CUTOFF],
		);
		await fixture.pool.query(
			`insert into employee_employment_period
			 (id, organization_id, employee_id, status, started_at, start_provenance)
			 values ($1, $2, $3, 'open', '2026-10-01T00:00:00Z', 'recorded')`,
			[randomUUID(), fixture.organizationId, rehired.employeeId],
		);
		otherOrganizationId = await fixture.createOrganization();
		otherOrganizationEmployee = await fixture.seedEmployee({ organizationId: otherOrganizationId });
	});

	afterAll(async () => {
		await fixture?.close();
	});

	async function departure(
		target: SeededEmployee,
		input: { status: "pending" | "effective"; mode: "scheduled" | "immediate" },
	) {
		await fixture.pool.query(
			`insert into employee_departure
			 (organization_id, employee_id, employment_period_id, mode, last_working_day, timezone,
			  cutoff_at, created_by, request_id, request_fingerprint, revision, status, effective_at)
			 values ($1, $2, $3, $4, '2026-09-14', 'UTC', $5, $6, gen_random_uuid(), 'test', 1, $7,
			         case when $7 = 'effective' then $5::timestamptz end)`,
			[
				fixture.organizationId,
				target.employeeId,
				target.employmentPeriodId,
				input.mode,
				CUTOFF,
				fixture.ownerUserId,
				input.status,
			],
		);
	}

	const seeded = () =>
		[active, deactivated, due, departed, rehired, otherOrganizationEmployee].map(
			(entry) => entry.employeeId,
		);

	async function rosterAt(now: typeof AFTER, organizationId = fixture.organizationId) {
		const rows = await fixture.db
			.select({ id: employee.id })
			.from(employee)
			.where(and(inArray(employee.id, seeded()), onCurrentRoster(organizationId, employee, now)));
		return rows.map((row) => row.id).toSorted();
	}

	it("keeps active and rehired employees and drops every former employee", async () => {
		expect(await rosterAt(AFTER)).toEqual([active.employeeId, rehired.employeeId].toSorted());
	});

	it("keeps an employee with a scheduled departure until its cutoff", async () => {
		expect(await rosterAt(BEFORE)).toEqual(
			[active.employeeId, due.employeeId, rehired.employeeId].toSorted(),
		);
	});

	it("is scoped to the organization", async () => {
		expect(await rosterAt(AFTER, otherOrganizationId)).toEqual([
			otherOrganizationEmployee.employeeId,
		]);
	});

	it("judges the same person separately in each organization", async () => {
		// The deactivated employee's user also works in the other organization.
		const elsewhere = randomUUID();
		await fixture.pool.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 values (gen_random_uuid(), $1, $2, 'member', 'approved', now())`,
			[otherOrganizationId, deactivated.userId],
		);
		await fixture.pool.query(
			`insert into employee (id, user_id, organization_id, is_active, updated_at)
			 values ($1, $2, $3, true, now())`,
			[elsewhere, deactivated.userId, otherOrganizationId],
		);

		const rosterOfUser = async (organizationId: string) =>
			(
				await fixture.db
					.select({ id: employee.id })
					.from(employee)
					.where(
						and(eq(employee.userId, deactivated.userId), onCurrentRoster(organizationId, employee, AFTER)),
					)
			).map((row) => row.id);

		expect(await rosterOfUser(fixture.organizationId)).toEqual([]);
		expect(await rosterOfUser(otherOrganizationId)).toEqual([elsewhere]);
	});

	it("marks former employees for views of the past", async () => {
		const rows = await fixture.db
			.select({ id: employee.id, former: isFormerEmployee(employee, AFTER) })
			.from(employee)
			.where(and(inArray(employee.id, seeded()), eq(employee.organizationId, fixture.organizationId)))
			.orderBy(asc(employee.id));
		const former = new Map(rows.map((row) => [row.id, row.former]));

		expect(former.get(active.employeeId)).toBe(false);
		expect(former.get(rehired.employeeId)).toBe(false);
		expect(former.get(deactivated.employeeId)).toBe(true);
		expect(former.get(due.employeeId)).toBe(true);
		expect(former.get(departed.employeeId)).toBe(true);
	});

	it("works on an aliased employee table in a join", async () => {
		const report = alias(employee, "report");
		const manager = await fixture.seedEmployee();
		for (const target of [active, deactivated, due]) {
			await fixture.pool.query(
				`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
				 values ($1, $2, true, $3)`,
				[target.employeeId, manager.employeeId, fixture.ownerUserId],
			);
		}

		const rows = await fixture.db
			.select({ id: report.id })
			.from(employeeManagers)
			.innerJoin(employee, eq(employee.id, employeeManagers.managerId))
			.innerJoin(report, eq(report.id, employeeManagers.employeeId))
			.where(
				and(
					eq(employeeManagers.managerId, manager.employeeId),
					onCurrentRoster(fixture.organizationId, employee, AFTER),
					onCurrentRoster(fixture.organizationId, report, AFTER),
				),
			);

		expect(rows).toEqual([{ id: active.employeeId }]);
	});

	it("works inside relational findMany queries", async () => {
		const found = await fixture.db.query.employee.findMany({
			where: and(inArray(employee.id, seeded()), onCurrentRoster(fixture.organizationId, employee, AFTER)),
			columns: { id: true },
		});

		expect(found.map((row) => row.id).toSorted()).toEqual(
			[active.employeeId, rehired.employeeId].toSorted(),
		);
	});
});
