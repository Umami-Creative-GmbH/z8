import { Effect, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EffectiveContractOnDay } from "@/lib/contracts/types";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { DatabaseError } from "@/lib/effect/errors";
import { DatabaseService } from "./database.service";

const mockState = vi.hoisted(() => ({
	resolveEffectiveContractOnDay: vi.fn(),
	loadEffectiveWorkPolicies: vi.fn(),
	loadOrganizationTimezone: vi.fn(),
	loadActiveOrganizationDefaultPolicyId: vi.fn(),
}));

vi.mock("@/lib/contracts/resolve-contract", () => ({
	resolveEffectiveContractOnDay: mockState.resolveEffectiveContractOnDay,
}));

vi.mock("@/lib/work-policy/effective-work-policies", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/work-policy/effective-work-policies")>();
	return {
		...actual,
		loadEffectiveWorkPolicies: mockState.loadEffectiveWorkPolicies,
	};
});

vi.mock("@/lib/timezone/load-organization-timezone", () => ({
	loadOrganizationTimezone: mockState.loadOrganizationTimezone,
}));

vi.mock("@/lib/work-policy/policy-queries", () => ({
	loadActiveOrganizationDefaultPolicyId: mockState.loadActiveOrganizationDefaultPolicyId,
}));

import { WorkPolicyService, WorkPolicyServiceLive } from "./work-policy.service";

function makeContractWithPolicy(options: {
	policyId: string;
	policyVersionId?: string | null;
	policyName: string;
	regulated?: boolean;
	assignmentType?: "organization" | "team" | "employee";
	assignedVia?: string;
}): EffectiveContractOnDay {
	return {
		date: "2026-09-20",
		dayOfWeek: "sunday",
		calendarTimezone: "UTC",
		employeeId: "employee-1",
		employmentPeriodId: null,
		isEmployedOnDay: true,
		primaryTeamId: "team-1",
		employmentHistoryId: null,
		contractDefaultId: null,
		contractDefaultScope: null,
		workPolicy: {
			policyId: options.policyId,
			policyName: options.policyName,
			policyVersionId: options.policyVersionId ?? "version-1",
			versionNumber: 1,
			effectiveFromDate: "2026-01-01",
			scheduleEnabled: false,
			regulationEnabled: Boolean(options.regulated),
			presenceEnabled: false,
			schedule: null,
			regulation: options.regulated
				? {
						id: "reg-1",
						maxDailyMinutes: 480,
						maxWeeklyMinutes: null,
						maxUninterruptedMinutes: null,
						minRestPeriodMinutes: null,
						restPeriodEnforcement: "warn",
						overtimeDailyThresholdMinutes: null,
						overtimeWeeklyThresholdMinutes: null,
						overtimeMonthlyThresholdMinutes: null,
						alertBeforeLimitMinutes: 30,
						alertThresholdPercent: 80,
						breakRules: [],
					}
				: null,
			presence: null,
			assignmentType: options.assignmentType ?? "organization",
			assignmentId: null,
			assignedVia: options.assignedVia ?? "Organization Default",
		},
		workPolicySource: "org_default",
		weeklyContractMinutes: null,
		weeklyContractMinutesSource: "default",
		scheduleMode: "policy",
		scheduleModeSource: "default",
		workModel: null,
		workModelSource: "default",
		presenceOverride: "inherit",
		presenceOverrideSource: "default",
		presenceStatus: "not_configured",
		effectivePresence: null,
		balanceMode: "tracked",
		balanceModeSource: "default",
		scheduleSource: "policy",
		scheduleSourceSource: "default",
		isWorkDay: false,
		requiredMinutes: 0,
		contributesZeroBalanceDelta: false,
		latestClockIn: null,
		weeklyScheduleDays: [],
		mismatchWarning: null,
		contractType: "fixed",
		hourlyRate: null,
		currency: "EUR",
		employmentProfile: "regular",
		arbzgScope: "standard",
		onCallTerms: null,
		migratedLegacyTerms: false,
	};
}

function createDatabaseLayer(options?: { missingEmployee?: boolean }) {
	const insertedViolations: unknown[] = [];

	const db = {
		insert: vi.fn(() => ({
			values: async (values: unknown) => {
				insertedViolations.push(values);
			},
		})),
		query: {
			employee: {
				findFirst: vi.fn(async () => {
					if (options?.missingEmployee) return undefined;
					return {
						id: "employee-1",
						organizationId: "organization-1",
						teamId: "team-1",
					};
				}),
			},
			workPolicy: {
				findMany: vi.fn(async () => [
					{
						id: "policy-org-1",
						name: "Org Policy",
						description: null,
						scheduleEnabled: true,
						regulationEnabled: false,
						isDefault: false,
						isActive: true,
					},
				]),
			},
		},
	};
	const databaseLayer = Layer.succeed(
		DatabaseService,
		DatabaseService.of({
			db: db as never,
			query: (name, query) =>
				Effect.tryPromise({
					try: query,
					catch: (cause) =>
						new DatabaseError({
							message: `Database query failed: ${name}`,
							operation: name,
							cause,
						}),
				}),
		}),
	);

	return {
		insertedViolations,
		layer: WorkPolicyServiceLive.pipe(Layer.provide(databaseLayer)),
	};
}

describe("WorkPolicyService (unified contract resolver)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.loadOrganizationTimezone.mockResolvedValue("UTC");
		mockState.loadEffectiveWorkPolicies.mockResolvedValue(new Map());
		mockState.loadActiveOrganizationDefaultPolicyId.mockResolvedValue("policy-org-1");
		mockState.resolveEffectiveContractOnDay.mockResolvedValue(
			makeContractWithPolicy({
				policyId: "policy-org-1",
				policyVersionId: "version-org-1",
				policyName: "Scoped organization policy",
			}),
		);
	});

	it("resolves effective policy scoped to the organization through the unified contract resolver", async () => {
		const context = createDatabaseLayer();

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* WorkPolicyService;
				return yield* service.getEffectivePolicy("employee-1", "organization-1");
			}).pipe(Effect.provide(context.layer)),
		);

		expect(result).toMatchObject({
			policyId: "policy-org-1",
			policyVersionId: "version-org-1",
			policyName: "Scoped organization policy",
		});
		expect(mockState.resolveEffectiveContractOnDay).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				organizationId: "organization-1",
				employeeId: "employee-1",
			}),
		);
	});

	it("resolves effective policy as of the given instant's calendar day in the org timezone", async () => {
		mockState.loadOrganizationTimezone.mockResolvedValue("Europe/Berlin");
		const context = createDatabaseLayer();

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* WorkPolicyService;
				return yield* service.getEffectivePolicyAt({
					employeeId: "employee-1",
					organizationId: "organization-1",
					at: parseInstant("2026-09-20T06:00:40Z"),
				});
			}).pipe(Effect.provide(context.layer)),
		);

		expect(result?.policyId).toBe("policy-org-1");
		expect(mockState.resolveEffectiveContractOnDay).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				organizationId: "organization-1",
				employeeId: "employee-1",
			}),
		);
		const passedDate = mockState.resolveEffectiveContractOnDay.mock.calls[0]?.[1]?.date;
		expect(passedDate?.toString()).toBe("2026-09-20");
	});

	it("judges compliance by the organization's policy version at policyAt and returns policyVersionId", async () => {
		mockState.resolveEffectiveContractOnDay.mockResolvedValue(
			makeContractWithPolicy({
				policyId: "policy-org-1",
				policyVersionId: "version-reg-2",
				policyName: "Regulated policy",
				regulated: true,
			}),
		);
		const context = createDatabaseLayer();

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* WorkPolicyService;
				return yield* service.checkCompliance({
					employeeId: "employee-1",
					organizationId: "organization-1",
					policyAt: parseInstant("2026-09-20T06:00:40Z"),
					currentSessionMinutes: 481,
					totalDailyMinutes: 481,
					totalWeeklyMinutes: 481,
					breaksTakenMinutes: 0,
				});
			}).pipe(Effect.provide(context.layer)),
		);

		expect(result).toMatchObject({
			isCompliant: false,
			policyId: "policy-org-1",
			policyVersionId: "version-reg-2",
			warnings: [expect.objectContaining({ type: "max_daily", limitValue: 480 })],
		});
	});

	it("fails with NotFoundError for an employee outside the organization", async () => {
		const context = createDatabaseLayer({ missingEmployee: true });

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* WorkPolicyService;
				return yield* service.checkCompliance({
					employeeId: "employee-1",
					organizationId: "organization-1",
					policyAt: parseInstant("2026-09-20T06:00:40Z"),
					currentSessionMinutes: 481,
					totalDailyMinutes: 481,
					totalWeeklyMinutes: 481,
					breaksTakenMinutes: 0,
				});
			}).pipe(Effect.result, Effect.provide(context.layer)),
		);

		expect(result).toMatchObject({
			_tag: "Failure",
			failure: { _tag: "NotFoundError", entityId: "employee-1" },
		});
		expect(mockState.resolveEffectiveContractOnDay).not.toHaveBeenCalled();
	});

	it("logs violations dated at violationAt with policyVersionId", async () => {
		const context = createDatabaseLayer();

		await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* WorkPolicyService;
				yield* service.logViolation({
					employeeId: "employee-1",
					organizationId: "organization-1",
					policyId: "policy-org-1",
					policyVersionId: "version-reg-2",
					violationAt: parseInstant("2026-09-19T22:00:00Z"),
					violationType: "max_daily",
					details: { actualMinutes: 481, limitMinutes: 480 },
				});
			}).pipe(Effect.provide(context.layer)),
		);

		expect(context.insertedViolations).toEqual([
			expect.objectContaining({
				policyId: "policy-org-1",
				policyVersionId: "version-reg-2",
				violationDate: new Date("2026-09-19T22:00:00Z"),
			}),
		]);
	});

	it("derives isDefault in getOrganizationPolicies from the canonical default instead of work_policy.is_default", async () => {
		const context = createDatabaseLayer();

		const policies = await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* WorkPolicyService;
				return yield* service.getOrganizationPolicies("organization-1");
			}).pipe(Effect.provide(context.layer)),
		);

		expect(policies).toEqual([
			expect.objectContaining({
				id: "policy-org-1",
				isDefault: true,
			}),
		]);
	});
});
