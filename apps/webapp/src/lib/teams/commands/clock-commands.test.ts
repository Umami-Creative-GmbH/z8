import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BotCommandContext } from "@/lib/bot-platform/types";
import { parseInstant, systemClock } from "@/lib/datetime/temporal-core";

// The shared live clock core is replaced here; its persistence, append and
// rollback guarantees are proven through the real adapters on PostgreSQL in
// lib/bot-platform/clock-commands.integration.test.ts. These tests pin how the
// shared bot commands authorize the actor, call the core and word each outcome.
const state = vi.hoisted(() => ({
	clockInAs: vi.fn(),
	clockOutAs: vi.fn(),
	authorized: vi.fn(),
	employee: vi.fn(),
}));

vi.mock("@/app/[locale]/(app)/time-tracking/actions/clocking", () => ({
	clockInAs: state.clockInAs,
	clockOutAs: state.clockOutAs,
}));
vi.mock("@/lib/integrations/resolve-command-actor", () => ({
	resolveCommandActorEmployee: state.authorized,
}));
vi.mock("@/db", () => ({
	db: {
		query: {
			employee: { findFirst: state.employee },
		},
	},
}));
vi.mock("@/lib/bot-platform/i18n", () => ({
	getBotTranslate:
		async () => (_key: string, fallback: string, params?: Record<string, string | number>) =>
			fallback.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? "")),
}));
vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const { clockInCommand } = await import("./clock-in");
const { clockOutCommand } = await import("./clock-out");

const employeeRow = {
	id: "employee-1",
	organizationId: "org-1",
	userId: "user-1",
	teamId: null,
	isActive: true,
};

const temporal = {
	effectiveTimezone: "Europe/Berlin",
	organizationTimezone: "Europe/Berlin",
	locale: "en",
	timezone: "Europe/Berlin",
	timeFormat: "24h" as const,
	now: parseInstant("2026-07-22T09:05:00Z"),
	clock: systemClock,
};

function context(overrides: Partial<BotCommandContext> = {}): BotCommandContext {
	return {
		platform: "slack",
		organizationId: "org-1",
		employeeId: "employee-1",
		userId: "user-1",
		platformUserId: "U1",
		config: {
			organizationId: "org-1",
			enableApprovals: true,
			enableCommands: true,
			enableDailyDigest: false,
			enableEscalations: false,
			digestTime: "08:00",
			digestTimezone: "UTC",
			escalationTimeoutHours: 24,
		},
		args: [],
		locale: "en",
		temporal,
		...overrides,
	};
}

const committedClockOut = {
	success: true,
	data: { id: "entry-1", type: "clock_out", timestamp: new Date("2026-07-22T09:00:40Z") },
	durationMinutes: 61,
};

beforeEach(() => {
	vi.clearAllMocks();
	state.authorized.mockResolvedValue({ id: "employee-1", isActive: true });
	state.employee.mockResolvedValue(employeeRow);
	state.clockOutAs.mockResolvedValue(committedClockOut);
});

describe("bot clock-out command", () => {
	it("closes through the shared core with a fresh operation per invocation", async () => {
		await clockOutCommand.handler(context({ platform: "telegram" }));
		await clockOutCommand.handler(context({ platform: "telegram" }));

		const [first, second] = state.clockOutAs.mock.calls;
		expect(first?.[0]).toMatchObject({ userId: "user-1", employee: employeeRow });
		await expect(first?.[0].resolveTimezone()).resolves.toBe("Europe/Berlin");
		// Omitted attribution preserves the period's project and category.
		expect(first?.slice(1, 3)).toEqual([undefined, undefined]);
		// A server identity: it names the operation but is never replayed.
		expect(first?.[3]).toEqual({
			submissionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
			identityOrigin: "server",
			deviceInfo: "telegram-bot",
		});
		expect(first).toHaveLength(4);
		// An unkeyed repeat is a new command, never a replay of the first.
		expect(second?.[3].submissionId).not.toBe(first?.[3].submissionId);
	});

	it("reports the committed end time and stored minutes", async () => {
		await expect(clockOutCommand.handler(context())).resolves.toEqual({
			type: "text",
			text: "Clocked out at 11:00. Duration: 1h 1m.",
		});
	});

	it("keeps a committed reply when formatting fails", async () => {
		const broken = context({ temporal: { ...temporal, timezone: "Not/AZone" } });

		await expect(clockOutCommand.handler(broken)).resolves.toEqual({
			type: "text",
			text: "Clocked out.",
		});
	});

	it("does not clock an employee outside the command's organization", async () => {
		state.authorized.mockResolvedValue({ id: "employee-in-other-org", isActive: true });

		await expect(clockOutCommand.handler(context())).resolves.toEqual({
			type: "text",
			text: "Employee profile not found.",
		});
		expect(state.authorized).toHaveBeenCalledWith("user-1", "org-1");
		expect(state.clockOutAs).not.toHaveBeenCalled();
	});

	it.each([
		["not_clocked_in", "You are not currently clocked in."],
		["invalid_interval", "Clock-out must be after clock-in."],
		["project_not_allowed", "Cannot assign to this project."],
		["access_denied", "Employee profile not found."],
		[
			"billing_required",
			"Billing is required to continue using time tracking. Ask an organization admin to update billing.",
		],
		[
			"append_review_required",
			"Your time history needs review before you can clock out. Please contact your administrator.",
		],
		[
			"unconfirmed",
			"Your clock-out could not be confirmed. Check your status before trying again.",
		],
		["failed", "Could not clock out. Please try again."],
	])("words the %s outcome", async (failure, text) => {
		state.clockOutAs.mockResolvedValue({ success: false, failure, refusal: { code: failure } });

		await expect(clockOutCommand.handler(context())).resolves.toEqual({ type: "text", text });
	});
});

describe("bot clock-in command", () => {
	it("starts work through the shared core and reports the committed time", async () => {
		state.clockInAs.mockResolvedValue({
			success: true,
			data: { id: "entry-0", type: "clock_in", timestamp: new Date("2026-07-22T08:00:00Z") },
		});

		await expect(clockInCommand.handler(context({ platform: "discord" }))).resolves.toEqual({
			type: "text",
			text: "Clocked in at 10:00.",
		});
		expect(state.clockInAs).toHaveBeenCalledWith(
			expect.objectContaining({ userId: "user-1", employee: employeeRow }),
			"office",
			{
				// No invocation ID: a server identity, never replayed.
				submissionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
				identityOrigin: "server",
				deviceInfo: "discord-bot",
			},
		);
	});

	it("says since when work runs from the refusal, without another read", async () => {
		state.clockInAs.mockResolvedValue({
			success: false,
			failure: "already_clocked_in",
			refusal: { code: "already_clocked_in", since: parseInstant("2026-07-22T08:00:00Z") },
		});

		await expect(clockInCommand.handler(context())).resolves.toEqual({
			type: "text",
			text: "You are already clocked in since 10:00 (1h 5m).",
		});
	});

	it("words a billing refusal from the shared core's guard", async () => {
		state.clockInAs.mockResolvedValue({
			success: false,
			failure: "billing_required",
			refusal: { code: "billing_required", reason: "subscription_required" },
		});

		await expect(clockInCommand.handler(context())).resolves.toEqual({
			type: "text",
			text: "Billing is required to continue using time tracking. Ask an organization admin to update billing.",
		});
	});

	it("words an unconfirmed clock-in without inviting a blind retry", async () => {
		state.clockInAs.mockResolvedValue({
			success: false,
			failure: "unconfirmed",
			refusal: { code: "unconfirmed" },
		});

		await expect(clockInCommand.handler(context())).resolves.toEqual({
			type: "text",
			text: "Your clock-in could not be confirmed. Check your status before trying again.",
		});
	});
});

describe("bot clock operation identity", () => {
	it("derives one identity per platform invocation, so a redelivery replays", async () => {
		state.clockInAs.mockResolvedValue({ success: false, failure: "failed", refusal: { code: "failed" } });
		const invocation = context({ platform: "discord", invocationId: "1300000000000000001" });

		await clockInCommand.handler(invocation);
		await clockInCommand.handler(invocation);
		await clockInCommand.handler({ ...invocation, invocationId: "1300000000000000002" });
		await clockOutCommand.handler(invocation);

		const [first, redelivered, next] = state.clockInAs.mock.calls.map((call) => call[2]);
		expect(first).toEqual({
			submissionId: expect.stringMatching(
				/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
			),
			identityOrigin: "derived",
			deviceInfo: "discord-bot",
		});
		expect(redelivered).toEqual(first);
		expect(next.submissionId).not.toBe(first.submissionId);
		// The same invocation never names both a clock-in and a clock-out.
		const clockOut = state.clockOutAs.mock.calls[0]?.[3];
		expect(clockOut).toMatchObject({ identityOrigin: "derived" });
		expect(clockOut.submissionId).not.toBe(first.submissionId);
	});

	it("scopes a derived identity to its platform and organization", async () => {
		state.clockInAs.mockResolvedValue({ success: false, failure: "failed", refusal: { code: "failed" } });

		await clockInCommand.handler(context({ platform: "telegram", invocationId: "1:42" }));
		await clockInCommand.handler(context({ platform: "discord", invocationId: "1:42" }));
		await clockInCommand.handler(
			context({ platform: "telegram", invocationId: "1:42", organizationId: "org-2" }),
		);

		const ids = state.clockInAs.mock.calls.map((call) => call[2].submissionId);
		expect(new Set(ids).size).toBe(ids.length);
	});
});
