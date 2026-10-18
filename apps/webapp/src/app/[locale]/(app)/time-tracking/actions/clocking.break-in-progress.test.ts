import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";

// The Clocking module is replaced at its public `startBreak`/`resumeBreak`; their
// behaviour is proven on PostgreSQL in
// lib/time-tracking/clocking/break-in-progress.integration.test.ts. These tests
// pin only the web adapter (#888): transport to command, outcome to response.
const state = vi.hoisted(() => ({
	startBreak: vi.fn(),
	resumeBreak: vi.fn(),
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
	clocking: { startBreak: state.startBreak, resumeBreak: state.resumeBreak },
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

const { resumeBreakInProgress, startBreakInProgress } = await import("./clocking");

const submissionId = "88800000-0000-4000-8000-000000000001";
const workPeriodId = "88800000-0000-4000-8000-000000000002";
const resumedPeriodId = "88800000-0000-4000-8000-000000000003";
const breakStart = "2026-07-22T09:45:00.000Z";

const started = {
	outcome: "executed",
	result: { workPeriodId, start: parseInstant("2026-07-22T09:45:00Z") },
};
const resumed = {
	outcome: "executed",
	result: { workPeriodId: resumedPeriodId, start: parseInstant("2026-07-22T10:00:00Z") },
};

beforeEach(() => {
	vi.clearAllMocks();
	state.session = { user: { id: "user-1" } };
	state.employee = { id: "employee-1", organizationId: "org-1" };
	state.startBreak.mockResolvedValue(started);
	state.resumeBreak.mockResolvedValue(resumed);
});

describe("web start break adapter (#888)", () => {
	it("turns the request into the employee's own start on the work they saw", async () => {
		await startBreakInProgress({
			submissionId,
			workPeriodId,
			browserTimezone: "America/New_York",
		});

		expect(state.startBreak).toHaveBeenCalledWith({
			organizationId: "org-1",
			principal: { kind: "user", userId: "user-1" },
			subject: { employeeId: "employee-1" },
			identity: { origin: "client", id: submissionId },
			channel: "web",
			at: { kind: "now" },
			zone: { device: "America/New_York", fallback: "Europe/Berlin" },
			expected: { workPeriodId },
		});
	});

	it.each([
		["executed", 1],
		["replayed", 0],
	] as const)("answers the recorded break when %s", async (outcome, revalidations) => {
		state.startBreak.mockResolvedValue({ ...started, outcome });

		await expect(
			startBreakInProgress({ submissionId, workPeriodId, browserTimezone: null }),
		).resolves.toEqual({ success: true, data: { workPeriodId, at: breakStart } });
		expect(state.revalidatePath).toHaveBeenCalledTimes(revalidations);
	});

	it("answers a live start, taken at the server clock's precision, in milliseconds", async () => {
		state.startBreak.mockResolvedValue({
			outcome: "executed",
			result: { workPeriodId, start: parseInstant("2026-07-22T09:45:00.123456789Z") },
		});

		await expect(
			startBreakInProgress({ submissionId, workPeriodId, browserTimezone: null }),
		).resolves.toEqual({
			success: true,
			data: { workPeriodId, at: "2026-07-22T09:45:00.123Z" },
		});
	});

	it.each([
		[
			{ code: "not_clocked_in" },
			"timeTracking.breakInProgress.errors.workChanged|Your clock changed on another device. It now shows the current state.|{}",
		],
		[
			{ code: "already_on_break" },
			"timeTracking.breakInProgress.errors.alreadyOnBreak|You are already on a break.|{}",
		],
		[
			{ code: "invalid_interval" },
			"timeTracking.breakInProgress.errors.tooEarly|A break can only start after your work has started.|{}",
		],
		[
			{ code: "under_review", review: "approval" },
			"timeTracking.errors.breakAwaitingApproval|This work period is awaiting approval and cannot be edited. Add the break once it is resolved.|{}",
		],
		[
			{ code: "access_denied" },
			"timeTracking.breakInProgress.errors.startNotAllowed|You cannot start a break.|{}",
		],
		[
			{ code: "collision" },
			"timeTracking.breakInProgress.errors.collision|This break conflicts with an earlier request. Please refresh and try again.|{}",
		],
		[
			{ code: "unconfirmed" },
			"timeTracking.breakInProgress.errors.unconfirmed|Your break could not be confirmed. Check your clock before trying again.|{}",
		],
		...(["admission_window", "invalid_command", "frozen_not_accepted", "failed"] as const).map(
			(code) =>
				[
					{ code },
					"timeTracking.breakInProgress.errors.startRetry|Could not start your break. Please try again.|{}",
				] as const,
		),
	])("words the %o refusal and keeps its code", async (failure, error) => {
		state.startBreak.mockResolvedValue({ outcome: "refused", failure });

		await expect(
			startBreakInProgress({ submissionId, workPeriodId, browserTimezone: null }),
		).resolves.toEqual({ success: false, error, code: failure.code });
	});

	it("keeps the billing code on the wire and logs an unconfirmed start", async () => {
		state.startBreak.mockResolvedValue({
			outcome: "refused",
			failure: { code: "billing_required", reason: "subscription_expired" },
		});
		await expect(
			startBreakInProgress({ submissionId, workPeriodId, browserTimezone: null }),
		).resolves.toEqual({
			success: false,
			error: "billing_required",
			code: "subscription_expired",
		});

		const cause = new Error("connection reset");
		state.startBreak.mockResolvedValue({
			outcome: "refused",
			failure: { code: "unconfirmed", cause },
		});
		await startBreakInProgress({ submissionId, workPeriodId, browserTimezone: null });
		expect(state.logger.error).toHaveBeenCalledWith({ error: cause }, "Start break error");
	});

	it("refuses an unauthenticated or malformed request before building a command", async () => {
		await expect(
			startBreakInProgress({ submissionId, workPeriodId: 7 as never, browserTimezone: null }),
		).resolves.toMatchObject({ success: false, code: "invalid_command" });
		state.session = null;
		await expect(
			startBreakInProgress({ submissionId, workPeriodId, browserTimezone: null }),
		).resolves.toEqual({
			success: false,
			error: "timeTracking.errors.notAuthenticated|Not authenticated|{}",
			code: "not_authenticated",
		});
		expect(state.startBreak).not.toHaveBeenCalled();
	});
});

describe("web resume adapter (#888)", () => {
	it("turns the request into the employee's own resume of the break they saw", async () => {
		const position = {
			latitude: 52.52,
			longitude: 13.4,
			accuracyMeters: 20,
			fixedAt: "2026-07-22T09:59:58.000Z",
		};
		await resumeBreakInProgress({
			submissionId,
			workPeriodId,
			breakStart,
			browserTimezone: "Europe/Berlin",
			position,
		});

		expect(state.resumeBreak).toHaveBeenCalledWith({
			organizationId: "org-1",
			principal: { kind: "user", userId: "user-1" },
			subject: { employeeId: "employee-1" },
			identity: { origin: "client", id: submissionId },
			channel: "web",
			at: { kind: "now" },
			zone: { device: "Europe/Berlin", fallback: "Europe/Berlin" },
			expected: { workPeriodId, breakStart: parseInstant("2026-07-22T09:45:00Z") },
			request: { ipAddress: "203.0.113.7", userAgent: "test-agent" },
			// The position is taken where the work resumes and stamps the resumed work.
			position: { ...position, fixedAt: parseInstant("2026-07-22T09:59:58Z") },
		});
	});

	it.each([
		["executed", 1],
		["replayed", 0],
	] as const)("answers the resumed work when %s", async (outcome, revalidations) => {
		state.resumeBreak.mockResolvedValue({ ...resumed, outcome });

		await expect(
			resumeBreakInProgress({ submissionId, workPeriodId, breakStart, browserTimezone: null }),
		).resolves.toEqual({
			success: true,
			data: { workPeriodId: resumedPeriodId, at: "2026-07-22T10:00:00.000Z" },
		});
		expect(state.revalidatePath).toHaveBeenCalledTimes(revalidations);
	});

	it.each([
		[
			{ code: "no_break_in_progress" },
			"timeTracking.breakInProgress.errors.breakChanged|Your break changed on another device. Your clock now shows the current state.|{}",
		],
		[
			{ code: "on_break" },
			"timeTracking.breakInProgress.errors.breakChanged|Your break changed on another device. Your clock now shows the current state.|{}",
		],
		[
			{ code: "target_not_active" },
			"timeTracking.breakInProgress.errors.workChanged|Your clock changed on another device. It now shows the current state.|{}",
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
			{ code: "access_denied" },
			"timeTracking.breakInProgress.errors.resumeNotAllowed|You cannot resume this break.|{}",
		],
		[
			{ code: "unconfirmed" },
			"timeTracking.breakInProgress.errors.resumeUnconfirmed|Resuming could not be confirmed. Check your clock before trying again.|{}",
		],
		...(["admission_window", "invalid_command", "failed"] as const).map(
			(code) =>
				[
					{ code },
					"timeTracking.breakInProgress.errors.resumeRetry|Could not resume work. Please try again.|{}",
				] as const,
		),
	])("words the %o refusal and keeps its code", async (failure, error) => {
		state.resumeBreak.mockResolvedValue({ outcome: "refused", failure });

		await expect(
			resumeBreakInProgress({ submissionId, workPeriodId, breakStart, browserTimezone: null }),
		).resolves.toEqual({ success: false, error, code: failure.code });
	});

	it("refuses a malformed break start before building a command", async () => {
		await expect(
			resumeBreakInProgress({
				submissionId,
				workPeriodId,
				breakStart: "yesterday",
				browserTimezone: null,
			}),
		).resolves.toMatchObject({ success: false, code: "invalid_command" });
		expect(state.resumeBreak).not.toHaveBeenCalled();
	});
});
