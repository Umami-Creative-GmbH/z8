import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	/** The CASL actions on `PayrollPeriod` the caller's ability grants. */
	granted: [] as string[],
	closeMonth: vi.fn(),
	reopenMonth: vi.fn(),
	saveSettings: vi.fn(),
	monthCloseWarnings: vi.fn(),
	monthClosureStatuses: vi.fn(),
	select: vi.fn(),
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { Effect } = await import("effect");
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	const { ORGANIZATION_ABILITY_QUERY } = await import("@/lib/authorization/organization-ability");
	return runtimeModuleOver(
		organizationActionStubLayer(() => mocks.caller, {
			db: { select: mocks.select },
			query: (name, fn) =>
				name === ORGANIZATION_ABILITY_QUERY
					? (Effect.succeed({
							can: (action: string, subject: string) =>
								subject === "PayrollPeriod" && mocks.granted.includes(action),
						}) as never)
					: Effect.promise(fn),
		}),
	);
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/time-tracking/closed-months/store", () => ({
	closeMonth: mocks.closeMonth,
	closedMonthHistory: vi.fn(async () => []),
	monthClosureStatuses: mocks.monthClosureStatuses,
}));

vi.mock("@/lib/time-tracking/closed-months/reopen-month", () => ({
	reopenMonthAttachingWork: mocks.reopenMonth,
}));

vi.mock("@/lib/time-tracking/closed-months/notifications", () => ({
	notifyReopening: vi.fn(async () => 0),
}));

vi.mock("@/lib/time-tracking/closed-months/close-warnings", () => ({
	monthCloseWarnings: mocks.monthCloseWarnings,
}));

vi.mock("@/lib/time-tracking/closed-months/automatic-close", () => ({
	loadClosedMonthSettings: vi.fn(),
	saveClosedMonthSettings: mocks.saveSettings,
}));

const {
	closeMonthAction,
	getClosedMonthsOverview,
	getMonthCloseContext,
	getMonthCloseWarningsAction,
	getMonthClosureStatuses,
	reopenMonthAction,
	saveClosedMonthSettingsAction,
} = await import("./actions");

const member: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "employee-1", role: "employee", former: false },
};

const close = { month: "2026-05", scope: { kind: "organization" as const } };

/** Every action, called with valid input. */
const calls = {
	getClosedMonthsOverview: () => getClosedMonthsOverview(),
	closeMonthAction: () => closeMonthAction(close),
	getMonthCloseWarningsAction: () => getMonthCloseWarningsAction(close),
	reopenMonthAction: () =>
		reopenMonthAction({ month: "2026-05", scope: { kind: "all" }, reason: "Fix" }),
	getMonthClosureStatuses: () => getMonthClosureStatuses({ months: ["2026-05"] }),
	saveClosedMonthSettingsAction: () =>
		saveClosedMonthSettingsAction({ autoCloseEnabled: true, autoCloseAfterDays: 5 }),
	getMonthCloseContext: () => getMonthCloseContext(),
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.caller = member;
	mocks.granted = [];
	mocks.closeMonth.mockResolvedValue({ kind: "closed" });
	mocks.reopenMonth.mockResolvedValue({ kind: "nothing_to_reopen", month: "2026-05" });
	mocks.monthCloseWarnings.mockResolvedValue([]);
	mocks.monthClosureStatuses.mockResolvedValue([]);
	mocks.saveSettings.mockImplementation(async ({ settings }) => settings);
});

describe("closed month actions", () => {
	it.each(
		Object.entries(calls).flatMap(([name, call]) => [
			[name, "a pending membership", { ...member, membershipRole: null }, call],
			[
				name,
				"a former employee",
				{ ...member, employee: { id: "employee-1", role: "employee" as const, former: true } },
				call,
			],
		]),
	)("%s refuses %s", async (_name, _case, caller, call) => {
		mocks.caller = caller as StubCaller;
		mocks.granted = ["close", "reopen"];

		expect(await (call as () => Promise<unknown>)()).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(mocks.closeMonth).not.toHaveBeenCalled();
		expect(mocks.reopenMonth).not.toHaveBeenCalled();
		expect(mocks.saveSettings).not.toHaveBeenCalled();
		expect(mocks.monthClosureStatuses).not.toHaveBeenCalled();
	});

	it("refuses a member whose ability does not grant closing months", async () => {
		mocks.granted = ["reopen"];

		expect(await closeMonthAction(close)).toMatchObject({
			success: false,
			code: "AuthorizationError",
			error: "You are not allowed to close months",
		});
		expect(mocks.closeMonth).not.toHaveBeenCalled();
	});

	it("refuses reopening without the reopen permission", async () => {
		mocks.granted = ["close"];

		expect(
			await reopenMonthAction({ month: "2026-05", scope: { kind: "all" }, reason: "Fix" }),
		).toMatchObject({ success: false, error: "You are not allowed to reopen months" });
		expect(mocks.reopenMonth).not.toHaveBeenCalled();
	});

	it("closes the month in the active organization for a member a custom role lets close", async () => {
		mocks.granted = ["close"];

		expect(await closeMonthAction(close)).toEqual({ success: true, data: { kind: "closed" } });
		expect(mocks.closeMonth).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				organizationId: "org-1",
				month: "2026-05",
				scope: { kind: "organization" },
				actor: { kind: "user", userId: "user-1" },
			}),
		);
	});

	it("rejects a month that is not a calendar month before closing", async () => {
		mocks.granted = ["close"];

		expect(await closeMonthAction({ month: "May", scope: { kind: "organization" } })).toMatchObject(
			{ success: false, code: "ValidationError", error: "Choose a calendar month" },
		);
		expect(mocks.closeMonth).not.toHaveBeenCalled();
	});

	it("rejects an unknown close scope", async () => {
		mocks.granted = ["close"];

		expect(
			await closeMonthAction({ month: "2026-05", scope: { kind: "galaxy" } as never }),
		).toMatchObject({ success: false, error: "Choose what to close for" });
	});

	it("offers no close to a member without the permission", async () => {
		expect(await getMonthCloseContext()).toEqual({
			success: true,
			data: { canClose: false, teams: [], locations: [] },
		});
	});

	it("reads month statuses for any org member", async () => {
		mocks.monthClosureStatuses.mockResolvedValue([{ month: "2026-05" }]);

		expect(await getMonthClosureStatuses({ months: ["2026-05"] })).toEqual({
			success: true,
			data: [{ month: "2026-05" }],
		});
		expect(mocks.monthClosureStatuses).toHaveBeenCalledWith(expect.anything(), {
			organizationId: "org-1",
			months: ["2026-05"],
			employeeIds: undefined,
		});
	});
});
