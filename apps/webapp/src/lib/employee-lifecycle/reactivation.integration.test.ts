/**
 * #1643 (Organization ADR 0011): coming back after a deactivation is one call.
 * `reactivateOnReturn` switches the employee on, decides whether the return is
 * a reactivation, does the ledger work and records `employee.reactivated` in
 * the caller's transaction. The ways back that call it are covered by
 * reactivation-paths.integration.test.ts and the SCIM protocol suite.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const { AuditTrail } = await import("@/lib/audit-trail");
const { parseInstant } = await import("@/lib/datetime/temporal-core");
const { recordFollowUpDeactivation } = await import("./deactivation/follow-up-record");
const { loadLifecycleHistory } = await import("./lifecycle-history");
const { reactivateOnReturn } = await import("./reactivation");
const { insertDeactivation } = await import("./receipts");
const { createLifecycleDatabaseFixture } = await import("./testing/database.test.fixture");
type LifecycleDatabaseFixture = import("./testing/database.test.fixture").LifecycleDatabaseFixture;
type SeededEmployee = import("./testing/database.test.fixture").SeededEmployee;

const DEACTIVATED_AT = "2026-01-05T08:00:00Z";

describe("reactivateOnReturn (#1643)", () => {
	let fixture: LifecycleDatabaseFixture;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});
	afterAll(async () => fixture?.close());

	/** Someone an admin deactivated at `DEACTIVATED_AT`. */
	async function deactivatedPerson() {
		const person = await fixture.seedEmployee();
		await fixture.pool.query("update employee set is_active = false where id = $1", [
			person.employeeId,
		]);
		const { id: deactivationId } = await insertDeactivation(fixture.db, {
			organizationId: fixture.organizationId,
			employeeId: person.employeeId,
			employmentPeriodId: person.employmentPeriodId,
			deactivatedAt: parseInstant(DEACTIVATED_AT),
			createdBy: fixture.ownerUserId,
			reason: "employee_deactivated",
			requestId: randomUUID(),
			requestFingerprint: "test",
			replacementManagers: {},
		});
		return { ...person, deactivationId };
	}

	function comeBack(
		person: SeededEmployee,
		options: { metadata?: Record<string, unknown>; thenFail?: boolean } = {},
	) {
		return fixture.db.transaction(async (tx) => {
			const outcome = await reactivateOnReturn(
				tx,
				{
					organizationId: fixture.organizationId,
					employeeId: person.employeeId,
					actorUserId: person.userId,
					metadata: options.metadata,
				},
				new AuditTrail(),
			);
			if (options.thenFail) throw new Error("the way back failed after the reactivation");
			return outcome;
		});
	}

	async function employeeState(person: SeededEmployee) {
		const { rows } = await fixture.pool.query(
			"select is_active, deactivated_at from employee where id = $1",
			[person.employeeId],
		);
		return rows[0];
	}

	async function ledger(person: SeededEmployee) {
		const { rows } = await fixture.pool.query(
			`select id, status, reactivated_at, reactivated_by, reactivation_request_id
			 from employee_deactivation where organization_id = $1 and employee_id = $2`,
			[fixture.organizationId, person.employeeId],
		);
		return rows;
	}

	async function reactivatedAuditEntries(person: SeededEmployee) {
		const { rows } = await fixture.pool.query(
			`select performed_by, employee_id, changes, metadata from audit_log
			 where organization_id = $1 and entity_id = $2 and action = 'employee.reactivated'`,
			[fixture.organizationId, person.employeeId],
		);
		return rows.map((row) => ({
			performedBy: row.performed_by,
			employeeId: row.employee_id,
			changes: JSON.parse(row.changes),
			metadata: JSON.parse(row.metadata),
		}));
	}

	it("switches a deactivated employee on and reactivates the open deactivation, by whoever brought them back", async () => {
		const person = await deactivatedPerson();

		const outcome = await comeBack(person, { metadata: { connectionId: "connection-1" } });

		expect(outcome).toEqual({ current: true, reactivationRequestId: expect.any(String) });
		expect(await employeeState(person)).toEqual({ is_active: true, deactivated_at: null });
		const [deactivation, ...others] = await ledger(person);
		expect(others).toEqual([]);
		expect(deactivation).toMatchObject({
			id: person.deactivationId,
			reactivated_at: expect.any(Date),
			reactivated_by: person.userId,
			reactivation_request_id: outcome.reactivationRequestId,
		});
		// The entry the history and the backfill read commits with the ledger.
		expect(await reactivatedAuditEntries(person)).toEqual([
			{
				performedBy: person.userId,
				employeeId: person.employeeId,
				changes: { isActive: { from: false, to: true } },
				metadata: {
					connectionId: "connection-1",
					reactivationRequestId: outcome.reactivationRequestId,
				},
			},
		]);
		// The history shows the reactivation once: the event and its audit entry are one.
		const history = await loadLifecycleHistory(fixture.db, {
			organizationId: fixture.organizationId,
			employeeId: person.employeeId,
		});
		expect(history.events.map((event) => event.kind)).toEqual(["reactivated"]);
	});

	it("reactivates when the caller switched the employee on already, as the SCIM reconciler does", async () => {
		const person = await deactivatedPerson();
		await fixture.pool.query("update employee set is_active = true where id = $1", [
			person.employeeId,
		]);

		const outcome = await comeBack(person);

		expect(outcome).toEqual({ current: true, reactivationRequestId: expect.any(String) });
		expect(await ledger(person)).toMatchObject([{ reactivated_by: person.userId }]);
		expect(await reactivatedAuditEntries(person)).toHaveLength(1);
	});

	it("switches on an employee who was never deactivated, without a reactivation", async () => {
		const person = await fixture.seedEmployee({ isActive: false });

		const outcome = await comeBack(person);

		expect(outcome).toEqual({ current: true, reactivationRequestId: null });
		expect(await employeeState(person)).toEqual({ is_active: true, deactivated_at: null });
		expect(await ledger(person)).toEqual([]);
		expect(await reactivatedAuditEntries(person)).toEqual([]);
	});

	it("leaves a former employee whose departure took effect as they are", async () => {
		const person = await deactivatedPerson();
		await fixture.pool.query(
			`insert into employee_departure
			 (organization_id, employee_id, employment_period_id, mode, last_working_day, timezone,
			  cutoff_at, created_by, request_id, request_fingerprint, revision, status, effective_at)
			 values ($1, $2, $3, 'immediate', '2026-01-06', 'UTC', '2026-01-07T08:00:00Z', $4,
			         gen_random_uuid(), 'test', 1, 'effective', '2026-01-07T08:00:00Z')`,
			[fixture.organizationId, person.employeeId, person.employmentPeriodId, fixture.ownerUserId],
		);
		await fixture.pool.query(
			`update employee_employment_period set status = 'closed', ended_at = '2026-01-07T08:00:00Z' where id = $1`,
			[person.employmentPeriodId],
		);

		const outcome = await comeBack(person);

		expect(outcome).toEqual({ current: false, reactivationRequestId: null });
		expect(await employeeState(person)).toMatchObject({ is_active: false });
		expect(await ledger(person)).toMatchObject([{ reactivated_at: null, reactivated_by: null }]);
		expect(await reactivatedAuditEntries(person)).toEqual([]);
	});

	it("stamps a pending follow-up deactivation, which the follow-up then withdraws", async () => {
		const person = await fixture.seedEmployee();
		// A member removal: switched off and recorded pending in one transaction (#1629).
		await fixture.db.transaction(async (tx) => {
			await tx.execute(
				sql`update employee set is_active = false where id = ${person.employeeId}::uuid`,
			);
			await recordFollowUpDeactivation(tx, {
				organizationId: fixture.organizationId,
				employeeId: person.employeeId,
				createdBy: fixture.ownerUserId,
				reason: "member_removed",
			});
		});
		expect(await ledger(person)).toMatchObject([{ status: "pending", reactivated_at: null }]);

		const outcome = await comeBack(person);

		expect(outcome).toEqual({ current: true, reactivationRequestId: expect.any(String) });
		expect(await ledger(person)).toMatchObject([
			{ status: "pending", reactivated_at: expect.any(Date), reactivated_by: person.userId },
		]);
	});

	it("does nothing the second time", async () => {
		const person = await deactivatedPerson();
		const first = await comeBack(person);
		const [stamped] = await ledger(person);

		const second = await comeBack(person);

		expect(first.reactivationRequestId).toEqual(expect.any(String));
		expect(second).toEqual({ current: true, reactivationRequestId: null });
		expect(await ledger(person)).toEqual([stamped]);
		expect(await reactivatedAuditEntries(person)).toHaveLength(1);
	});

	it("rolls the switch-on, the ledger and the audit entry back with the caller's transaction", async () => {
		const person = await deactivatedPerson();

		await expect(comeBack(person, { thenFail: true })).rejects.toThrow(
			"the way back failed after the reactivation",
		);

		expect(await employeeState(person)).toMatchObject({ is_active: false });
		expect(await ledger(person)).toMatchObject([{ reactivated_at: null }]);
		expect(await reactivatedAuditEntries(person)).toEqual([]);
	});
});
