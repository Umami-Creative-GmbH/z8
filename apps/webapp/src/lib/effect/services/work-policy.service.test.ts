import { drizzle } from "drizzle-orm/node-postgres";
import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { DatabaseError } from "../errors";
import { DatabaseService } from "./database.service";
import {
	WorkPolicyService,
	WorkPolicyServiceLive,
} from "./work-policy.service";

function policy(id: string, name: string, organizationId: string, regulated = false) {
	return {
		id,
		name,
		organizationId,
		isActive: true,
		scheduleEnabled: false,
		regulationEnabled: regulated,
		schedule: null,
		regulation: regulated
			? {
					maxDailyMinutes: 480,
					maxWeeklyMinutes: null,
					maxUninterruptedMinutes: null,
					minRestPeriodMinutes: null,
					restPeriodEnforcement: null,
					overtimeDailyThresholdMinutes: null,
					overtimeWeeklyThresholdMinutes: null,
					overtimeMonthlyThresholdMinutes: null,
					alertBeforeLimitMinutes: null,
					alertThresholdPercent: null,
					breakRules: [],
				}
			: null,
	};
}

function expectDeterministicAssignmentOrder(query: { sql: string }) {
	const orderBy = query.sql.slice(query.sql.indexOf(" order by "));
	expect(orderBy).toMatch(
		/effective_from.*desc nulls last.*created_at.*desc.*id.*desc/,
	);
}

function createDatabaseLayer(options?: {
	multipleValidEmployeePolicies?: boolean;
	regulatedPolicies?: boolean;
}) {
	const relationalDb = drizzle.mock({ schema });
	const employeeQueries: Array<{ params: unknown[]; sql: string }> = [];
	const assignmentQueries: Array<{ params: unknown[]; sql: string }> = [];
	const crossOrganizationPolicy = policy(
		"policy-cross-org",
		"Cross-org policy",
		"organization-2",
	);
	const scopedOrganizationPolicy = policy(
		"policy-org-1",
		"Scoped organization policy",
		"organization-1",
		options?.regulatedPolicies,
	);
	const candidateAssignments = (query: { where: unknown }) => {
		const compiled = relationalDb.query.workPolicyAssignment
			.findMany(query as never)
			.toSQL();
		assignmentQueries.push(compiled);

		if (compiled.params.includes("employee")) {
			if (options?.multipleValidEmployeePolicies) {
				return [
					{
						policy: policy(
							"policy-employee-newer",
							"Newer employee policy",
							"organization-1",
						),
					},
					{
						policy: policy(
							"policy-employee-older",
							"Older employee policy",
							"organization-1",
						),
					},
				];
			}
			return [{ policy: crossOrganizationPolicy }];
		}

		if (compiled.params.includes("team")) {
			return [
				{
					policy: crossOrganizationPolicy,
					team: { name: "Cross-org team" },
				},
			];
		}

		return [
			{ policy: crossOrganizationPolicy },
			{ policy: scopedOrganizationPolicy },
		];
	};
	const findFirstAssignment = vi.fn(async () => ({
		policy: crossOrganizationPolicy,
	}));
	const insertedViolations: unknown[] = [];

	const db = {
		insert: vi.fn(() => ({
			values: async (values: unknown) => {
				insertedViolations.push(values);
			},
		})),
		query: {
			employee: {
				findFirst: vi.fn(async (query: { where: unknown }) => {
					employeeQueries.push(
						relationalDb.query.employee.findFirst(query as never).toSQL(),
					);
					return {
						id: "employee-1",
						organizationId: "organization-1",
						teamId: "team-1",
						team: { id: "team-1", name: "Scoped team" },
					};
				}),
			},
			workPolicyAssignment: {
				findFirst: findFirstAssignment,
				findMany: vi.fn(async (query: { where: unknown }) =>
					candidateAssignments(query),
				),
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
		assignmentQueries,
		employeeQueries,
		findFirstAssignment,
		insertedViolations,
		layer: WorkPolicyServiceLive.pipe(Layer.provide(databaseLayer)),
	};
}

describe("WorkPolicyService.getEffectivePolicy", () => {
	it("scopes every resolution path and falls through cross-org assignments", async () => {
		const context = createDatabaseLayer();

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* WorkPolicyService;
				return yield* service.getEffectivePolicy(
					"employee-1",
					"organization-1",
				);
			}).pipe(Effect.provide(context.layer)),
		);

		expect(result?.policyId).toBe("policy-org-1");
		expect(context.assignmentQueries).toHaveLength(3);
		expect(context.employeeQueries[0].params).toEqual(
			expect.arrayContaining(["employee-1", "organization-1"]),
		);
		for (const query of context.assignmentQueries) {
			expect(query.params).toContain("organization-1");
			expect(query.sql).toContain('"workPolicyAssignment_policy"');
			expect(query.sql.toLowerCase()).not.toContain("exists");
			expectDeterministicAssignmentOrder(query);
		}
	});

	it("selects the first deterministically ordered valid employee candidate", async () => {
		const context = createDatabaseLayer({
			multipleValidEmployeePolicies: true,
		});

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* WorkPolicyService;
				return yield* service.getEffectivePolicy(
					"employee-1",
					"organization-1",
				);
			}).pipe(Effect.provide(context.layer)),
		);

		expect(result?.policyId).toBe("policy-employee-newer");
		expect(context.assignmentQueries).toHaveLength(1);
		expectDeterministicAssignmentOrder(context.assignmentQueries[0]);
	});

	it("preserves unscoped resolution for existing callers", async () => {
		const context = createDatabaseLayer();

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* WorkPolicyService;
				return yield* service.getEffectivePolicy("employee-1");
			}).pipe(Effect.provide(context.layer)),
		);

		expect(result?.policyId).toBe("policy-cross-org");
		expect(context.findFirstAssignment).toHaveBeenCalledOnce();
		expect(context.assignmentQueries).toHaveLength(0);
	});
});

describe("WorkPolicyService.getEffectivePolicyAt", () => {
	it("looks every assignment up as of the given instant, scoped to the organization", async () => {
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
		expect(context.assignmentQueries).toHaveLength(3);
		for (const query of context.assignmentQueries) {
			expect(query.params).toContain("organization-1");
			expect(query.params).toContain("2026-09-20T06:00:40.000Z");
			expectDeterministicAssignmentOrder(query);
		}
	});
});

describe("WorkPolicyService.checkCompliance", () => {
	it("judges the work by the organization's policy at policyAt and names it", async () => {
		const context = createDatabaseLayer({ regulatedPolicies: true });

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

		// The cross-organization candidates are skipped at every level.
		expect(result).toMatchObject({
			isCompliant: false,
			policyId: "policy-org-1",
			warnings: [expect.objectContaining({ type: "max_daily", limitValue: 480 })],
		});
		expect(context.employeeQueries[0].params).toEqual(
			expect.arrayContaining(["employee-1", "organization-1"]),
		);
		expect(context.assignmentQueries).toHaveLength(3);
		for (const query of context.assignmentQueries) {
			expect(query.params).toContain("organization-1");
			expect(query.params).toContain("2026-09-20T06:00:40.000Z");
		}
		expect(context.findFirstAssignment).not.toHaveBeenCalled();
	});
});

describe("WorkPolicyService.logViolation", () => {
	it("dates the violation at the given instant, not when it is logged", async () => {
		const context = createDatabaseLayer();

		await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* WorkPolicyService;
				yield* service.logViolation({
					employeeId: "employee-1",
					organizationId: "organization-1",
					policyId: "policy-org-1",
					violationDate: parseInstant("2026-09-19T22:00:00Z"),
					violationType: "max_daily",
					details: { actualMinutes: 481, limitMinutes: 480 },
				});
			}).pipe(Effect.provide(context.layer)),
		);

		expect(context.insertedViolations).toEqual([
			expect.objectContaining({
				policyId: "policy-org-1",
				violationDate: new Date("2026-09-19T22:00:00Z"),
			}),
		]);
	});
});
