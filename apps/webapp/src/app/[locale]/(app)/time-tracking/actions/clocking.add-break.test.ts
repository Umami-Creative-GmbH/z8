import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";

// The Clocking module is replaced at its public `run`; its behaviour is proven on
// PostgreSQL in lib/time-tracking/clocking/break.integration.test.ts. These tests
// pin only the adapter: transport to command, outcome to response.
const state = vi.hoisted(() => ({
	run: vi.fn(),
	revalidatePath: vi.fn(),
	session: { user: { id: "user-1" } } as { user: { id: string } } | null,
	employee: { id: "employee-1", organizationId: "org-1" } as Record<string, unknown> | null,
	logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/db", () => ({ db: {} }));
vi.mock("next/cache", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/cache")>()),
	revalidatePath: state.revalidatePath,
}));
vi.mock("@/lib/time-tracking/clocking", () => ({
	clocking: { run: state.run },
	afterCommitFollowUps: () => ({ afterClockOut: vi.fn() }),
	clockOutFollowUpEffects: {},
}));
vi.mock("./auth", () => ({
	getCurrentSession: async () => state.session,
	getCurrentEmployee: async () => state.employee,
	getRequestMetadata: async () => ({ ipAddress: "203.0.113.7", userAgent: "test-agent" }),
	getUserTimezone: async () => "Europe/Berlin",
}));
vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (key: string, fallback: string, params?: Record<string, string>) =>
		`${key}|${fallback}|${JSON.stringify(params ?? {})}`,
}));
vi.mock("./shared", async (importOriginal) => ({
	...(await importOriginal<typeof import("./shared")>()),
	logger: state.logger,
}));

const { addBreakToActiveSession } = await import("./clocking");

const submissionId = "30400000-0000-4000-8000-000000000001";
const resumed = {
	workPeriodId: "30400000-0000-4000-8000-000000000002",
	start: parseInstant("2026-07-22T10:00:00Z"),
};

beforeEach(() => {
	vi.clearAllMocks();
	state.session = { user: { id: "user-1" } };
	state.employee = { id: "employee-1", organizationId: "org-1" };
	state.run.mockResolvedValue({ outcome: "executed", result: resumed });
});

describe("web break adapter", () => {
	it("turns the web request into a self-service break command carrying its evidence", async () => {
		await addBreakToActiveSession(15, { submissionId, browserTimezone: "America/New_York" });

		expect(state.run).toHaveBeenCalledWith({
			organizationId: "org-1",
			principal: { kind: "user", userId: "user-1" },
			subject: { employeeId: "employee-1" },
			identity: { origin: "client", id: submissionId },
			channel: "web",
			at: { kind: "now" },
			zone: { device: "America/New_York", fallback: "Europe/Berlin" },
			body: { kind: "break", breakMinutes: 15 },
			request: { ipAddress: "203.0.113.7", userAgent: "test-agent" },
		});
	});

	it("carries the position taken at the break's end, and drops a malformed one (#826)", async () => {
		const position = {
			latitude: 52.52,
			longitude: 13.4,
			accuracyMeters: 20,
			fixedAt: "2026-07-22T09:59:58.000Z",
		};

		await addBreakToActiveSession(15, { submissionId, position });
		await addBreakToActiveSession(15, { submissionId, position: { latitude: 200 } });

		expect(state.run.mock.calls[0]?.[0]).toMatchObject({
			position: { ...position, fixedAt: parseInstant("2026-07-22T09:59:58Z") },
		});
		expect(state.run.mock.calls[1]?.[0]).not.toHaveProperty("position");
	});

	it("names an unkeyed request with a server identity", async () => {
		await addBreakToActiveSession(15);

		expect(state.run).toHaveBeenCalledWith(
			expect.objectContaining({
				identity: { origin: "server", id: expect.stringMatching(/^[0-9a-f-]{36}$/) },
				zone: { device: null, fallback: "Europe/Berlin" },
			}),
		);
	});

	it.each([
		["executed", 1],
		["replayed", 0],
	] as const)("returns the resumed work when %s", async (outcome, revalidations) => {
		state.run.mockResolvedValue({ outcome, result: resumed });

		await expect(addBreakToActiveSession(15, { submissionId })).resolves.toEqual({
			success: true,
			data: { id: resumed.workPeriodId, startTime: new Date("2026-07-22T10:00:00Z") },
		});
		// Only a committed break changes what the time-tracking page shows.
		expect(state.revalidatePath).toHaveBeenCalledTimes(revalidations);
	});

	it.each([
		[
			{ code: "under_review", review: "time_correction" },
			"timeTracking.errors.breakPendingCorrection|A time correction approval is already pending for this work period. Add the break once it is resolved.|{}",
		],
		[
			{ code: "under_review", review: "approval" },
			"timeTracking.errors.breakAwaitingApproval|This work period is awaiting approval and cannot be edited. Add the break once it is resolved.|{}",
		],
		[
			{ code: "holiday_blocked", holidayName: "Closing day" },
			'timeTracking.errors.holidayBlockedBreak|Cannot resume work after a break on {holidayName}|{"holidayName":"Closing day"}',
		],
		[
			{ code: "occupancy_conflict" },
			"timeTracking.errors.breakOccupied|The break overlaps other recorded work.|{}",
		],
		[
			{ code: "invalid_interval" },
			"timeTracking.errors.breakTooLong|Break duration must be shorter than your current session.|{}",
		],
		[
			{ code: "invalid_break_duration" },
			"timeTracking.errors.breakDurationInvalid|Enter a break duration of at least 1 minute.|{}",
		],
		[
			{ code: "not_clocked_in" },
			"timeTracking.errors.notClockedIn|You are not currently clocked in|{}",
		],
		[
			{ code: "collision" },
			"timeTracking.errors.clockOutCollision|This clock-out conflicts with an earlier request or changed work. Please refresh and try again.|{}",
		],
		[
			{ code: "append_review_required", requirement: {} },
			"timeTracking.errors.clockOutAppendReview|Your time history needs review before you can clock out. Please contact your administrator.|{}",
		],
		[
			{ code: "access_denied" },
			"timeTracking.errors.breakNotAllowed|You cannot add a break to this work.|{}",
		],
		...(["admission_window", "invalid_command", "failed", "unconfirmed"] as const).map(
			(code) =>
				[
					{ code },
					"timeTracking.errors.breakRetry|Failed to add break. Please try again.|{}",
				] as const,
		),
	])("words the %o refusal in the timeTracking namespace", async (failure, error) => {
		state.run.mockResolvedValue({ outcome: "refused", failure });

		await expect(addBreakToActiveSession(15, { submissionId })).resolves.toEqual({
			success: false,
			error,
		});
	});

	it("keeps the billing code on the wire and logs operator detail", async () => {
		state.run.mockResolvedValue({
			outcome: "refused",
			failure: { code: "billing_required", reason: "subscription_expired" },
		});
		await expect(addBreakToActiveSession(15, { submissionId })).resolves.toEqual({
			success: false,
			error: "billing_required",
			code: "subscription_expired",
		});

		const cause = new Error("connection reset");
		state.run.mockResolvedValue({ outcome: "refused", failure: { code: "unconfirmed", cause } });
		await addBreakToActiveSession(15, { submissionId });
		expect(state.logger.error).toHaveBeenCalledWith(
			{ error: cause },
			"Add break to active session error",
		);
	});

	it("refuses an unauthenticated request before building a command", async () => {
		state.session = null;

		await expect(addBreakToActiveSession(15, { submissionId })).resolves.toEqual({
			success: false,
			error: "timeTracking.errors.notAuthenticated|Not authenticated|{}",
		});
		expect(state.run).not.toHaveBeenCalled();
	});
});
