import { Effect, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnalyticsService } from "@/lib/effect/services/analytics.service";
import type { StubCaller } from "@/test/organization-action";
import { findAnalyticsEmployeeByUserId } from "./current-employee-scope";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	teamPerformance: vi.fn(),
	vacationTrends: vi.fn(),
	workHours: vi.fn(),
	absencePatterns: vi.fn(),
	managerEffectiveness: vi.fn(),
	overtimeBurnDown: vi.fn(),
	loadRecentAnalyticsIdentity: vi.fn(),
}));

vi.mock("@/lib/analytics/recent-identity", () => ({
	loadRecentAnalyticsIdentity: mocks.loadRecentAnalyticsIdentity,
}));

vi.mock("@/lib/analytics/recent-read", () => ({
	readRecentTeamPerformance: vi.fn(),
	readRecentWorkHours: vi.fn(),
	readRecentOvertime: vi.fn(),
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	const analyticsLayer = Layer.succeed(
		AnalyticsService,
		AnalyticsService.of({
			getTeamPerformance: (params) => Effect.sync(() => mocks.teamPerformance(params)),
			getVacationTrends: (params) => Effect.sync(() => mocks.vacationTrends(params)),
			getWorkHoursAnalytics: (params) => Effect.sync(() => mocks.workHours(params)),
			getAbsencePatterns: (params) => Effect.sync(() => mocks.absencePatterns(params)),
			getManagerEffectiveness: (params) => Effect.sync(() => mocks.managerEffectiveness(params)),
			getOvertimeBurnDown: (params) => Effect.sync(() => mocks.overtimeBurnDown(params)),
		}),
	);
	return runtimeModuleOver(
		Layer.mergeAll(
			organizationActionStubLayer(() => mocks.caller),
			analyticsLayer,
		),
	);
});

const {
	getAbsencePatternsData,
	getManagerEffectivenessData,
	getOvertimeBurnDownData,
	getTeamPerformanceData,
	getVacationTrendsData,
	getWorkHoursAnalyticsData,
} = await import("./actions");

const range = {
	start: new Date("2026-03-01T00:00:00.000Z"),
	end: new Date("2026-03-31T23:59:59.999Z"),
};

const orgAdminWithoutEmployee: StubCaller = {
	userId: "user-org-admin",
	activeOrganizationId: "org-1",
	membershipRole: "admin",
	employee: null,
};

const workforceAdmin: StubCaller = {
	userId: "user-workforce-admin",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "emp-admin", role: "admin", former: false },
};

const managerCaller: StubCaller = {
	userId: "user-manager",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "emp-manager", role: "manager", former: false },
};

const plainEmployee: StubCaller = {
	userId: "user-employee",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "emp-member", role: "employee", former: false },
};

const formerOwner: StubCaller = {
	userId: "user-former-owner",
	activeOrganizationId: "org-1",
	membershipRole: "owner",
	employee: { id: "emp-former", role: "admin", former: true },
};

describe("findAnalyticsEmployeeByUserId", () => {
	it("does not fall back to another organization when no active organization is set", async () => {
		const findFirst = vi.fn();

		const employee = await findAnalyticsEmployeeByUserId(
			{ query: { employee: { findFirst } } },
			"user-1",
			null,
		);

		expect(employee).toBeNull();
		expect(findFirst).not.toHaveBeenCalled();
	});
});

describe("analytics actions unified authorization (#1955)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.caller = orgAdminWithoutEmployee;
		mocks.teamPerformance.mockReturnValue({
			teams: [],
			organizationTotal: 0,
			dateRange: range,
		});
		mocks.vacationTrends.mockReturnValue({
			overall: {
				totalDaysAllocated: 0,
				totalDaysTaken: 0,
				totalDaysRemaining: 0,
				utilizationRate: 0,
			},
			byEmployee: [],
			byMonth: [],
			patterns: { peakMonths: [], averageDaysPerRequest: 0, clusteringScore: 0 },
		});
		mocks.workHours.mockReturnValue({
			byEmployee: [],
			distribution: [],
			totalHours: 0,
			averageHoursPerDay: 0,
		});
		mocks.absencePatterns.mockReturnValue({
			summary: {
				totalAbsences: 0,
				totalDays: 0,
				avgDaysPerAbsence: 0,
				absenceRate: 0,
			},
			byType: [],
			byTeam: [],
			patterns: {
				sickLeavePatterns: {
					avgDuration: 0,
					peakMonths: [],
					frequentEmployees: [],
				},
				vacationClustering: { score: 0, hotspots: [] },
			},
			timeline: [],
		});
		mocks.managerEffectiveness.mockReturnValue({
			approvalMetrics: {
				avgResponseTime: 0,
				avgDecisionTimeHours: 0,
				totalApprovals: 0,
				totalRejections: 0,
				approvalRate: 0,
				pendingSlaWarnings: 0,
			},
			byManager: [],
			byTeam: [],
			byType: [],
			responseTimeDistribution: [],
			trends: [],
		});
		mocks.overtimeBurnDown.mockReturnValue({
			summary: {
				currentOvertimeHours: 0,
				startOvertimeHours: 0,
				changeHours: 0,
				changePercent: 0,
				trendDirection: "flat",
				employeesWithOvertime: 0,
				totalEmployees: 0,
			},
			weeklySeries: [],
			byTeam: [],
			byManager: [],
			byCostCenter: [],
			filterOptions: { teams: [], managers: [], costCenters: [] },
		});
		mocks.loadRecentAnalyticsIdentity.mockImplementation(
			(
				actor: {
					id: string | null;
					userId: string;
					organizationId: string;
					role: "admin" | "manager";
				},
				request: { dateRange: typeof range },
			) =>
				Effect.succeed({
					identity: {
						calculationVersion: "recent-analytics-v1" as const,
						organizationId: actor.organizationId,
						userId: actor.userId,
						actorEmployeeId: actor.id,
						scope:
							actor.role === "admin"
								? ({ role: "admin" } as const)
								: ({
										role: "manager",
										managerEmployeeId: actor.id ?? "",
									} as const),
						visibleEmployeeIds: [],
						revision: "rev-1",
						cacheable: false,
					},
					request,
				}),
		);
	});

	it("allows an org admin without an employee record to load every analytics action org-wide", async () => {
		mocks.caller = orgAdminWithoutEmployee;

		expect(await getTeamPerformanceData(range)).toMatchObject({ success: true });
		expect(await getWorkHoursAnalyticsData(range)).toMatchObject({
			success: true,
		});
		expect(await getOvertimeBurnDownData(range)).toMatchObject({
			success: true,
		});
		expect(await getVacationTrendsData(range)).toMatchObject({ success: true });
		expect(await getAbsencePatternsData(range)).toMatchObject({
			success: true,
		});
		expect(await getManagerEffectivenessData(range)).toMatchObject({
			success: true,
		});

		expect(mocks.loadRecentAnalyticsIdentity).toHaveBeenCalledWith(
			{
				id: null,
				userId: "user-org-admin",
				organizationId: "org-1",
				role: "admin",
			},
			expect.objectContaining({ kind: "team" }),
		);
		expect(mocks.teamPerformance).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				scope: { role: "admin" },
			}),
		);
		expect(mocks.absencePatterns).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				scope: { role: "admin" },
			}),
		);
	});

	it("grants a workforce admin org-wide scope", async () => {
		mocks.caller = workforceAdmin;

		expect(await getAbsencePatternsData(range)).toMatchObject({
			success: true,
		});
		expect(mocks.absencePatterns).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				scope: { role: "admin" },
			}),
		);
	});

	it("scopes a manager to their managed employees", async () => {
		mocks.caller = managerCaller;

		expect(await getTeamPerformanceData(range)).toMatchObject({ success: true });
		expect(await getAbsencePatternsData(range)).toMatchObject({
			success: true,
		});

		expect(mocks.loadRecentAnalyticsIdentity).toHaveBeenCalledWith(
			{
				id: "emp-manager",
				userId: "user-manager",
				organizationId: "org-1",
				role: "manager",
			},
			expect.objectContaining({ kind: "team" }),
		);
		expect(mocks.absencePatterns).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				scope: { role: "manager", managerEmployeeId: "emp-manager" },
			}),
		);
	});

	it("refuses a plain employee every analytics action", async () => {
		mocks.caller = plainEmployee;

		for (const result of [
			await getTeamPerformanceData(range),
			await getWorkHoursAnalyticsData(range),
			await getOvertimeBurnDownData(range),
			await getVacationTrendsData(range),
			await getAbsencePatternsData(range),
			await getManagerEffectivenessData(range),
		]) {
			expect(result).toMatchObject({
				success: false,
				code: "AuthorizationError",
			});
		}
		expect(mocks.teamPerformance).not.toHaveBeenCalled();
		expect(mocks.absencePatterns).not.toHaveBeenCalled();
	});

	it("refuses a former owner every analytics action", async () => {
		mocks.caller = formerOwner;

		expect(await getTeamPerformanceData(range)).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(await getManagerEffectivenessData(range)).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
	});
});
