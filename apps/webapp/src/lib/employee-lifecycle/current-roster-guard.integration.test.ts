/**
 * PostgreSQL contract for the role-save guard over the current-roster rule
 * (#1438, Organization ADR 0006).
 */
import { randomUUID } from "node:crypto";
import { Effect, Exit } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { ValidationError } from "@/lib/effect/errors";
import { makeDatabaseService } from "@/lib/effect/services/database.service";
import {
	assertOnCurrentRoster,
	ensureOnCurrentRoster,
	FORMER_EMPLOYEE_REFUSAL,
	findEmployeesNotOnCurrentRoster,
	type RosterGuardClient,
} from "./current-roster-guard";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "./testing/database.test.fixture";

const CUTOFF = "2026-09-15T00:00:00Z";
const AFTER = parseInstant("2026-09-15T00:01:00Z");

describe("current-roster guard", () => {
	let fixture: LifecycleDatabaseFixture;
	let active: SeededEmployee;
	let secondActive: SeededEmployee;
	let deactivated: SeededEmployee;
	let due: SeededEmployee;
	let otherOrganizationEmployee: SeededEmployee;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		active = await fixture.seedEmployee();
		secondActive = await fixture.seedEmployee();
		deactivated = await fixture.seedEmployee({ isActive: false });
		due = await fixture.seedEmployee();
		await fixture.pool.query(
			`insert into employee_departure
			 (organization_id, employee_id, employment_period_id, mode, last_working_day, timezone,
			  cutoff_at, created_by, request_id, request_fingerprint, revision, status)
			 values ($1, $2, $3, 'scheduled', '2026-09-14', 'UTC', $4, $5, gen_random_uuid(), 'test', 1, 'pending')`,
			[fixture.organizationId, due.employeeId, due.employmentPeriodId, CUTOFF, fixture.ownerUserId],
		);
		const otherOrganizationId = await fixture.createOrganization();
		otherOrganizationEmployee = await fixture.seedEmployee({ organizationId: otherOrganizationId });
	});

	afterAll(async () => {
		await fixture?.close();
	});

	function countingClient(): { client: RosterGuardClient; selects: () => number } {
		let count = 0;
		const client: RosterGuardClient = {
			select: ((...args: Parameters<RosterGuardClient["select"]>) => {
				count += 1;
				return fixture.db.select(...args);
			}) as RosterGuardClient["select"],
		};
		return { client, selects: () => count };
	}

	it("accepts employees on the current roster", async () => {
		const refused = await findEmployeesNotOnCurrentRoster(fixture.db, {
			organizationId: fixture.organizationId,
			employeeIds: [active.employeeId, secondActive.employeeId],
			now: AFTER,
		});
		expect(refused).toEqual([]);
	});

	it("refuses a deactivated employee, a due departure and another organization's employee", async () => {
		const refused = await findEmployeesNotOnCurrentRoster(fixture.db, {
			organizationId: fixture.organizationId,
			employeeIds: [
				active.employeeId,
				deactivated.employeeId,
				due.employeeId,
				otherOrganizationEmployee.employeeId,
			],
			now: AFTER,
		});
		expect(refused.toSorted()).toEqual(
			[deactivated.employeeId, due.employeeId, otherOrganizationEmployee.employeeId].toSorted(),
		);
	});

	it("refuses unknown and malformed ids without failing the query", async () => {
		const unknown = randomUUID();
		const refused = await findEmployeesNotOnCurrentRoster(fixture.db, {
			organizationId: fixture.organizationId,
			employeeIds: [unknown, "not-a-uuid", active.employeeId],
			now: AFTER,
		});
		expect(refused).toEqual([unknown, "not-a-uuid"]);
	});

	it("checks many employees with one query and none for an empty list", async () => {
		const counted = countingClient();
		await findEmployeesNotOnCurrentRoster(counted.client, {
			organizationId: fixture.organizationId,
			employeeIds: [
				active.employeeId,
				secondActive.employeeId,
				deactivated.employeeId,
				due.employeeId,
				otherOrganizationEmployee.employeeId,
			],
			now: AFTER,
		});
		expect(counted.selects()).toBe(1);

		const empty = countingClient();
		await findEmployeesNotOnCurrentRoster(empty.client, {
			organizationId: fixture.organizationId,
			employeeIds: [null, undefined, ""],
		});
		expect(empty.selects()).toBe(0);
	});

	it("throws a ValidationError naming the field from the Promise variant", async () => {
		const error = await assertOnCurrentRoster(fixture.db, {
			organizationId: fixture.organizationId,
			employeeIds: [active.employeeId, deactivated.employeeId],
			field: "employeeIds",
			now: AFTER,
		}).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(ValidationError);
		expect(error).toMatchObject({
			field: "employeeIds",
			value: [deactivated.employeeId],
			refusal: FORMER_EMPLOYEE_REFUSAL,
		});
		await expect(
			assertOnCurrentRoster(fixture.db, {
				organizationId: fixture.organizationId,
				employeeIds: [active.employeeId],
				field: "employeeIds",
				now: AFTER,
			}),
		).resolves.toBeUndefined();
	});

	it("fails with a ValidationError from the Effect variant", async () => {
		const dbService = makeDatabaseService(fixture.db as never);
		const refusal = await Effect.runPromise(
			Effect.flip(
				ensureOnCurrentRoster(dbService, {
					organizationId: fixture.organizationId,
					employeeIds: [due.employeeId],
					field: "managerId",
					message: "Pick a current manager",
					now: AFTER,
				}),
			),
		);
		expect(refusal).toBeInstanceOf(ValidationError);
		expect(refusal).toMatchObject({
			message: "Pick a current manager",
			field: "managerId",
			value: [due.employeeId],
		});

		const accepted = await Effect.runPromiseExit(
			ensureOnCurrentRoster(dbService, {
				organizationId: fixture.organizationId,
				employeeIds: [active.employeeId],
				field: "managerId",
				now: AFTER,
			}),
		);
		expect(Exit.isSuccess(accepted)).toBe(true);
	});
});
