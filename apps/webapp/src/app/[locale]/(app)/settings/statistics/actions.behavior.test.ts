import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

type Answer = unknown | ((call: number) => unknown);

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	answers: {} as Record<string, unknown>,
	calls: [] as string[],
}));

/** Every query builder chain resolves to nothing; the reads run through named queries below. */
const chain: unknown = new Proxy(() => {}, {
	get: (_target, property) => (property === "then" ? undefined : () => chain),
	apply: () => chain,
});

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(
		organizationActionStubLayer(() => mocks.caller, {
			db: { select: () => chain, selectDistinct: () => chain },
			query: (name, _fn) => {
				const call = mocks.calls.filter((called) => called === name).length;
				mocks.calls.push(name);
				const answer = mocks.answers[name] as Answer;
				if (answer === undefined) {
					return Effect.die(new Error(`unexpected query ${name}`)) as never;
				}
				if (answer instanceof Error) {
					return Effect.die(answer) as never;
				}
				return Effect.succeed(typeof answer === "function" ? answer(call) : answer) as never;
			},
		}),
	);
});

const {
	getAdoptionStatistics,
	getAttentionStatistics,
	getMonthStatistics,
	getStatisticsScope,
	getWorkforceStatistics,
} = await import("./actions");

const owner: StubCaller = {
	userId: "user-owner",
	activeOrganizationId: "org-1",
	membershipRole: "owner",
	employee: null,
};
const manager: StubCaller = {
	userId: "user-manager",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "employee-manager", role: "manager", former: false },
};
const workforceAdmin: StubCaller = {
	...manager,
	employee: { id: "employee-workforce-admin", role: "admin", former: false },
};
const orgMember: StubCaller = {
	...manager,
	employee: { id: "employee-member", role: "employee", former: false },
};

const refused = { success: false, code: "AuthorizationError" };

const ORGANIZATION_ANSWERS: Record<string, unknown> = {
	"statistics.organizationTimezone": { timezone: "Europe/Berlin" },
	"statistics.staleLiveWork": [{ count: 2 }],
	"statistics.openViolations": [{ count: 1 }],
	// This month first, then the comparison window.
	"statistics.workedMinutes": (call: number) => [{ minutes: call === 0 ? 600 : 480 }],
	"statistics.completedWorkPeriods": (call: number) => [{ count: call === 0 ? 12 : 10 }],
	"statistics.approvedAbsences": [],
	"statistics.clockedIn": [{ count: 3 }],
	"statistics.manualEntryShare": [{ manualMinutes: 60, totalMinutes: 600 }],
	"statistics.coverageRoster": [],
	"statistics.rosterMovement": [{ roster: 8, joined: 2, left: 1 }],
	"statistics.teams": [{ count: 4 }],
	"statistics.setupRoster": [],
	"statistics.usersSignedIn": [{ count: 5 }],
};

describe("statistics actions", () => {
	beforeEach(() => {
		mocks.caller = owner;
		mocks.answers = { ...ORGANIZATION_ANSWERS };
		mocks.calls = [];
	});

	it("gives an org admin every group of the whole organization, with users signed in", async () => {
		await expect(getStatisticsScope()).resolves.toMatchObject({
			success: true,
			data: { scope: { organizationWide: true } },
		});
		await expect(getAttentionStatistics()).resolves.toMatchObject({
			success: true,
			data: {
				staleLiveWork: { status: "ok", value: 2 },
				openViolations: { status: "ok", value: 1 },
			},
		});
		await expect(getMonthStatistics()).resolves.toMatchObject({
			success: true,
			data: {
				workedMinutes: { status: "ok", value: { current: 600, previous: 480 } },
				absenceDays: { status: "ok", value: { current: 0, previous: 0 } },
				completedWorkPeriods: { status: "ok", value: { current: 12, previous: 10 } },
			},
		});
		await expect(getAdoptionStatistics()).resolves.toMatchObject({
			success: true,
			data: {
				coverage: { status: "ok", value: { tracked: 0, expected: 0 } },
				clockedIn: { status: "ok", value: 3 },
				manualEntryShare: { status: "ok", value: { manualMinutes: 60, totalMinutes: 600 } },
			},
		});
		await expect(getWorkforceStatistics()).resolves.toMatchObject({
			success: true,
			data: {
				roster: { status: "ok", value: { roster: 8, joined: 2, left: 1 } },
				teams: { status: "ok", value: 4 },
				incompleteSetup: { status: "ok", value: 0 },
				usersSignedIn: { status: "ok", value: 5 },
			},
		});
	});

	it("gives a workforce admin the whole organization without users signed in", async () => {
		mocks.caller = workforceAdmin;

		await expect(getStatisticsScope()).resolves.toMatchObject({
			success: true,
			data: { scope: { organizationWide: true } },
		});
		const result = await getWorkforceStatistics();
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data).not.toHaveProperty("usersSignedIn");
		expect(mocks.calls).not.toContain("statistics.usersSignedIn");
		expect(mocks.calls).not.toContain("statistics.manageableTeams");
	});

	it("scopes a manager to the teams whose settings they manage, without users signed in", async () => {
		mocks.caller = manager;
		mocks.answers["statistics.manageableTeams"] = [{ teamId: "team-a" }, { teamId: "team-b" }];

		await expect(getStatisticsScope()).resolves.toMatchObject({
			success: true,
			data: { scope: { organizationWide: false, teamCount: 2 } },
		});
		const result = await getWorkforceStatistics();
		expect(result).toMatchObject({ success: true, data: { teams: { status: "ok", value: 4 } } });
		if (!result.success) return;
		expect(result.data).not.toHaveProperty("usersSignedIn");
		expect(mocks.calls).not.toContain("statistics.usersSignedIn");
	});

	it("gives a manager without managed teams known zeros without reading any figure", async () => {
		mocks.caller = manager;
		mocks.answers["statistics.manageableTeams"] = [];

		await expect(getAttentionStatistics()).resolves.toMatchObject({
			success: true,
			data: {
				staleLiveWork: { status: "ok", value: 0 },
				openViolations: { status: "ok", value: 0 },
			},
		});
		await expect(getWorkforceStatistics()).resolves.toMatchObject({
			success: true,
			data: { roster: { status: "ok", value: { roster: 0, joined: 0, left: 0 } } },
		});
		expect(mocks.calls.every((name) => name === "statistics.manageableTeams")).toBe(true);
	});

	it("keeps a failed figure unknown while the rest of its group still loads", async () => {
		mocks.answers["statistics.staleLiveWork"] = new Error("connection reset");

		await expect(getAttentionStatistics()).resolves.toMatchObject({
			success: true,
			data: {
				staleLiveWork: { status: "failed" },
				openViolations: { status: "ok", value: 1 },
			},
		});
	});

	it("refuses an org member every statistics group", async () => {
		mocks.caller = orgMember;

		await expect(getStatisticsScope()).resolves.toMatchObject(refused);
		await expect(getAttentionStatistics()).resolves.toMatchObject(refused);
		await expect(getMonthStatistics()).resolves.toMatchObject(refused);
		await expect(getAdoptionStatistics()).resolves.toMatchObject(refused);
		await expect(getWorkforceStatistics()).resolves.toMatchObject(refused);
		expect(mocks.calls).toEqual([]);
	});

	it("refuses a former owner", async () => {
		mocks.caller = { ...owner, employee: { id: "employee-owner", role: "admin", former: true } };

		await expect(getWorkforceStatistics()).resolves.toMatchObject(refused);
	});
});
