/**
 * PostgreSQL contract for when a former employee left (#1439): the departure
 * cutoff, the deactivation instant the trigger keeps, or not recorded.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { readEmployeeLeftOn } from "./left-on";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "./testing/database.test.fixture";

// 13:00 UTC is already the next day in Auckland (UTC+12 in September).
const CUTOFF = "2026-09-14T13:00:00Z";
const AFTER = parseInstant("2026-09-20T00:00:00Z");

describe("when a former employee left", () => {
	let fixture: LifecycleDatabaseFixture;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		await fixture.pool.query(
			`update organization set timezone = 'Pacific/Auckland' where id = $1`,
			[fixture.organizationId],
		);
	});

	afterAll(async () => {
		await fixture?.close();
	});

	async function departure(
		target: SeededEmployee,
		status: "pending" | "effective",
		cutoff = CUTOFF,
	) {
		await fixture.pool.query(
			`insert into employee_departure
			 (organization_id, employee_id, employment_period_id, mode, last_working_day, timezone,
			  cutoff_at, created_by, request_id, request_fingerprint, revision, status, effective_at)
			 values ($1, $2, $3, 'scheduled', '2026-09-14', 'UTC', $4, $5, gen_random_uuid(), 'test', 1, $6,
			         case when $6 = 'effective' then $4::timestamptz end)`,
			[
				fixture.organizationId,
				target.employeeId,
				target.employmentPeriodId,
				cutoff,
				fixture.ownerUserId,
				status,
			],
		);
	}

	const leftOn = (target: SeededEmployee, now = AFTER) =>
		readEmployeeLeftOn(fixture.db, {
			organizationId: fixture.organizationId,
			employeeId: target.employeeId,
			now,
		});

	async function storedDeactivatedAt(target: SeededEmployee) {
		const { rows } = await fixture.pool.query<{ deactivated_at: Date | null }>(
			`select deactivated_at from employee where id = $1`,
			[target.employeeId],
		);
		return rows[0]?.deactivated_at ?? null;
	}

	it("reports a current employee as not former", async () => {
		const current = await fixture.seedEmployee();

		expect(await leftOn(current)).toEqual({ former: false });
	});

	it("dates an effective departure by its cutoff, in the organization's timezone", async () => {
		const departed = await fixture.seedEmployee({ isActive: false });
		await departure(departed, "effective");

		const result = await leftOn(departed);

		expect(result).toMatchObject({ former: true });
		if (!result?.former) throw new Error("expected a former employee");
		expect(result.leftAt?.toString()).toBe("2026-09-14T13:00:00Z");
		expect(result.leftOn?.toString()).toBe("2026-09-15");
	});

	it("dates a due departure that no worker has processed yet by its cutoff", async () => {
		const due = await fixture.seedEmployee();
		await departure(due, "pending");

		const result = await leftOn(due);
		if (!result?.former) throw new Error("expected a former employee");
		expect(result.leftAt?.toString()).toBe("2026-09-14T13:00:00Z");
		expect(await leftOn(due, parseInstant("2026-09-14T12:00:00Z"))).toEqual({ former: false });
	});

	it("stores the deactivation instant and clears it on reactivation", async () => {
		const target = await fixture.seedEmployee();

		await fixture.pool.query(`update employee set is_active = false where id = $1`, [
			target.employeeId,
		]);
		const stored = await storedDeactivatedAt(target);
		expect(stored).toBeInstanceOf(Date);
		const result = await leftOn(target);
		if (!result?.former) throw new Error("expected a former employee");
		expect(result.leftAt?.epochMilliseconds).toBe(stored?.getTime());

		await fixture.pool.query(`update employee set is_active = true where id = $1`, [
			target.employeeId,
		]);
		expect(await storedDeactivatedAt(target)).toBeNull();
		expect(await leftOn(target)).toEqual({ former: false });
	});

	it("keeps an instant the writer names itself", async () => {
		const target = await fixture.seedEmployee();

		await fixture.pool.query(
			`update employee set is_active = false, deactivated_at = $2 where id = $1`,
			[target.employeeId, CUTOFF],
		);

		expect((await storedDeactivatedAt(target))?.toISOString()).toBe("2026-09-14T13:00:00.000Z");
	});

	it("reports a deactivation after a rehire, not the old departure", async () => {
		const target = await fixture.seedEmployee({ isActive: false });
		await departure(target, "effective", "2026-03-01T00:00:00Z");
		// Rehired: a new open period and the employee switched on again.
		await fixture.pool.query(
			`update employee_employment_period set status = 'closed', ended_at = '2026-03-01T00:00:00Z' where id = $1`,
			[target.employmentPeriodId],
		);
		await fixture.pool.query(
			`insert into employee_employment_period
			 (id, organization_id, employee_id, status, started_at, start_provenance)
			 values ($1, $2, $3, 'open', '2026-06-01T00:00:00Z', 'recorded')`,
			[randomUUID(), fixture.organizationId, target.employeeId],
		);
		await fixture.pool.query(`update employee set is_active = true where id = $1`, [
			target.employeeId,
		]);
		expect(await leftOn(target)).toEqual({ former: false });

		await fixture.pool.query(
			`update employee set is_active = false, deactivated_at = '2026-09-18T08:00:00Z' where id = $1`,
			[target.employeeId],
		);

		const result = await leftOn(target);
		if (!result?.former) throw new Error("expected a former employee");
		expect(result.leftAt?.toString()).toBe("2026-09-18T08:00:00Z");
	});

	it("says not recorded for an employee deactivated before the instant was stored", async () => {
		const legacy = await fixture.seedEmployee({ isActive: false });

		expect(await leftOn(legacy)).toEqual({ former: true, leftAt: null, leftOn: null });
	});

	it("reads only the given organization", async () => {
		const otherOrganizationId = await fixture.createOrganization();
		const elsewhere = await fixture.seedEmployee({
			organizationId: otherOrganizationId,
			isActive: false,
		});

		expect(await leftOn(elsewhere)).toBeNull();
	});
});
