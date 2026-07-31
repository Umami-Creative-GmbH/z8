import { drizzle } from "drizzle-orm/node-postgres";
import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { DatabaseError } from "../errors";
import { DatabaseService } from "./database.service";
import {
	WorkPolicyService,
	WorkPolicyServiceLive,
} from "./work-policy.service";

function policy(id: string, name: string, organizationId: string) {
	return {
		id,
		name,
		organizationId,
		isActive: true,
		scheduleEnabled: false,
		regulationEnabled: false,
		schedule: null,
		regulation: null,
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

	const db = {
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
