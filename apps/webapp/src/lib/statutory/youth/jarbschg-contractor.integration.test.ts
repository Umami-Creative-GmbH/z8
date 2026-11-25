/**
 * #2010 (spec #1935): JArbSchG never judges an External Contractor's time, whatever their age. A
 * minor contractor gets no Scheduling findings, no publication block and no clock-out
 * violations; a minor converted to an employee is judged from the conversion instant on, so the
 * contractor morning of the conversion day adds nothing to the day's figures.
 */
import { Effect, Layer } from "effect";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { systemClock } from "@/lib/datetime/temporal-core";
import { runtime } from "@/lib/effect/runtime";
import { DatabaseServiceLive } from "@/lib/effect/services/database.service";
import {
	ScheduleComplianceService,
	ScheduleComplianceServiceLive,
} from "@/lib/effect/services/schedule-compliance.service";
import { ShiftService, ShiftServiceLive } from "@/lib/effect/services/shift.service";
import { WorkPolicyServiceLive } from "@/lib/effect/services/work-policy.service";
import { shiftDateBounds } from "@/lib/scheduling/shift-date";
import { checkComplianceAfterClockOut } from "@/lib/time-tracking/clock-out-effects";
import { integrationAdminPool } from "@/test/integration-database";
import {
	type FixtureEmployee,
	type FixtureOrganization,
	statutoryFixture,
} from "@/test/statutory-fixtures";
import { localInstant, youthSeed } from "./testing/youth-seed";

vi.mock("@/lib/effect/runtime", async () => {
	const { Layer } = await import("effect");
	const { DatabaseServiceLive } = await import("@/lib/effect/services/database.service");
	const { WorkPolicyServiceLive } = await import("@/lib/effect/services/work-policy.service");
	return (await import("@/test/effect-runtime")).runtimeModuleOver(
		WorkPolicyServiceLive.pipe(Layer.provide(DatabaseServiceLive)),
	);
});

/** Monday 1 – Sunday 7 March 2027. */
const WEEK = { startDate: "2027-03-01", endDateExclusive: "2027-03-08" };

const complianceLayer = ScheduleComplianceServiceLive.pipe(
	Layer.provide(WorkPolicyServiceLive),
	Layer.provide(DatabaseServiceLive),
);

describe("JArbSchG for External Contractors (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	const fx = statutoryFixture(admin, "t2010-ya");
	const seed = youthSeed(admin);
	let org: FixtureOrganization;
	let owner: FixtureEmployee;
	let subareaId: string;

	beforeEach(async () => {
		await fx.cleanup();
		org = await fx.organization("a");
		owner = await fx.employee(org, "owner", { role: "admin" });
		await fx.membership(org, owner, "owner");
		subareaId = await seed.subarea(org, owner);
	});
	afterAll(async () => {
		try {
			await fx.cleanup();
		} finally {
			await runtime.dispose();
		}
	});

	const minor = (key: string) => fx.employee(org, key, { birthday: "2011-01-01" });
	const at = (date: string, time: string) => localInstant(date, time, org.timezone).toString();
	const shift = (who: FixtureEmployee, date: string, startTime: string, endTime: string) =>
		seed.shift(org, who, { subareaId, creatorUserId: owner.userId, date, startTime, endTime });

	const statutoryFindings = async () => {
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* ScheduleComplianceService;
				return yield* service.evaluateScheduleWindow({
					organizationId: org.id,
					startDate: shiftDateBounds(WEEK.startDate, org.timezone).start,
					endDateExclusive: shiftDateBounds(WEEK.endDateExclusive, org.timezone).start,
					timezone: org.timezone,
				});
			}).pipe(Effect.provide(complianceLayer)),
		);
		return result.findings.filter((finding) => finding.type === "statutory");
	};

	const publishWeek = () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* ShiftService;
				return yield* service.publishShifts(
					org.id,
					{
						start: shiftDateBounds(WEEK.startDate, org.timezone).start,
						endExclusive: shiftDateBounds(WEEK.endDateExclusive, org.timezone).start,
					},
					owner.userId,
					{
						timezone: org.timezone,
						window: { start: WEEK.startDate, endExclusive: WEEK.endDateExclusive },
						now: systemClock.nowInstant(),
					},
				);
			}).pipe(
				Effect.provide(ShiftServiceLive.pipe(Layer.provide(DatabaseServiceLive))),
				Effect.result,
			),
		);

	async function clockOut(who: FixtureEmployee, date: string, time: string, minutes: number) {
		const work = await seed.work(org, who, date, time, minutes);
		await checkComplianceAfterClockOut(
			{
				organizationId: org.id,
				employeeId: who.employeeId,
				workPeriodId: work.id,
				work,
				timezone: org.timezone,
			},
			{ throwOnError: true },
		);
		return work;
	}
	const violationTypes = async (who: FixtureEmployee) =>
		(await seed.violations(who)).map((row) => row.violation_type);

	describe("in Scheduling", () => {
		it("shows a minor contractor's night shift no finding and publishes it with the block on", async () => {
			await seed.blockJarbschgPublish(org);
			const contractor = await minor("contractor");
			await fx.stint(contractor, "contractor", at("2026-01-01", "00:00"));
			await shift(contractor, "2027-03-02", "17:00", "21:00");
			await shift(contractor, "2027-03-07", "10:00", "14:00");

			expect(await statutoryFindings()).toEqual([]);
			expect(await publishWeek()).toMatchObject({
				_tag: "Success",
				success: { count: 2, affectedEmployeeIds: [contractor.employeeId] },
			});
		});

		it("blocks the same night shift of a minor employee", async () => {
			await seed.blockJarbschgPublish(org);
			const employee = await minor("employee");
			await shift(employee, "2027-03-02", "17:00", "21:00");

			expect(await statutoryFindings()).toEqual([
				expect.objectContaining({
					employeeId: employee.employeeId,
					statutoryKind: "jarbschg_night_work",
					blocksPublication: true,
				}),
			]);
			expect(await publishWeek()).toMatchObject({ _tag: "Failure" });
		});

		it("judges a minor converted at noon from the conversion instant on", async () => {
			const converted = await minor("converted");
			const contractorStint = await fx.stint(converted, "contractor", at("2026-01-01", "00:00"));
			await fx.endStint(contractorStint, at("2027-03-02", "12:00"));
			await fx.stint(converted, "employee", at("2027-03-02", "12:00"));
			// Tuesday: 06:00–11:00 as a contractor, 13:00–18:00 as an employee. Together they would
			// be a 10 h day over a 12 h shift span.
			await shift(converted, "2027-03-02", "06:00", "11:00");
			await shift(converted, "2027-03-02", "13:00", "18:00");
			// Wednesday, as an employee: night work.
			const wednesday = await shift(converted, "2027-03-03", "17:00", "21:00");

			expect(await statutoryFindings()).toEqual([
				expect.objectContaining({
					employeeId: converted.employeeId,
					statutoryKind: "jarbschg_night_work",
					subjectKey: `shift:${wednesday}`,
				}),
			]);
		});

		it("judges the employee part of a shift across the conversion instant", async () => {
			const converted = await minor("converted");
			const contractorStint = await fx.stint(converted, "contractor", at("2026-01-01", "00:00"));
			await fx.endStint(contractorStint, at("2027-03-02", "16:00"));
			await fx.stint(converted, "employee", at("2027-03-02", "16:00"));
			// 08:00–21:00: as a whole a 13 h day over a 13 h shift span; its employee part
			// 16:00–21:00 is 5 h with an hour of night work.
			const tuesday = await shift(converted, "2027-03-02", "08:00", "21:00");

			expect(await statutoryFindings()).toEqual([
				expect.objectContaining({
					statutoryKind: "jarbschg_night_work",
					subjectKey: `shift:${tuesday}`,
					summary: expect.objectContaining({ used: { unit: "minutes", value: 60 } }),
				}),
			]);
		});
	});

	describe("at clock-out", () => {
		it("records nothing for a minor contractor", async () => {
			const contractor = await minor("contractor");
			await fx.stint(contractor, "contractor", at("2026-01-01", "00:00"));

			// Tuesday 13:00–21:00 without a break.
			await clockOut(contractor, "2026-03-03", "13:00", 480);

			expect(await violationTypes(contractor)).toEqual([]);
		});

		it("records only the employee part of the conversion day", async () => {
			const converted = await minor("converted");
			const contractorStint = await fx.stint(converted, "contractor", at("2026-01-01", "00:00"));
			// Tuesday 06:00–11:00 as a contractor.
			await clockOut(converted, "2026-03-03", "06:00", 300);
			await fx.endStint(contractorStint, at("2026-03-03", "12:00"));
			await fx.stint(converted, "employee", at("2026-03-03", "12:00"));

			// 13:00–17:00 as an employee: 4 h, inside every limit on its own; with the morning a 9 h
			// day over an 11 h shift span.
			await clockOut(converted, "2026-03-03", "13:00", 240);
			expect(await violationTypes(converted)).toEqual([]);

			// Wednesday 13:00–21:00 without a break, as an employee: judged as any minor's.
			await clockOut(converted, "2026-03-04", "13:00", 480);
			expect(await violationTypes(converted)).toEqual([
				"jarbschg_break",
				"jarbschg_night_work",
				"jarbschg_uninterrupted",
			]);
		});

		it("records the employee part of a clock-in across the conversion instant", async () => {
			const converted = await minor("converted");
			const contractorStint = await fx.stint(converted, "contractor", at("2026-01-01", "00:00"));
			await fx.endStint(contractorStint, at("2026-03-03", "12:00"));
			await fx.stint(converted, "employee", at("2026-03-03", "12:00"));

			// 08:00–17:30 without a break: as a whole a 9.5 h day; its employee part 12:00–17:30
			// is 5.5 h without a break, inside the daily maximum and the shift span.
			await clockOut(converted, "2026-03-03", "08:00", 570);

			expect(await violationTypes(converted)).toEqual(["jarbschg_break", "jarbschg_uninterrupted"]);
		});
	});
});
