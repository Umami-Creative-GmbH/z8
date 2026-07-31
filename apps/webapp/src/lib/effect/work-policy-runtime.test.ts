import { PgDialect, type SQL } from "drizzle-orm/pg-core";
import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import { DatabaseError } from "./errors";
import { DatabaseService } from "./services/database.service";
import { WorkPolicyServiceLive } from "./services/work-policy.service";
import { getEmployeePolicyEffect } from "./work-policy-runtime";

function createLayer(queryError?: unknown) {
	const employeeQueries: Array<{ where: SQL }> = [];
	const findEmployee = vi.fn(async (query: { where: SQL }) => {
		employeeQueries.push(query);
		if (queryError) throw queryError;
		return {
			id: "employee-1",
			organizationId: "organization-1",
			teamId: null,
			team: null,
		};
	});
	const databaseLayer = Layer.succeed(
		DatabaseService,
		DatabaseService.of({
			db: {
				query: {
					employee: { findFirst: findEmployee },
					workPolicyAssignment: {
						findFirst: vi.fn(async () => undefined),
						findMany: vi.fn(async () => []),
					},
				},
			} as never,
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
		employeeQueries,
		layer: Layer.merge(
			databaseLayer,
			WorkPolicyServiceLive.pipe(Layer.provide(databaseLayer)),
		),
	};
}

describe("getEmployeePolicyEffect", () => {
	it("passes organization scope into the real work-policy service", async () => {
		const context = createLayer();

		const result = await Effect.runPromise(
			getEmployeePolicyEffect("employee-1", "organization-1").pipe(
				Effect.provide(context.layer),
			),
		);

		expect(result).toBeNull();
		expect(context.employeeQueries).toHaveLength(1);
		const query = new PgDialect().sqlToQuery(context.employeeQueries[0].where);
		expect(query.params).toEqual(
			expect.arrayContaining(["employee-1", "organization-1"]),
		);
	});

	it("preserves DatabaseError failures from service queries", async () => {
		const cause = new Error("connection lost");
		const context = createLayer(cause);

		const result = await Effect.runPromise(
			Effect.either(
				getEmployeePolicyEffect("employee-1", "organization-1").pipe(
					Effect.provide(context.layer),
				),
			),
		);

		expect(result._tag).toBe("Left");
		if (result._tag === "Left") {
			expect(result.left).toBeInstanceOf(DatabaseError);
			expect(result.left.operation).toBe("getEmployeeForPolicy");
			expect(result.left.cause).toBe(cause);
		}
	});
});
