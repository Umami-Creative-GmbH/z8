import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundError } from "@/lib/effect/errors";
import type { StubCaller } from "@/test/organization-action";

const MANAGED_SUBAREA = "11111111-1111-4111-8111-111111111111";
const OTHER_SUBAREA = "22222222-2222-4222-8222-222222222222";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	subareaAssignments: [] as Array<{ subareaId: string }>,
	ruleTarget: null as { id: string; subareaId: string } | null,
	findRuleTarget: vi.fn(),
	coverageService: {
		getCoverageRules: vi.fn(),
		getCoverageRuleById: vi.fn(),
		createCoverageRule: vi.fn(),
		updateCoverageRule: vi.fn(),
		deleteCoverageRule: vi.fn(),
		getTargetHeatmapData: vi.fn(),
		validateScheduleCanPublish: vi.fn(),
		getCoverageSettings: vi.fn(),
		updateCoverageSettings: vi.fn(),
	},
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/effect/runtime", async () => {
	const { Layer } = await import("effect");
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	const { CoverageService } = await import("@/lib/effect/services/coverage.service");
	const db = {
		query: {
			subareaEmployee: { findMany: async () => mocks.subareaAssignments },
			coverageRule: {
				findFirst: async (query: unknown) => {
					mocks.findRuleTarget(query);
					return mocks.ruleTarget;
				},
			},
			organization: { findFirst: async () => ({ timezone: "Europe/Berlin" }) },
		},
	};
	return runtimeModuleOver(
		Layer.mergeAll(
			organizationActionStubLayer(() => mocks.caller, { db }),
			Layer.succeed(CoverageService, mocks.coverageService as never),
		),
	);
});

const {
	createCoverageRule,
	deleteCoverageRule,
	getCoverageRule,
	getCoverageRules,
	getCoverageSettings,
	getTargetHeatmapData,
	updateCoverageRule,
	updateCoverageSettings,
	validateScheduleForPublish,
} = await import("./actions");

const orgAdmin: StubCaller = {
	userId: "user-admin",
	activeOrganizationId: "org-1",
	membershipRole: "admin",
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

const newRule = {
	subareaId: OTHER_SUBAREA,
	dayOfWeek: "monday" as const,
	startTime: "09:00",
	endTime: "17:00",
	minimumStaffCount: 2,
};

const refused = { success: false, code: "AuthorizationError" };

beforeEach(() => {
	vi.clearAllMocks();
	mocks.caller = manager;
	mocks.subareaAssignments = [{ subareaId: MANAGED_SUBAREA }];
	mocks.ruleTarget = { id: "rule-1", subareaId: MANAGED_SUBAREA };
	for (const fn of Object.values(mocks.coverageService)) {
		fn.mockReturnValue(Effect.succeed({ id: "rule-1", subareaId: MANAGED_SUBAREA }));
	}
	mocks.coverageService.getCoverageRules.mockReturnValue(
		Effect.succeed([
			{ id: "rule-1", subareaId: MANAGED_SUBAREA },
			{ id: "rule-2", subareaId: OTHER_SUBAREA },
		]),
	);
});

describe("coverage rule access", () => {
	it("refuses an org member every coverage rule action", async () => {
		mocks.caller = orgMember;

		await expect(getCoverageRules({})).resolves.toMatchObject(refused);
		await expect(getCoverageRule({ ruleId: "rule-1" })).resolves.toMatchObject(refused);
		await expect(
			createCoverageRule({ ...newRule, subareaId: MANAGED_SUBAREA }),
		).resolves.toMatchObject(refused);
		await expect(
			updateCoverageRule({ ruleId: "rule-1", data: { minimumStaffCount: 3 } }),
		).resolves.toMatchObject(refused);
		await expect(deleteCoverageRule({ ruleId: "rule-1" })).resolves.toMatchObject(refused);
		await expect(
			getTargetHeatmapData({ startDate: "2026-01-05", endDateExclusive: "2026-01-12" }),
		).resolves.toMatchObject(refused);
		expect(mocks.coverageService.createCoverageRule).not.toHaveBeenCalled();
		expect(mocks.coverageService.deleteCoverageRule).not.toHaveBeenCalled();
	});

	it("refuses a scoped manager the org-wide coverage settings and publish check", async () => {
		await expect(getCoverageSettings()).resolves.toMatchObject(refused);
		await expect(updateCoverageSettings({ allowPublishWithGaps: false })).resolves.toMatchObject(
			refused,
		);
		await expect(
			validateScheduleForPublish({
				startDate: new Date("2026-01-01T00:00:00.000Z"),
				endDate: new Date("2026-01-07T00:00:00.000Z"),
			}),
		).resolves.toMatchObject(refused);
		expect(mocks.coverageService.updateCoverageSettings).not.toHaveBeenCalled();
	});

	it("lets an org admin read and change the coverage settings", async () => {
		mocks.caller = orgAdmin;

		await expect(getCoverageSettings()).resolves.toMatchObject({ success: true });
		await expect(updateCoverageSettings({ allowPublishWithGaps: true })).resolves.toMatchObject({
			success: true,
		});
		expect(mocks.coverageService.updateCoverageSettings).toHaveBeenCalledWith("org-1", {
			allowPublishWithGaps: true,
			updatedBy: "user-admin",
		});
	});

	it("refuses a workforce admin, whose employee role is not manager, as before", async () => {
		mocks.caller = workforceAdmin;

		await expect(getCoverageRules({})).resolves.toMatchObject(refused);
	});

	it("refuses a manager without an assigned subarea", async () => {
		mocks.subareaAssignments = [];

		await expect(getCoverageRules({})).resolves.toMatchObject(refused);
	});
});

describe("coverage rule manager scope", () => {
	it("lists only the rules of the manager's subareas", async () => {
		const result = await getCoverageRules({});

		expect(result).toEqual({
			success: true,
			data: [{ id: "rule-1", subareaId: MANAGED_SUBAREA }],
		});
		expect(mocks.coverageService.getCoverageRules).toHaveBeenCalledWith("org-1", undefined);
	});

	it("refuses creating a rule outside the manager's subareas", async () => {
		await expect(createCoverageRule(newRule)).resolves.toMatchObject(refused);
		expect(mocks.coverageService.createCoverageRule).not.toHaveBeenCalled();
	});

	it("creates a rule in the manager's subarea for the session's organization", async () => {
		const result = await createCoverageRule({ ...newRule, subareaId: MANAGED_SUBAREA });

		expect(result.success).toBe(true);
		expect(mocks.coverageService.createCoverageRule).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				subareaId: MANAGED_SUBAREA,
				priority: 0,
				createdBy: "user-manager",
			}),
		);
	});

	it("refuses moving a rule to a subarea outside the manager's scope", async () => {
		await expect(
			updateCoverageRule({ ruleId: "rule-1", data: { subareaId: OTHER_SUBAREA } }),
		).resolves.toMatchObject(refused);
		expect(mocks.coverageService.updateCoverageRule).not.toHaveBeenCalled();
	});

	it("refuses deleting a rule outside the manager's scope", async () => {
		mocks.ruleTarget = { id: "rule-2", subareaId: OTHER_SUBAREA };

		await expect(deleteCoverageRule({ ruleId: "rule-2" })).resolves.toMatchObject(refused);
		expect(mocks.coverageService.deleteCoverageRule).not.toHaveBeenCalled();
	});

	it("limits the heatmap to the manager's subareas", async () => {
		await getTargetHeatmapData({
			startDate: "2026-01-05",
			endDateExclusive: "2026-01-12",
			subareaIds: [MANAGED_SUBAREA, OTHER_SUBAREA],
		});

		expect(mocks.coverageService.getTargetHeatmapData).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				timezone: "Europe/Berlin",
				subareaIds: [MANAGED_SUBAREA],
			}),
		);
	});
});

describe("coverage rules of another organization", () => {
	it("reads another organization's rule as not found", async () => {
		mocks.caller = orgAdmin;
		mocks.ruleTarget = null;

		const result = await updateCoverageRule({
			ruleId: "rule-elsewhere",
			data: { minimumStaffCount: 3 },
		});

		expect(result).toMatchObject({ success: false, code: "NotFoundError" });
		expect(mocks.coverageService.updateCoverageRule).not.toHaveBeenCalled();
	});
});

describe("coverage rule typed service failures", () => {
	it("returns the typed failure's message and code to the caller", async () => {
		mocks.caller = orgAdmin;
		mocks.coverageService.deleteCoverageRule.mockReturnValue(
			Effect.fail(
				new NotFoundError({
					message: "Coverage rule not found",
					entityType: "coverage_rule",
					entityId: "rule-1",
				}),
			),
		);

		const result = await deleteCoverageRule({ ruleId: "rule-1" });

		expect(result).toMatchObject({
			success: false,
			error: "Coverage rule not found",
			code: "NotFoundError",
		});
	});
});
