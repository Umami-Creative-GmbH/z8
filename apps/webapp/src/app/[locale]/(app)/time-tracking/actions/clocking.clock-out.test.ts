import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { ClockOutcome } from "@/lib/time-tracking/clocking/types";

// The Clocking module is replaced at its public `run`; its behaviour is proven on
// PostgreSQL in lib/time-tracking/clocking/clock-out.integration.test.ts. These
// tests pin only the adapter: transport to command, outcome to response.
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
	getUserTimezone: async () => "Europe/Berlin",
}));
vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (key: string, fallback: string) => `${key}|${fallback}`,
}));
vi.mock("./shared", async (importOriginal) => ({
	...(await importOriginal<typeof import("./shared")>()),
	logger: state.logger,
}));

const { clockOut, clockOutAs } = await import("./clocking");

const submissionId = "10000000-0000-4000-8000-000000000001";
const entry = { id: submissionId, type: "clock_out", timestamp: new Date("2026-07-22T09:00:00Z") };

function executed(overrides: Partial<Extract<ClockOutcome, { outcome: "executed" }>> = {}) {
	return { outcome: "executed", result: entry, durationMinutes: 60, ...overrides };
}

beforeEach(() => {
	vi.clearAllMocks();
	state.session = { user: { id: "user-1" } };
	state.employee = { id: "employee-1", organizationId: "org-1" };
	state.run.mockResolvedValue(executed());
});

describe("web clock-out adapter", () => {
	it("turns the web request into a self-service clock-out command", async () => {
		await clockOut(undefined, null, { submissionId, browserTimezone: "America/New_York" });

		expect(state.run).toHaveBeenCalledWith({
			organizationId: "org-1",
			principal: { kind: "user", userId: "user-1" },
			subject: { employeeId: "employee-1" },
			identity: { origin: "client", id: submissionId },
			channel: "web",
			at: { kind: "now" },
			zone: { device: "America/New_York", fallback: "Europe/Berlin" },
			body: {
				kind: "clock_out",
				project: { kind: "preserve" },
				workCategory: { kind: "clear" },
			},
		});
	});

	it("carries a device instant and channel, and a bot's server identity", async () => {
		const instant = parseInstant("2026-07-22T09:00:00Z");

		await clockOutAs(
			{
				userId: "user-1",
				employee: state.employee as never,
				resolveTimezone: async () => "UTC",
			},
			"project-1",
			undefined,
			{ submissionId, identityOrigin: "server", instant, deviceInfo: "slack-bot" },
		);

		expect(state.run).toHaveBeenCalledWith(
			expect.objectContaining({
				identity: { origin: "server", id: submissionId },
				channel: "slack-bot",
				at: { kind: "occurred", instant },
				zone: { device: null, fallback: "UTC" },
				body: expect.objectContaining({ project: { kind: "replace", id: "project-1" } }),
			}),
		);
	});

	it("returns the committed entry and revalidates only an executed closure", async () => {
		await expect(clockOut(undefined, undefined, { submissionId })).resolves.toEqual({
			success: true,
			data: entry,
		});
		expect(state.revalidatePath).toHaveBeenCalledWith("/time-tracking");

		state.revalidatePath.mockClear();
		state.run.mockResolvedValue({ ...executed(), outcome: "replayed" });
		await expect(clockOut(undefined, undefined, { submissionId })).resolves.toEqual({
			success: true,
			data: entry,
		});
		expect(state.revalidatePath).not.toHaveBeenCalled();
	});

	it.each([
		["not_clocked_in", "timeTracking.errors.notClockedIn|You are not currently clocked in"],
		["project_not_allowed", "timeTracking.errors.projectNotAllowed|Cannot assign to this project"],
		[
			"work_category_not_allowed",
			"timeTracking.errors.workCategoryNotAllowed|Cannot assign to this work category",
		],
		[
			"invalid_interval",
			"timeTracking.errors.clockOutBeforeClockIn|Clock-out must be after clock-in",
		],
		[
			"collision",
			"timeTracking.errors.clockOutCollision|This clock-out conflicts with an earlier request or changed work. Please refresh and try again.",
		],
		[
			"append_review_required",
			"timeTracking.errors.clockOutAppendReview|Your time history needs review before you can clock out. Please contact your administrator.",
		],
		["access_denied", "timeTracking.errors.clockOutNotAllowed|You cannot clock out this work."],
		[
			"admission_window",
			"timeTracking.errors.clockOutRetry|Failed to clock out. Please try again.",
		],
		["invalid_command", "timeTracking.errors.clockOutRetry|Failed to clock out. Please try again."],
		["failed", "timeTracking.errors.clockOutRetry|Failed to clock out. Please try again."],
		["unconfirmed", "timeTracking.errors.clockOutRetry|Failed to clock out. Please try again."],
	])("words the %s refusal in the timeTracking namespace", async (code, error) => {
		state.run.mockResolvedValue({ outcome: "refused", failure: { code } });

		await expect(clockOut(undefined, undefined, { submissionId })).resolves.toEqual({
			success: false,
			error,
		});
		expect(state.revalidatePath).not.toHaveBeenCalled();
	});

	it("keeps the billing refusal's code for the billing banner", async () => {
		state.run.mockResolvedValue({
			outcome: "refused",
			failure: { code: "billing_required", reason: "subscription_expired" },
		});

		await expect(clockOut(undefined, undefined, { submissionId })).resolves.toEqual({
			success: false,
			error: "billing_required",
			code: "subscription_expired",
		});
	});

	it("logs operator detail and gives the shared core the failure code", async () => {
		const requirement = { reasons: ["position_tip_changed"] };
		state.run.mockResolvedValue({
			outcome: "refused",
			failure: { code: "append_review_required", requirement },
		});

		await expect(
			clockOutAs(
				{ userId: "user-1", employee: state.employee as never, resolveTimezone: async () => "UTC" },
				undefined,
				undefined,
				{ submissionId },
			),
		).resolves.toEqual({
			success: false,
			failure: "append_review_required",
			refusal: { code: "append_review_required", requirement },
		});
		expect(state.logger.warn).toHaveBeenCalledWith(
			{ appendReviewRequirement: requirement },
			"Clock out held for append history review",
		);
	});

	it("refuses an unauthenticated request before building a command", async () => {
		state.session = null;

		await expect(clockOut(undefined, undefined, { submissionId })).resolves.toEqual({
			success: false,
			error: "timeTracking.errors.notAuthenticated|Not authenticated",
		});
		expect(state.run).not.toHaveBeenCalled();
	});
});
