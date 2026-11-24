/**
 * #1992: approving a shift request gives the shift a new assignee, a material assignment change.
 * `shift.assignment_changed_at` moves to the approval, so the new assignee's § 12 Abs. 3 TzBfG
 * call-in notice runs from it.
 */
import { Effect, Layer } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseServiceLive } from "@/lib/effect/services/database.service";
import {
	ShiftRequestService,
	ShiftRequestServiceLive,
} from "@/lib/effect/services/shift-request.service";
import {
	createShiftDatabaseFixture,
	type ShiftDatabaseFixture,
	STORED_SHIFT_DATES,
} from "@/lib/scheduling/testing/shift-database.test.fixture";

const layer = ShiftRequestServiceLive.pipe(Layer.provide(DatabaseServiceLive));

describe("shift request approval stamps the assignment change (PostgreSQL)", () => {
	let fixture: ShiftDatabaseFixture;
	const organizationIds: string[] = [];

	beforeAll(async () => {
		fixture = await createShiftDatabaseFixture();
	});

	afterAll(async () => {
		// A decided request references its approver without cascading.
		await fixture?.pool.query("delete from shift_request where organization_id = any($1)", [
			organizationIds,
		]);
		await fixture?.close();
	});

	it("moves assignment_changed_at to the approval of a pickup", async () => {
		const org = await fixture.organization("Europe/Berlin");
		organizationIds.push(org.organizationId);
		const sql = (text: string, values: unknown[] = []) => fixture.pool.query(text, values);
		await sql("update organization set shifts_enabled = true where id = $1", [org.organizationId]);
		await sql("update employee set role = 'employee' where id = $1", [org.creator.employeeId]);
		const requester = await fixture.seedEmployee({ organizationId: org.organizationId });
		const manager = await fixture.seedEmployee({ organizationId: org.organizationId });
		await sql("update employee set role = 'manager' where id = $1", [manager.employeeId]);
		const shiftId = await fixture.shift(org, {
			employeeId: null,
			stored: STORED_SHIFT_DATES["Europe/Berlin"].day,
		});
		await sql(
			"update shift set status = 'published', assignment_changed_at = '2026-01-01T00:00:00Z' where id = $1",
			[shiftId],
		);
		const {
			rows: [request],
		} = await sql(
			`insert into shift_request (organization_id, shift_id, type, status, requester_id, updated_at)
			 values ($1, $2, 'pickup', 'pending', $3, now()) returning id`,
			[org.organizationId, shiftId, requester.employeeId],
		);
		const before = new Date();

		const approved = await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* ShiftRequestService;
				return yield* service.approveRequest(org.organizationId, request.id, manager.employeeId);
			}).pipe(Effect.result, Effect.provide(layer)),
		);

		expect(approved).toMatchObject({ _tag: "Success" });
		const {
			rows: [stored],
		} = await sql("select employee_id, assignment_changed_at from shift where id = $1", [shiftId]);
		expect(stored.employee_id).toBe(requester.employeeId);
		expect((stored.assignment_changed_at as Date).getTime()).toBeGreaterThanOrEqual(
			before.getTime() - 1_000,
		);
	});
});
