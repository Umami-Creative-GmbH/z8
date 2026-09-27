import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";

// The Clocking module is replaced at its public `run`; its behaviour is proven on
// PostgreSQL in lib/time-tracking/clocking/clock-in.integration.test.ts. These
// tests pin only the adapter: transport to command, outcome to response.
const state = vi.hoisted(() => ({
	run: vi.fn(),
	session: { user: { id: "user-1" } } as { user: { id: string } } | null,
	employee: { id: "employee-1", organizationId: "org-1" } as Record<string, unknown> | null,
	logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/db", () => ({ db: {} }));
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
	getTranslate: async () => (key: string, fallback: string, params?: Record<string, string>) =>
		`${key}|${fallback}|${JSON.stringify(params ?? {})}`,
}));
vi.mock("./shared", async (importOriginal) => ({
	...(await importOriginal<typeof import("./shared")>()),
	logger: state.logger,
}));

const { clockIn, clockInAs } = await import("./clocking");

const submissionId = "10000000-0000-4000-8000-000000000001";
const entry = { id: submissionId, type: "clock_in", timestamp: new Date("2026-07-22T08:00:00Z") };

beforeEach(() => {
	vi.clearAllMocks();
	state.session = { user: { id: "user-1" } };
	state.employee = { id: "employee-1", organizationId: "org-1" };
	state.run.mockResolvedValue({ outcome: "executed", result: entry });
});

describe("web clock-in adapter", () => {
	it("turns the web request into a self-service clock-in command", async () => {
		await clockIn("remote", { submissionId, browserTimezone: "America/New_York" });

		expect(state.run).toHaveBeenCalledWith({
			organizationId: "org-1",
			principal: { kind: "user", userId: "user-1" },
			subject: { employeeId: "employee-1" },
			identity: { origin: "client", id: submissionId },
			channel: "web",
			at: { kind: "now" },
			zone: { device: "America/New_York", fallback: "Europe/Berlin" },
			body: { kind: "clock_in", workLocationType: "remote" },
		});
	});

	it("defaults to the office and names an unkeyed request with a server identity", async () => {
		await clockIn();

		expect(state.run).toHaveBeenCalledWith(
			expect.objectContaining({
				identity: { origin: "server", id: expect.stringMatching(/^[0-9a-f-]{36}$/) },
				zone: { device: null, fallback: "Europe/Berlin" },
				body: { kind: "clock_in", workLocationType: "office" },
			}),
		);
	});

	it("carries a device instant and channel, and a bot's derived identity", async () => {
		const instant = parseInstant("2026-07-22T08:00:00Z");

		await clockInAs(
			{ userId: "user-1", employee: state.employee as never, resolveTimezone: async () => "UTC" },
			"office",
			{ submissionId, identityOrigin: "derived", instant, deviceInfo: "discord-bot" },
		);

		expect(state.run).toHaveBeenCalledWith(
			expect.objectContaining({
				identity: { origin: "derived", id: submissionId },
				channel: "discord-bot",
				at: { kind: "occurred", instant },
				zone: { device: null, fallback: "UTC" },
			}),
		);
	});

	it.each(["executed", "replayed"])("returns the committed entry when %s", async (outcome) => {
		state.run.mockResolvedValue({ outcome, result: entry });

		await expect(clockIn("office", { submissionId })).resolves.toEqual({
			success: true,
			data: entry,
		});
	});

	it.each([
		[
			"already_clocked_in",
			{ since: parseInstant("2026-07-22T07:00:00Z") },
			{ error: "timeTracking.errors.alreadyClockedIn|You are already clocked in|{}" },
		],
		[
			"holiday_blocked",
			{ holidayName: "Closing day" },
			{
				error:
					'timeTracking.errors.holidayBlockedClockIn|Cannot clock in on {holidayName}|{"holidayName":"Closing day"}',
				holidayName: "Closing day",
			},
		],
		[
			"occupancy_conflict",
			{},
			{
				error: "timeTracking.errors.clockInOccupied|This time overlaps other recorded work|{}",
				code: "occupancy_conflict",
			},
		],
		[
			"append_review_required",
			{ requirement: {} },
			{
				error:
					"timeTracking.errors.clockInAppendReview|Your time history needs review before you can clock in. Please contact your administrator.|{}",
				code: "append_review_required",
			},
		],
		[
			"billing_required",
			{ reason: "subscription_expired" },
			{ error: "billing_required", code: "subscription_expired" },
		],
		[
			"invalid_work_location",
			{},
			{ error: "timeTracking.errors.invalidWorkLocation|Invalid work location type|{}" },
		],
		[
			"collision",
			{},
			{
				error:
					"timeTracking.errors.clockInCollision|This clock-in conflicts with an earlier request. Please refresh and try again.|{}",
			},
		],
		[
			"access_denied",
			{},
			{ error: "timeTracking.errors.clockInNotAllowed|You cannot clock in.|{}" },
		],
		...(["admission_window", "invalid_command", "failed", "unconfirmed"] as const).map(
			(code) =>
				[
					code,
					{},
					{ error: "timeTracking.errors.clockInRetry|Failed to clock in. Please try again.|{}" },
				] as const,
		),
	])("words the %s refusal in the timeTracking namespace", async (code, detail, wire) => {
		state.run.mockResolvedValue({ outcome: "refused", failure: { code, ...detail } });

		await expect(clockIn("office", { submissionId })).resolves.toEqual({
			success: false,
			...wire,
		});
	});

	it("logs operator detail and gives bots the refusal with its detail", async () => {
		const since = parseInstant("2026-07-22T07:00:00Z");
		state.run.mockResolvedValue({
			outcome: "refused",
			failure: { code: "already_clocked_in", since },
		});

		await expect(
			clockInAs(
				{ userId: "user-1", employee: state.employee as never, resolveTimezone: async () => "UTC" },
				"office",
				{ submissionId },
			),
		).resolves.toEqual({
			success: false,
			failure: "already_clocked_in",
			refusal: { code: "already_clocked_in", since },
		});

		const cause = new Error("connection reset");
		state.run.mockResolvedValue({ outcome: "refused", failure: { code: "unconfirmed", cause } });
		await clockIn("office", { submissionId });
		expect(state.logger.error).toHaveBeenCalledWith({ error: cause }, "Clock in error");
	});

	it("refuses an unauthenticated request before building a command", async () => {
		state.session = null;

		await expect(clockIn("office", { submissionId })).resolves.toEqual({
			success: false,
			error: "timeTracking.errors.notAuthenticated|Not authenticated|{}",
		});
		expect(state.run).not.toHaveBeenCalled();
	});
});
