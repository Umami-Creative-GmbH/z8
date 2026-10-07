import { PgDialect, type SQL } from "drizzle-orm/pg-core";
import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import { DatabaseError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import {
	type EffectiveWorkPolicy,
	WorkPolicyService,
	WorkPolicyServiceLive,
} from "@/lib/effect/services/work-policy.service";

const mocks = vi.hoisted(() => ({
	shouldExcludeFromCalculations: vi.fn(async () => false),
}));

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/calendar/holiday-service", () => ({
	shouldExcludeFromCalculations: mocks.shouldExcludeFromCalculations,
}));

import { calculateExpectedWorkHoursForEmployee, getEmployeePolicy } from "./calculations";

/** The real work-policy service over a fake database that records employee lookups. */
function workPolicyOverFakeDatabase(queryError?: unknown) {
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
		layer: WorkPolicyServiceLive.pipe(Layer.provide(databaseLayer)),
	};
}

function fixedPolicyLayer(policy: EffectiveWorkPolicy | null) {
	return Layer.succeed(
		WorkPolicyService,
		WorkPolicyService.of({
			getEffectivePolicy: () => Effect.succeed(policy),
		} as never),
	);
}

describe("getEmployeePolicy", () => {
	it("looks the policy up within the organization through the work-policy service", async () => {
		const context = workPolicyOverFakeDatabase();

		const policy = await Effect.runPromise(
			getEmployeePolicy("employee-1", "organization-1").pipe(Effect.provide(context.layer)),
		);

		expect(policy).toBeNull();
		expect(context.employeeQueries).toHaveLength(1);
		const query = new PgDialect().sqlToQuery(context.employeeQueries[0].where);
		expect(query.params).toEqual(expect.arrayContaining(["employee-1", "organization-1"]));
	});

	it("keeps the existing null result when policy resolution fails", async () => {
		const context = workPolicyOverFakeDatabase(new Error("database unavailable"));

		await expect(
			Effect.runPromise(
				getEmployeePolicy("employee-1", "organization-1").pipe(Effect.provide(context.layer)),
			),
		).resolves.toBeNull();
	});
});

describe("calculateExpectedWorkHoursForEmployee", () => {
	// 2026-10-05 is a Monday; the range runs Monday to Sunday.
	const monday = new Date("2026-10-05T12:00:00.000Z");
	const sunday = new Date("2026-10-11T12:00:00.000Z");

	it("counts the employee's scheduled days from the policy the service resolves", async () => {
		const policy = {
			policyId: "policy-1",
			policyName: "Four-day week",
			assignedVia: "employee",
			schedule: {
				days: [
					{ dayOfWeek: "monday", isWorkDay: true, hoursPerDay: "10" },
					{ dayOfWeek: "tuesday", isWorkDay: true, hoursPerDay: "10" },
					{ dayOfWeek: "wednesday", isWorkDay: true, hoursPerDay: "10" },
					{ dayOfWeek: "thursday", isWorkDay: true, hoursPerDay: "10" },
				],
			},
		} as unknown as EffectiveWorkPolicy;

		const expected = await Effect.runPromise(
			calculateExpectedWorkHoursForEmployee(
				"employee-1",
				"organization-1",
				monday,
				sunday,
				"UTC",
			).pipe(Effect.provide(fixedPolicyLayer(policy))),
		);

		expect(expected).toMatchObject({
			totalMinutes: 2400,
			workDays: 4,
			scheduleInfo: { name: "Four-day week", source: "employee" },
		});
	});

	it("falls back to eight-hour weekdays without a policy", async () => {
		const expected = await Effect.runPromise(
			calculateExpectedWorkHoursForEmployee(
				"employee-1",
				"organization-1",
				monday,
				sunday,
				"UTC",
			).pipe(Effect.provide(fixedPolicyLayer(null))),
		);

		expect(expected).toMatchObject({ totalMinutes: 2400, workDays: 5, scheduleInfo: null });
	});
});
