/**
 * #1993: `arbzg_scope = 'executive_exempt'` in Time Tracking (real PostgreSQL). Adult ArbZG rules
 * of the work policy do not reach exempt employees: the clock-in rest check never blocks them,
 * no proactive ArbZG alerts are raised, and no break is owed or deducted automatically. Employees
 * with standard scope under the same policy keep all three.
 */
import { Effect, Layer } from "effect";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { systemClock } from "@/lib/datetime/temporal-core";
import {
	BreakEnforcementService,
	BreakEnforcementServiceLive,
} from "@/lib/effect/services/break-enforcement.service";
import {
	ComplianceGuardrailService,
	ComplianceGuardrailServiceLive,
} from "@/lib/effect/services/compliance-guardrail.service";
import { DatabaseServiceLive } from "@/lib/effect/services/database.service";
import { WorkPolicyServiceLive } from "@/lib/effect/services/work-policy.service";
import { runAutomaticBreakAdjustment } from "@/lib/time-tracking/automatic-break-adjustment";
import { integrationAdminPool } from "@/test/integration-database";
import {
	type FixtureEmployee,
	type FixtureOrganization,
	statutoryFixture,
} from "@/test/statutory-fixtures";
import { youthSeed } from "./testing/youth-seed";

const layer = Layer.mergeAll(ComplianceGuardrailServiceLive, BreakEnforcementServiceLive).pipe(
	Layer.provide(WorkPolicyServiceLive),
	Layer.provide(DatabaseServiceLive),
);

describe("executive_exempt in Time Tracking (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	const fx = statutoryFixture(admin, "t1993ex");
	const seed = youthSeed(admin);
	let org: FixtureOrganization;
	let owner: FixtureEmployee;
	let standard: FixtureEmployee;
	let executive: FixtureEmployee;

	beforeEach(async () => {
		await fx.cleanup();
		org = await fx.organization("a");
		owner = await fx.employee(org, "owner", { role: "admin" });
		await fx.membership(org, owner, "owner");
		await seed.regulatedPolicy(org, {
			createdBy: owner.userId,
			maxDailyMinutes: 600,
			minRestPeriodMinutes: 660,
			restPeriodEnforcement: "block",
			breakRule: { after: 360, minutes: 30 },
		});
		standard = await fx.employee(org, "standard", { birthday: "1990-01-01" });
		executive = await fx.employee(org, "executive", { birthday: "1990-01-01" });
		for (const [who, arbzgScope] of [
			[standard, "standard"],
			[executive, "executive_exempt"],
		] as const) {
			await seed.terms(who, { from: "2020-01-01", createdBy: owner.userId, arbzgScope });
		}
	});
	afterAll(fx.cleanup);

	const run = <A, E>(
		effect: Effect.Effect<A, E, ComplianceGuardrailService | BreakEnforcementService>,
	) => Effect.runPromise(effect.pipe(Effect.provide(layer)));

	/** Completed work ending `endedMinutesAgo` before now, `minutes` long, in the org's zone. */
	async function workEndedAgo(who: FixtureEmployee, endedMinutesAgo: number, minutes: number) {
		const start = systemClock
			.nowInstant()
			.subtract({ minutes: endedMinutesAgo + minutes })
			.toZonedDateTimeISO(org.timezone);
		return seed.work(
			org,
			who,
			start.toPlainDate().toString(),
			start.toPlainTime().toString({ smallestUnit: "minute" }),
			minutes,
		);
	}

	it("never blocks an exempt employee's clock-in for the adult rest period", async () => {
		for (const who of [standard, executive]) await workEndedAgo(who, 120, 240);
		const check = (who: FixtureEmployee) =>
			run(
				Effect.gen(function* () {
					const service = yield* ComplianceGuardrailService;
					return yield* service.checkRestPeriod({
						employeeId: who.employeeId,
						timezone: org.timezone,
					});
				}),
			);

		expect(await check(standard)).toMatchObject({ canClockIn: false, enforcement: "block" });
		expect(await check(executive)).toMatchObject({ canClockIn: true, violation: null });
	});

	it("raises no proactive ArbZG alerts for an exempt employee", async () => {
		const alerts = (who: FixtureEmployee) =>
			run(
				Effect.gen(function* () {
					const service = yield* ComplianceGuardrailService;
					return yield* service.getProactiveAlerts({
						employeeId: who.employeeId,
						currentSessionMinutes: 590,
						timezone: org.timezone,
					});
				}),
			);

		expect((await alerts(standard)).length).toBeGreaterThan(0);
		expect(await alerts(executive)).toEqual([]);
	});

	it("owes and deducts no adult break for an exempt employee", async () => {
		const deficit = (who: FixtureEmployee) =>
			run(
				Effect.gen(function* () {
					const service = yield* BreakEnforcementService;
					return yield* service.calculateBreakDeficit({
						employeeId: who.employeeId,
						organizationId: org.id,
						policyAt: systemClock.nowInstant(),
						sessionDurationMinutes: 450,
						breaksTakenMinutes: 0,
					});
				}),
			);
		expect((await deficit(standard)).deficit).toBe(30);
		expect((await deficit(executive)).deficit).toBe(0);

		const adjust = async (who: FixtureEmployee) => {
			const work = await workEndedAgo(who, 30, 450);
			return runAutomaticBreakAdjustment({
				organizationId: org.id,
				employeeId: who.employeeId,
				workPeriodId: work.id,
				trigger: { userId: null, closureEntryId: null },
			});
		};
		expect(await adjust(standard)).toMatchObject({ kind: "adjusted", breakMinutes: 30 });
		expect(await adjust(executive)).toEqual({ kind: "not_required" });
	});
});
