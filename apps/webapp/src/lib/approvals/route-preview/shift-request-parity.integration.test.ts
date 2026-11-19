/**
 * #1604 parity: for shift requests the approval route preview and the decision check
 * (`requireApprover`, reached through `rejectRequest`) agree on who may decide. Every employee of
 * the organization is tried: the decision check admits exactly the preview's deciders.
 */
import { randomUUID } from "node:crypto";
import { Effect, Layer } from "effect";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readOnlyTransaction } from "@/db/read-only-transaction";
import { systemClock } from "@/lib/datetime/temporal-core";
import { type DatabaseClient, DatabaseServiceLive } from "@/lib/effect/services/database.service";
import {
	ShiftRequestService,
	ShiftRequestServiceLive,
} from "@/lib/effect/services/shift-request.service";
import type { SeededEmployee } from "@/lib/employee-lifecycle/testing/database.test.fixture";
import {
	createShiftDatabaseFixture,
	type ShiftDatabaseFixture,
	type ShiftTestOrganization,
	STORED_SHIFT_DATES,
} from "@/lib/scheduling/testing/shift-database.test.fixture";
import { previewApprovalRoutes } from "./preview";
import type { ApprovalRoute } from "./types";

const layer = ShiftRequestServiceLive.pipe(Layer.provide(DatabaseServiceLive));

describe("shift request route parity (PostgreSQL)", () => {
	let fixture: ShiftDatabaseFixture;
	let org: ShiftTestOrganization;
	let requester: SeededEmployee;

	beforeAll(async () => {
		fixture = await createShiftDatabaseFixture();
	});

	const organizationIds: string[] = [];

	afterAll(async () => {
		// A decided request references its approver without cascading.
		await fixture?.pool.query("delete from shift_request where organization_id = any($1)", [
			organizationIds,
		]);
		await fixture?.close();
	});

	const sql = (text: string, values: unknown[] = []) => fixture.pool.query(text, values);

	beforeEach(async () => {
		org = await fixture.organization("Europe/Berlin");
		organizationIds.push(org.organizationId);
		await sql("update organization set shifts_enabled = true where id = $1", [org.organizationId]);
		// The creator is an owner; demote them so each case controls the deciders.
		await sql("update employee set role = 'employee' where id = $1", [org.creator.employeeId]);
		requester = await seed("employee");
	});

	async function seed(role: "employee" | "manager" | "admin") {
		const seeded = await fixture.seedEmployee({ organizationId: org.organizationId });
		await sql("update employee set role = $1 where id = $2", [role, seeded.employeeId]);
		return seeded;
	}

	/** Departed months ago: inactive, with an effective departure. */
	async function depart(person: SeededEmployee) {
		await sql("update employee set is_active = false, end_date = '2026-05-29' where id = $1", [
			person.employeeId,
		]);
		const { rows: periods } = await sql(
			"select id from employee_employment_period where employee_id = $1 limit 1",
			[person.employeeId],
		);
		await sql(
			`insert into employee_departure
			 (organization_id, employee_id, employment_period_id, mode, last_working_day, timezone,
			  cutoff_at, revision, status, created_by, request_id, request_fingerprint, effective_at)
			 values ($1, $2, $3, 'scheduled', '2026-05-29', 'Europe/Berlin', '2026-05-29T22:00:00Z',
			  1, 'effective', $4, $5, 'fingerprint', '2026-05-29T22:00:00Z')`,
			[org.organizationId, person.employeeId, periods[0]?.id, org.creator.userId, randomUUID()],
		);
	}

	/** A due departure: its cutoff has passed but it has not taken effect, so the row is still active. */
	async function departureDue(person: SeededEmployee) {
		const { rows: periods } = await sql(
			"select id from employee_employment_period where employee_id = $1 limit 1",
			[person.employeeId],
		);
		await sql(
			`insert into employee_departure
			 (organization_id, employee_id, employment_period_id, mode, last_working_day, timezone,
			  cutoff_at, revision, status, created_by, request_id, request_fingerprint)
			 values ($1, $2, $3, 'scheduled', '2026-05-29', 'Europe/Berlin', '2026-05-29T22:00:00Z',
			  1, 'pending', $4, $5, 'fingerprint')`,
			[org.organizationId, person.employeeId, periods[0]?.id, org.creator.userId, randomUUID()],
		);
	}

	async function preview() {
		return readOnlyTransaction(fixture.db as unknown as DatabaseClient, (reader) =>
			previewApprovalRoutes(reader, {
				organizationId: org.organizationId,
				at: systemClock.nowInstant(),
				requesters: [{ kind: "employee", employeeId: requester.employeeId }],
			}),
		);
	}

	async function previewRoute(): Promise<ApprovalRoute | undefined> {
		return (await preview()).routes.get(`employee:${requester.employeeId}`)?.get("shift_request");
	}

	const previewDeciders = (route: ApprovalRoute | undefined) =>
		new Set(
			(route?.variants ?? []).flatMap(({ outcome }) =>
				outcome.kind === "routed"
					? outcome.stages.flatMap((stage) => stage.approverEmployeeIds)
					: [],
			),
		);

	/** A pending pickup request of the requester, on a shift of its own. */
	async function pendingRequest() {
		const shiftId = await fixture.shift(org, {
			employeeId: null,
			stored: STORED_SHIFT_DATES["Europe/Berlin"].day,
		});
		const { rows } = await sql(
			`insert into shift_request (organization_id, shift_id, type, status, requester_id, updated_at)
			 values ($1, $2, 'pickup', 'pending', $3, now()) returning id`,
			[org.organizationId, shiftId, requester.employeeId],
		);
		return rows[0].id as string;
	}

	/** Whether the decision check admits `approverId`: rejecting a fresh request succeeds. */
	async function decisionCheckAdmits(approverId: string) {
		const requestId = await pendingRequest();
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* ShiftRequestService;
				return yield* service.rejectRequest(org.organizationId, requestId, approverId);
			}).pipe(Effect.result, Effect.provide(layer)),
		);
		if (result._tag === "Success") return true;
		expect(result.failure).toMatchObject({ _tag: "AuthorizationError" });
		return false;
	}

	function openShift(employeeId: string | null = null) {
		return fixture.shift(org, { employeeId, stored: STORED_SHIFT_DATES["Europe/Berlin"].day });
	}

	async function pendingPickup(shiftId: string, requesterId: string) {
		const { rows } = await sql(
			`insert into shift_request (organization_id, shift_id, type, status, requester_id, updated_at)
			 values ($1, $2, 'pickup', 'pending', $3, now()) returning id`,
			[org.organizationId, shiftId, requesterId],
		);
		return rows[0].id as string;
	}

	/** The requester submits a swap or pickup through the service. */
	function submit(type: "swap" | "pickup", input: { shiftId: string; targetEmployeeId?: string }) {
		return Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* ShiftRequestService;
				const request = { ...input, requesterId: requester.employeeId };
				return type === "swap"
					? yield* service.requestSwap(org.organizationId, request)
					: yield* service.requestPickup(org.organizationId, request);
			}).pipe(Effect.result, Effect.provide(layer)),
		);
	}

	async function shiftAssignee(shiftId: string) {
		const { rows } = await sql("select employee_id from shift where id = $1", [shiftId]);
		return rows[0]?.employee_id as string | null;
	}

	async function requestStatus(requestId: string) {
		const { rows } = await sql("select status from shift_request where id = $1", [requestId]);
		return rows[0]?.status as string | undefined;
	}

	function decide(action: "approve" | "reject", requestId: string, approverId: string) {
		return Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* ShiftRequestService;
				return action === "approve"
					? yield* service.approveRequest(org.organizationId, requestId, approverId)
					: yield* service.rejectRequest(org.organizationId, requestId, approverId);
			}).pipe(Effect.result, Effect.provide(layer)),
		);
	}

	/** Whether the pending shift request list admits `approverId`. */
	async function pendingListAdmits(approverId: string) {
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* ShiftRequestService;
				return yield* service.getPendingRequests(org.organizationId, approverId);
			}).pipe(Effect.result, Effect.provide(layer)),
		);
		if (result._tag === "Success") return true;
		expect(result.failure).toMatchObject({ _tag: "AuthorizationError" });
		return false;
	}

	async function decisionCheckDeciders() {
		const { rows } = await sql("select id from employee where organization_id = $1", [
			org.organizationId,
		]);
		const admitted = new Set<string>();
		for (const { id } of rows as Array<{ id: string }>) {
			if (await decisionCheckAdmits(id)) admitted.add(id);
		}
		return admitted;
	}

	it("routes to a manager on the roster, whom the decision check admits", async () => {
		const manager = await seed("manager");

		const route = await previewRoute();

		expect(route).toMatchObject({ kind: "routed" });
		expect(previewDeciders(route)).toEqual(new Set([manager.employeeId]));
		expect(await decisionCheckDeciders()).toEqual(previewDeciders(route));
	});

	it("routes to an admin on the roster, whom the decision check admits", async () => {
		const admin = await seed("admin");

		const route = await previewRoute();

		expect(previewDeciders(route)).toEqual(new Set([admin.employeeId]));
		expect(await decisionCheckDeciders()).toEqual(previewDeciders(route));
	});

	it("leaves out a departed manager, whom the decision check refuses", async () => {
		const manager = await seed("manager");
		const departed = await seed("manager");
		await depart(departed);

		const route = await previewRoute();

		expect(previewDeciders(route)).toEqual(new Set([manager.employeeId]));
		expect(await decisionCheckDeciders()).toEqual(previewDeciders(route));
	});

	it("refuses the pending list to a manager whose departure is due, as the decision check does (#1597)", async () => {
		const leaving = await seed("manager");
		await departureDue(leaving);

		expect(await pendingListAdmits(leaving.employeeId)).toBe(false);
		expect(await decisionCheckAdmits(leaving.employeeId)).toBe(false);
	});

	it("routes a requesting manager's request to the other deciders, as the decision check refuses the requester (#1597)", async () => {
		await sql("update employee set role = 'manager' where id = $1", [requester.employeeId]);
		const manager = await seed("manager");

		const route = await previewRoute();

		expect(previewDeciders(route)).toEqual(new Set([manager.employeeId]));
		expect(await decisionCheckDeciders()).toEqual(previewDeciders(route));
	});

	it("refuses a requesting manager both approving and rejecting their own request (#1597)", async () => {
		await sql("update employee set role = 'manager' where id = $1", [requester.employeeId]);
		await seed("manager");

		const approved = await decide("approve", await pendingRequest(), requester.employeeId);
		const rejected = await decide("reject", await pendingRequest(), requester.employeeId);

		expect(approved).toMatchObject({ _tag: "Failure", failure: { _tag: "AuthorizationError" } });
		expect(rejected).toMatchObject({ _tag: "Failure", failure: { _tag: "AuthorizationError" } });
	});

	it("approves the only decider's pickup on submission, as the preview shows (#1597)", async () => {
		await sql("update employee set role = 'manager' where id = $1", [requester.employeeId]);
		const colleague = await seed("employee");
		const shiftId = await openShift();
		const competing = await pendingPickup(shiftId, colleague.employeeId);

		const route = await previewRoute();
		const submitted = await submit("pickup", { shiftId });

		expect(route).toMatchObject({ kind: "routed" });
		expect(route?.variants[0]?.outcome).toMatchObject({
			autoCompleted: true,
			stages: [{ activation: "requester_auto_approve", approverEmployeeIds: [] }],
		});
		expect(submitted).toMatchObject({
			_tag: "Success",
			success: { status: "approved", approverId: requester.employeeId },
		});
		expect(await shiftAssignee(shiftId)).toBe(requester.employeeId);
		expect(await requestStatus(competing)).toBe("rejected");
	});

	it("approves the only decider's swap on submission, moving the shift to the colleague (#1597)", async () => {
		await sql("update employee set role = 'manager' where id = $1", [requester.employeeId]);
		const colleague = await seed("employee");
		const shiftId = await openShift(requester.employeeId);

		const submitted = await submit("swap", { shiftId, targetEmployeeId: colleague.employeeId });

		expect(submitted).toMatchObject({
			_tag: "Success",
			success: { status: "approved", approverId: requester.employeeId },
		});
		expect(await shiftAssignee(shiftId)).toBe(colleague.employeeId);
	});

	it("refuses the only decider's swap without a colleague and writes no request (#1597)", async () => {
		await sql("update employee set role = 'manager' where id = $1", [requester.employeeId]);
		const shiftId = await openShift(requester.employeeId);

		const submitted = await submit("swap", { shiftId });

		expect(submitted).toMatchObject({
			_tag: "Failure",
			failure: { _tag: "ConflictError", conflictType: "missing_target_employee" },
		});
		const { rows } = await sql("select id from shift_request where shift_id = $1", [shiftId]);
		expect(rows).toEqual([]);
		expect(await shiftAssignee(shiftId)).toBe(requester.employeeId);
	});

	it("leaves a requesting manager's request pending while another decider exists (#1597)", async () => {
		await sql("update employee set role = 'manager' where id = $1", [requester.employeeId]);
		await seed("admin");
		const shiftId = await openShift();

		const submitted = await submit("pickup", { shiftId });

		expect(submitted).toMatchObject({ _tag: "Success", success: { status: "pending" } });
		expect(await shiftAssignee(shiftId)).toBeNull();
	});

	it("lets a requesting manager withdraw their own pending request (#1597)", async () => {
		await sql("update employee set role = 'manager' where id = $1", [requester.employeeId]);
		await seed("manager");
		const requestId = await pendingRequest();

		const withdrawn = await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* ShiftRequestService;
				return yield* service.cancelRequest(org.organizationId, requestId, requester.employeeId);
			}).pipe(Effect.result, Effect.provide(layer)),
		);

		expect(withdrawn).toMatchObject({ _tag: "Success" });
	});

	it("is unroutable on an employee-only roster, where the decision check admits nobody", async () => {
		await seed("employee");

		const route = await previewRoute();

		expect(route).toMatchObject({ kind: "unroutable", reason: { code: "no_decider" } });
		expect(await decisionCheckDeciders()).toEqual(new Set());
	});

	it("is not checked with shifts disabled", async () => {
		await seed("manager");
		await sql("update organization set shifts_enabled = false where id = $1", [org.organizationId]);

		const found = await preview();

		expect(found.offKinds).toContain("shift_request");
		expect(found.kinds).not.toContain("shift_request");
		expect(found.routes.get(`employee:${requester.employeeId}`)?.has("shift_request")).toBe(false);
	});
});
