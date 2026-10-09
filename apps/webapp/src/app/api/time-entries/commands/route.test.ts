/**
 * The commands route as a frozen clock command adapter (#481): how a request
 * becomes a Clocking command, and how an outcome becomes the HTTP/v2 response.
 * The Clocking module is replaced; its behaviour is covered on PostgreSQL by
 * `lib/time-tracking/clocking/frozen.integration.test.ts` and `route.integration.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";

const state = vi.hoisted(() => ({
	run: vi.fn(),
	lookup: vi.fn(),
	session: { user: { id: "user-1" }, session: { activeOrganizationId: "org-1" } } as unknown,
	requireActor: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/server")>()),
	connection: async () => undefined,
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => state.session } } }));
vi.mock("@/lib/domain/request-origin", () => ({
	resolvePublicRequestOrigin: async () => "https://app.test",
}));
vi.mock("@/lib/datetime/temporal-core", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/datetime/temporal-core")>()),
	systemClock: { nowInstant: () => parseInstant("2026-09-20T10:10:00Z") },
}));
vi.mock("@/lib/time-tracking/clocking", () => ({
	clocking: { run: state.run, lookup: state.lookup },
}));
vi.mock("@/lib/time-tracking/clocking-service", () => {
	class ClockingAccessError extends Error {}
	return { ClockingAccessError, clockingService: { requireActor: state.requireActor } };
});
vi.mock("@/lib/time-tracking/work-transaction", () => ({
	readAppendAdmission: async () => "append",
}));
vi.mock("@/app/[locale]/(app)/time-tracking/actions/auth", () => ({
	getUserTimezone: async () => "Europe/Vienna",
}));

const { POST } = await import("./route");
const lookupRoute = await import("./[operationId]/route");

const operationId = "0f0e0d0c-0b0a-4908-8706-050403020100";
const clockInOperationId = "1f0e0d0c-0b0a-4908-8706-050403020100";
const context = {
	userId: "user-1",
	organizationId: "org-1",
	employeeId: "e1000000-0000-4000-8000-000000000001",
	server: "https://app.test",
};

function breakCommand(overrides: Record<string, unknown> = {}) {
	return {
		version: 2,
		operationId,
		kind: "break",
		admission: "delayed",
		occurredAt: "2026-09-20T10:00:00.000Z",
		timezone: "Europe/Berlin",
		context,
		target: { clockInOperationId },
		workLocationType: "office",
		breakStart: { at: "2026-09-20T09:30:00.000Z", timezone: "Europe/Lisbon" },
		observations: {
			lastActivity: { utc: "2026-09-20T09:30:00.000Z", monotonicMs: 0 },
			idleDetected: {
				utc: "2026-09-20T09:35:00.000Z",
				monotonicMs: 300_000,
				timezone: "Europe/Lisbon",
			},
			returnDetected: {
				utc: "2026-09-20T10:00:00.000Z",
				monotonicMs: 1_800_000,
				timezone: "Europe/Berlin",
			},
			confirmed: { utc: "2026-09-20T10:01:00.000Z", monotonicMs: 1_860_000 },
		},
		...overrides,
	};
}

function clockOutCommand(overrides: Record<string, unknown> = {}) {
	return {
		version: 2,
		operationId,
		kind: "clock_out",
		admission: "immediate",
		occurredAt: "2026-09-20T10:08:00.000Z",
		timezone: "Europe/Berlin",
		context,
		target: { workPeriodId: "a1000000-0000-4000-8000-000000000001" },
		project: { kind: "clear" },
		workCategory: { kind: "preserve" },
		...overrides,
	};
}

async function submit(body: unknown) {
	const response = await POST(
		new Request("https://app.test/api/time-entries/commands", {
			method: "POST",
			body: JSON.stringify(body),
		}),
	);
	return { status: response.status, body: await response.json() };
}

const receipt = { kind: "close_resume_work", result: { operationId } };

describe("POST /api/time-entries/commands", () => {
	beforeEach(() => {
		state.run.mockReset();
		state.lookup.mockReset();
		state.lookup.mockResolvedValue({
			outcome: "committed",
			receipt,
			command: {},
			evidence: "standing",
		});
		state.requireActor.mockResolvedValue({
			userId: "user-1",
			organizationId: "org-1",
			employee: { id: context.employeeId },
		});
	});

	it("runs a frozen break with its bytes, named target, observed start and delayed window", async () => {
		const command = breakCommand();
		state.run.mockResolvedValue({
			outcome: "executed",
			result: { complianceWarnings: [{ type: "rest" }] },
		});

		const response = await submit(command);

		expect(state.run).toHaveBeenCalledWith({
			organizationId: "org-1",
			principal: { kind: "user", userId: "user-1" },
			subject: { employeeId: context.employeeId },
			identity: { origin: "client", id: operationId },
			channel: "api",
			at: { kind: "occurred", instant: parseInstant("2026-09-20T10:00:00Z") },
			zone: { device: "Europe/Berlin", fallback: "Europe/Vienna" },
			freshness: {
				earliest: parseInstant("2026-09-13T10:10:00Z"),
				latest: parseInstant("2026-09-20T10:15:00Z"),
				observed: [parseInstant("2026-09-20T10:01:00Z")],
			},
			payload: command,
			body: {
				kind: "break",
				target: { kind: "started_by", operationId: clockInOperationId },
				start: { instant: parseInstant("2026-09-20T09:30:00Z"), zone: "Europe/Lisbon" },
			},
		});
		expect(response).toEqual({
			status: 201,
			body: {
				outcome: "executed",
				operationId,
				receipt,
				clockOut: { complianceWarnings: [{ type: "rest" }] },
			},
		});
	});

	it("runs a clock-out against its known period and replays the committed receipt", async () => {
		state.run.mockResolvedValue({ outcome: "replayed", result: {} });

		const response = await submit(clockOutCommand());

		expect(state.run).toHaveBeenCalledWith(
			expect.objectContaining({
				freshness: {
					earliest: parseInstant("2026-09-20T10:05:00Z"),
					latest: parseInstant("2026-09-20T10:15:00Z"),
				},
				body: {
					kind: "clock_out",
					target: { kind: "period", workPeriodId: "a1000000-0000-4000-8000-000000000001" },
					project: { kind: "clear" },
					workCategory: { kind: "preserve" },
				},
			}),
		);
		expect(response).toEqual({ status: 200, body: { outcome: "replayed", operationId, receipt } });
	});

	it("passes a named task to the Clocking module with the frozen bytes (#875)", async () => {
		state.run.mockResolvedValue({ outcome: "executed", result: {} });
		const task = { kind: "replace", id: "b1000000-0000-4000-8000-000000000001" };
		const command = clockOutCommand({
			project: { kind: "replace", id: "c1000000-0000-4000-8000-000000000001" },
			task,
		});

		await submit(command);

		const [run] = state.run.mock.calls[0];
		expect(run.payload).toEqual(command);
		expect(run.body).toEqual({
			kind: "clock_out",
			target: { kind: "period", workPeriodId: "a1000000-0000-4000-8000-000000000001" },
			project: { kind: "replace", id: "c1000000-0000-4000-8000-000000000001" },
			workCategory: { kind: "preserve" },
			task,
		});
	});

	it("names no task when the command names none", async () => {
		state.run.mockResolvedValue({ outcome: "executed", result: {} });

		await submit(clockOutCommand());

		expect(Object.keys(state.run.mock.calls[0][0].body)).toEqual([
			"kind",
			"target",
			"project",
			"workCategory",
		]);
	});

	it.each([
		[{ code: "frozen_not_accepted" }, 409, { code: "not_adopted" }],
		[
			{ code: "task_not_allowed", reason: "task_done" },
			422,
			{ code: "attribution_not_allowed", field: "taskId", reason: "task_done" },
		],
		[
			{ code: "billing_required", reason: "past_due" },
			402,
			{ code: "billing_required", reason: "past_due" },
		],
		[
			{ code: "admission_window", reason: "too_old" },
			422,
			{ code: "admission_window", reason: "too_old" },
		],
		[
			{ code: "holiday_blocked", holidayName: "Neujahr" },
			422,
			{ code: "not_allowed_at_time", holidayName: "Neujahr" },
		],
		[
			{ code: "work_category_not_allowed" },
			422,
			{ code: "attribution_not_allowed", field: "workCategoryId" },
		],
		[{ code: "under_review", review: "approval" }, 409, { code: "review_pending" }],
		[
			{ code: "already_clocked_in", since: parseInstant("2026-09-20T08:00:00Z") },
			409,
			{ code: "already_clocked_in" },
		],
		[{ code: "target_unknown" }, 409, { code: "target_unknown" }],
		[{ code: "collision", cause: new Error("x") }, 409, { code: "collision" }],
	])("words the refusal %o as HTTP %i", async (failure, status, body) => {
		state.run.mockResolvedValue({ outcome: "refused", failure });

		const response = await submit(breakCommand());

		expect(response).toEqual({
			status,
			body: { outcome: "rejected", operationId, ...body },
		});
		expect(state.lookup).not.toHaveBeenCalled();
	});

	it.each(["unconfirmed", "failed"])("answers a %s run as an unknown outcome", async (code) => {
		state.run.mockResolvedValue({ outcome: "refused", failure: { code, cause: new Error("x") } });

		expect(await submit(breakCommand())).toEqual({
			status: 500,
			body: { outcome: "unknown", operationId },
		});
	});

	it("refuses a mismatched context and a clock discontinuity without running", async () => {
		const mismatched = await submit(breakCommand({ context: { ...context, userId: "user-2" } }));
		const jumped = breakCommand();
		jumped.observations.idleDetected.utc = "2026-09-20T10:35:00.000Z";
		const discontinuous = await submit(jumped);

		expect(mismatched).toEqual({
			status: 409,
			body: { outcome: "rejected", operationId, code: "context_mismatch", fields: ["userId"] },
		});
		expect(discontinuous).toEqual({
			status: 422,
			body: { outcome: "rejected", operationId, code: "clock_discontinuity", from: "lastActivity" },
		});
		expect(state.run).not.toHaveBeenCalled();
	});
});

describe("GET /api/time-entries/commands/{operationId}", () => {
	async function lookup() {
		const response = await lookupRoute.GET(
			new Request(`https://app.test/api/time-entries/commands/${operationId}`),
			{ params: Promise.resolve({ operationId }) },
		);
		return { status: response.status, body: await response.json() };
	}

	beforeEach(() => {
		state.lookup.mockReset();
		state.requireActor.mockResolvedValue({
			userId: "user-1",
			organizationId: "org-1",
			employee: { id: context.employeeId },
		});
	});

	it("looks the identity up for the authenticated employee on the direct-HTTP channel", async () => {
		state.lookup.mockResolvedValue({
			outcome: "committed",
			receipt,
			command: { operationId },
			evidence: "changed",
		});

		const response = await lookup();

		expect(state.lookup).toHaveBeenCalledWith({
			organizationId: "org-1",
			principal: { kind: "user", userId: "user-1" },
			subject: { employeeId: context.employeeId },
			identity: { origin: "client", id: operationId },
			channel: "api",
		});
		expect(response).toEqual({
			status: 200,
			body: {
				outcome: "committed",
				operationId,
				receipt,
				command: { operationId },
				evidence: "changed",
			},
		});
	});

	it.each(["not_committed", "conflict"])("answers %s without details", async (outcome) => {
		state.lookup.mockResolvedValue({ outcome });

		expect(await lookup()).toEqual({ status: 200, body: { outcome, operationId } });
	});
});
