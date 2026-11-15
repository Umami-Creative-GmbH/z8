import { Effect, Layer } from "effect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

vi.mock("next/headers", async () =>
	(await import("@/test/integration-harness")).nextHeaders(),
);
vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
);
vi.mock("@/lib/auth", () => ({
	auth: { api: { getSession: async () => null } },
}));
vi.mock("@/db", async () =>
	(await import("@/test/integration-database")).integrationDbModule(),
);
const { db } = await import("@/db");
const { AnalyticsService } = await import(
	"@/lib/effect/services/analytics.service"
);
const { DatabaseService, makeDatabaseService } = await import(
	"@/lib/effect/services/database.service"
);
const { WorkPolicyServiceLive } = await import(
	"@/lib/effect/services/work-policy.service"
);

const range = {
	start: new Date("2026-03-01T00:00:00Z"),
	end: new Date("2026-03-31T23:59:59.999Z"),
	startDate: "2026-03-01",
	endDate: "2026-03-31",
	timezone: "UTC",
};
describe("vacation stored allowance evidence on PostgreSQL", () => {
	let fixture: LifecycleDatabaseFixture;
	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});
	afterAll(async () => fixture?.close());
	async function read() {
		return Effect.runPromise(
			Effect.gen(function* () {
				const analytics = yield* AnalyticsService;
				return yield* analytics.getVacationTrends({
					organizationId: fixture.organizationId,
					dateRange: range,
				});
			}).pipe(
				Effect.provide(AnalyticsService.Live),
				Effect.provide(WorkPolicyServiceLive),
				Effect.provide(Layer.succeed(DatabaseService, makeDatabaseService(db))),
			),
		);
	}
	it("distinguishes absent stored allowance from configured zero without replacing the source or widening organization scope", async () => {
		const missing = await fixture.seedEmployee();
		const zero = await fixture.seedEmployee();
		const allocated = await fixture.seedEmployee();
		const other = await fixture.createOrganization();
		const outsider = await fixture.seedEmployee({ organizationId: other });
		await fixture.pool.query(
			`insert into employee_vacation_allowance (employee_id,year,custom_annual_days,custom_carryover_days,updated_at) values ($1,2026,0,0,now()),($2,2026,25,3,now()),($3,2026,999,0,now())`,
			[zero.employeeId, allocated.employeeId, outsider.employeeId],
		);
		const result = await read();
		expect(
			result.byEmployee.find((row) => row.employeeId === missing.employeeId),
		).toMatchObject({
			allocated: 0,
			taken: 0,
			remaining: 0,
			utilizationRate: 0,
			allowanceConfigured: false,
		});
		expect(
			result.byEmployee.find((row) => row.employeeId === zero.employeeId),
		).toMatchObject({
			allocated: 0,
			taken: 0,
			remaining: 0,
			utilizationRate: 0,
			allowanceConfigured: true,
		});
		expect(
			result.byEmployee.find((row) => row.employeeId === allocated.employeeId),
		).toMatchObject({
			allocated: 28,
			taken: 0,
			remaining: 28,
			utilizationRate: 0,
			allowanceConfigured: true,
		});
		expect(
			result.byEmployee.some((row) => row.employeeId === outsider.employeeId),
		).toBe(false);
		expect(result.overall).toEqual({
			totalDaysAllocated: 28,
			totalDaysTaken: 0,
			totalDaysRemaining: 28,
			utilizationRate: 0,
		});
	});
});
