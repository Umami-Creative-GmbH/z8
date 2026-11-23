/**
 * #1989: the Minijob earnings monitor (§ 8 Abs. 1 Nr. 1 SGB IV) against real PostgreSQL — monthly
 * and rolling 12-month caps across statutory cap changes, external Minijob offsets, planned
 * shifts and unforeseeable exceedances.
 */
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { integrationAdminPool } from "@/test/integration-database";
import { statutoryFixture } from "@/test/statutory-fixtures";
import { DEFAULT_STATUTORY_PREFERENCES } from "../preferences";
import { acknowledgeMinijobExceedance } from "./acknowledge-minijob-exceedance";
import { evaluateMinijobEarnings } from "./evaluate-minijob";
import { minijobFixture } from "./minijob-database.test.fixture";

describe("Minijob earnings monitor (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	const fx = statutoryFixture(admin, "t1989-monitor");
	const mj = minijobFixture(admin, fx);

	beforeEach(async () => {
		mj.reset();
		await fx.cleanup();
	});
	afterAll(fx.cleanup);

	async function setup() {
		const org = await fx.organization("a");
		const owner = await fx.user("owner");
		await fx.membership(org, owner, "owner");
		const worker = await fx.employee(org, "worker", { contractType: "hourly" });
		return { org, owner, worker };
	}

	function evaluate(
		org: { id: string; timezone: string },
		employeeIds: string[],
		months: { from: string; until: string },
		now = "2026-11-23T12:00:00Z",
	) {
		return evaluateMinijobEarnings(db, {
			organizationId: org.id,
			timezone: org.timezone,
			employeeIds,
			months,
			preferences: DEFAULT_STATUTORY_PREFERENCES,
			now: Temporal.Instant.from(now),
		});
	}

	it("judges each month against the cap in force that month across the October 2022 increase", async () => {
		const { org, owner, worker } = await setup();
		await mj.terms(worker, owner, { from: "2022-01-01", hourlyRate: 10 });
		// 500 € in September 2022 (cap 450 €) and 500 € in October 2022 (cap 520 €).
		await mj.monthWork(org, worker, "2022-09", 3000);
		await mj.monthWork(org, worker, "2022-10", 3000);

		const { findings } = await evaluate(org, [worker.employeeId], {
			from: "2022-09",
			until: "2022-11",
		});
		const monthly = findings
			.filter((f) => f.kind === "minijob_monthly_cap")
			.map((f) => ({
				subject: f.subjectKey,
				tier: f.summary.tier,
				severity: f.severity,
				total: f.adminDetail?.amountsCents?.total,
				cap: f.adminDetail?.amountsCents?.cap,
				ack: f.acknowledgementKind,
			}));

		expect(monthly).toEqual([
			{
				subject: "2022-09",
				tier: "exceeded",
				severity: "critical",
				total: 50_000,
				cap: 45_000,
				ack: "minijob_unforeseeable_exceedance",
			},
			{
				subject: "2022-10",
				tier: "critical",
				severity: "critical",
				total: 50_000,
				cap: 52_000,
				ack: null,
			},
		]);
		expect(findings.every((f) => f.domain === "minijob" && f.earningsDerived)).toBe(true);
	});

	it("sums each month's own cap for the rolling 12 months", async () => {
		const { org, owner, worker } = await setup();
		await mj.terms(worker, owner, { from: "2022-01-01", hourlyRate: 10 });
		// April–September 2022: 450 € a month (cap 450 €); October 2022–February 2023: 520 €
		// (cap 520 €); March 2023: 530 €. Twelve months earn 5,830 € against 5,820 € of caps,
		// while twelve times the March cap would allow 6,240 €.
		for (const month of ["2022-04", "2022-05", "2022-06", "2022-07", "2022-08", "2022-09"]) {
			await mj.monthWork(org, worker, month, 2700);
		}
		for (const month of ["2022-10", "2022-11", "2022-12", "2023-01", "2023-02"]) {
			await mj.monthWork(org, worker, month, 3120);
		}
		await mj.monthWork(org, worker, "2023-03", 3180);

		const { findings } = await evaluate(org, [worker.employeeId], {
			from: "2023-03",
			until: "2023-04",
		});
		const rolling = findings.find((f) => f.kind === "minijob_rolling_12m_cap");

		expect(rolling).toMatchObject({
			subjectKey: "2023-03",
			periodStart: "2022-04-01",
			periodEnd: "2023-04-01",
			severity: "critical",
			summary: { tier: "exceeded" },
			acknowledgementKind: null,
			adminDetail: { amountsCents: { total: 583_000, cap: 582_000 } },
		});
	});

	it("adds every active external Minijob offset covering the month", async () => {
		const { org, owner, worker } = await setup();
		await mj.terms(worker, owner, { from: "2026-01-01", hourlyRate: 15 });
		// 300 € of own work in March 2026 (cap 603 €).
		await mj.monthWork(org, worker, "2026-03", 1200);
		await mj.externalOffset(worker, owner, {
			from: "2026-02-01",
			until: "2026-04-01",
			amountCents: 20_000,
		});
		await mj.externalOffset(worker, owner, { from: "2026-03-01", until: null, amountCents: 5_000 });
		// Ended before March: does not count.
		await mj.externalOffset(worker, owner, {
			from: "2026-01-01",
			until: "2026-03-01",
			amountCents: 9_900,
		});
		const voided = await mj.externalOffset(worker, owner, {
			from: "2026-03-01",
			until: "2026-04-01",
			amountCents: 50_000,
		});
		await admin.query(
			`UPDATE employee_statutory_offset SET voided_at = now(), voided_by = $2, void_reason = 'typo'
			 WHERE id = $1`,
			[voided, owner.userId],
		);

		const { findings } = await evaluate(org, [worker.employeeId], {
			from: "2026-03",
			until: "2026-04",
		});

		// 300 € + 200 € + 50 € = 550 € of 603 €: 91 %, the warning tier.
		expect(findings.find((f) => f.kind === "minijob_monthly_cap")).toMatchObject({
			severity: "warning",
			summary: { tier: "warning", usedPercent: 91 },
			adminDetail: {
				amountsCents: { earned: 30_000, external: 25_000, total: 55_000, cap: 60_300 },
				externalEarningsCents: 25_000,
			},
		});
	});

	it("forecasts shifts that have not started yet and ignores past ones", async () => {
		const { org, owner, worker } = await setup();
		await mj.terms(worker, owner, { from: "2026-01-01", hourlyRate: 20 });
		// Completed: 200 €. Past shift (worked or not): ignored. Future shifts: 2 × 8 h = 320 €.
		await mj.work(org, worker, "2026-11-02", 600);
		await mj.shift(org, worker, owner, {
			date: "2026-11-02",
			startTime: "08:00",
			endTime: "18:00",
		});
		await mj.shift(org, worker, owner, {
			date: "2026-11-24",
			startTime: "09:00",
			endTime: "17:00",
		});
		await mj.shift(org, worker, owner, {
			date: "2026-11-26",
			startTime: "09:00",
			endTime: "17:00",
			status: "draft",
		});

		const { findings } = await evaluate(
			org,
			[worker.employeeId],
			{ from: "2026-11", until: "2026-12" },
			"2026-11-23T12:00:00Z",
		);

		// 520 € of 603 €: 86 %.
		expect(findings.find((f) => f.kind === "minijob_monthly_cap")).toMatchObject({
			summary: { tier: "warning", usedPercent: 86 },
			adminDetail: { amountsCents: { earned: 20_000, planned: 32_000, total: 52_000 } },
		});
	});

	it("counts an open clock-in up to now plus the rest of its shift, with a fingerprint that does not move with now", async () => {
		const { org, owner, worker } = await setup();
		const unplanned = await fx.employee(org, "unplanned", { contractType: "hourly" });
		await mj.terms(worker, owner, { from: "2026-01-01", hourlyRate: 20 });
		await mj.terms(unplanned, owner, { from: "2026-01-01", hourlyRate: 20 });
		// Now is 13:00 Berlin. The worker clocked in at 08:45 for a 09:00–17:00 shift: 4 h 15 min
		// worked so far (85 €) and 4 h of the shift still ahead (80 €).
		await mj.shift(org, worker, owner, {
			date: "2026-11-23",
			startTime: "09:00",
			endTime: "17:00",
		});
		await mj.openWork(org, worker, "2026-11-23", "08:45");
		// Clocked in at 10:00 without a shift: 3 h so far (60 €).
		await mj.openWork(org, unplanned, "2026-11-23", "10:00");

		const month = (result: Awaited<ReturnType<typeof evaluate>>, employeeId: string) =>
			result.employees.get(employeeId)?.find((m) => m.month === "2026-11");
		const ids = [worker.employeeId, unplanned.employeeId];
		const november = { from: "2026-11", until: "2026-12" };
		const atOne = await evaluate(org, ids, november, "2026-11-23T12:00:00Z");
		const atThree = await evaluate(org, ids, november, "2026-11-23T14:00:00Z");

		expect(month(atOne, worker.employeeId)).toMatchObject({
			earnedCents: 8_500,
			plannedCents: 8_000,
			totalCents: 16_500,
		});
		expect(month(atOne, unplanned.employeeId)).toMatchObject({
			earnedCents: 6_000,
			plannedCents: 0,
		});
		// Two hours later the split moves, the projected total and the fingerprint do not.
		expect(month(atThree, worker.employeeId)).toMatchObject({
			earnedCents: 12_500,
			plannedCents: 4_000,
			totalCents: 16_500,
			fingerprint: month(atOne, worker.employeeId)?.fingerprint,
		});
		expect(month(atThree, unplanned.employeeId)?.fingerprint).toBe(
			month(atOne, unplanned.employeeId)?.fingerprint,
		);
	});

	it("counts a started shift in full until work is recorded for it, then the work and the rest", async () => {
		const { org, owner, worker } = await setup();
		const finished = await fx.employee(org, "finished", { contractType: "hourly" });
		await mj.terms(worker, owner, { from: "2026-01-01", hourlyRate: 20 });
		await mj.terms(finished, owner, { from: "2026-01-01", hourlyRate: 20 });
		// Both shifts run 09:00–17:00 Berlin and now is 13:00. The worker has not clocked in yet:
		// the whole shift (160 €) is still planned. The other one worked 09:00–11:00 and clocked
		// out: their recorded 2 h (40 €) replace the past of the shift; the 4 h still ahead (80 €)
		// stay planned until the shift ends, as for a break.
		await mj.shift(org, worker, owner, {
			date: "2026-11-23",
			startTime: "09:00",
			endTime: "17:00",
		});
		await mj.shift(org, finished, owner, {
			date: "2026-11-23",
			startTime: "09:00",
			endTime: "17:00",
		});
		await mj.work(org, finished, "2026-11-23", 120, "09:00");

		const result = await evaluate(org, [worker.employeeId, finished.employeeId], {
			from: "2026-11",
			until: "2026-12",
		});
		const month = (employeeId: string) =>
			result.employees.get(employeeId)?.find((m) => m.month === "2026-11");

		expect(month(worker.employeeId)).toMatchObject({ earnedCents: 0, plannedCents: 16_000 });
		expect(month(finished.employeeId)).toMatchObject({ earnedCents: 4_000, plannedCents: 8_000 });
	});

	it("counts one clock-in over back-to-back shifts once", async () => {
		const { org, owner, worker } = await setup();
		await mj.terms(worker, owner, { from: "2026-01-01", hourlyRate: 20 });
		// Shifts 09:00–13:00 and 13:00–17:00 Berlin, one clock-in at 09:00, now 15:00: 6 h worked
		// so far (120 €) and the 2 h left of the second shift (40 €) — 8 h, not 10 h.
		await mj.shift(org, worker, owner, {
			date: "2026-11-23",
			startTime: "09:00",
			endTime: "13:00",
		});
		await mj.shift(org, worker, owner, {
			date: "2026-11-23",
			startTime: "13:00",
			endTime: "17:00",
		});
		await mj.openWork(org, worker, "2026-11-23", "09:00");

		const { employees } = await evaluate(
			org,
			[worker.employeeId],
			{ from: "2026-11", until: "2026-12" },
			"2026-11-23T14:00:00Z",
		);

		expect(employees.get(worker.employeeId)?.find((m) => m.month === "2026-11")).toMatchObject({
			earnedCents: 12_000,
			plannedCents: 4_000,
			totalCents: 16_000,
		});
	});

	it("counts the rest of a running shift during a clocked-out break", async () => {
		const { org, owner, worker } = await setup();
		await mj.terms(worker, owner, { from: "2026-01-01", hourlyRate: 20 });
		// Shift 08:00–18:00 Berlin, worked 08:00–12:00, on a break at 12:15: 4 h worked (80 €) and
		// the 5 h 45 min still ahead (115 €).
		await mj.shift(org, worker, owner, {
			date: "2026-11-23",
			startTime: "08:00",
			endTime: "18:00",
		});
		await mj.work(org, worker, "2026-11-23", 240, "08:00");

		const { employees } = await evaluate(
			org,
			[worker.employeeId],
			{ from: "2026-11", until: "2026-12" },
			"2026-11-23T11:15:00Z",
		);

		expect(employees.get(worker.employeeId)?.find((m) => m.month === "2026-11")).toMatchObject({
			earnedCents: 8_000,
			plannedCents: 11_500,
			totalCents: 19_500,
		});
	});

	it("keeps the projected total of a clock-in with seconds steady within the minute", async () => {
		const { org, owner, worker } = await setup();
		await mj.terms(worker, owner, { from: "2026-01-01", hourlyRate: 20 });
		// Shift 09:00–13:00 Berlin, clocked in at 09:00:42: 3 h 59 min 18 s to the shift end.
		await mj.shift(org, worker, owner, {
			date: "2026-11-23",
			startTime: "09:00",
			endTime: "13:00",
		});
		await mj.openWork(org, worker, "2026-11-23", "09:00:42");

		const november = { from: "2026-11", until: "2026-12" };
		const totalAt = async (now: string) =>
			(await evaluate(org, [worker.employeeId], november, now)).employees
				.get(worker.employeeId)
				?.find((m) => m.month === "2026-11")?.totalCents;

		const atTen = await totalAt("2026-11-23T09:00:00Z");
		expect(await totalAt("2026-11-23T09:00:50Z")).toBe(atTen);
		expect(await totalAt("2026-11-23T11:30:21.500Z")).toBe(atTen);
	});

	it("counts work for a shift in the shift's month", async () => {
		const { org, owner, worker } = await setup();
		await mj.terms(worker, owner, { from: "2026-01-01", hourlyRate: 20 });
		// Shift 00:00–04:00 Berlin on 1 November; clocked in at 23:50 on 31 October.
		await mj.shift(org, worker, owner, {
			date: "2026-11-01",
			startTime: "00:00",
			endTime: "04:00",
		});
		const months = { from: "2026-10", until: "2026-12" };
		const byMonth = async (now: string) =>
			Object.fromEntries(
				(
					(await evaluate(org, [worker.employeeId], months, now)).employees.get(
						worker.employeeId,
					) ?? []
				)
					.filter((m) => m.month >= "2026-10")
					.map((m) => [m.month, { total: m.totalCents, fingerprint: m.fingerprint }]),
			);

		// 30 October, 12:00 Berlin: the shift is ahead, 4 h (80 €).
		const before = await byMonth("2026-10-30T11:00:00Z");
		const workId = await mj.openWork(org, worker, "2026-10-31", "23:50");
		// 1 November, 01:00 Berlin: 4 h 10 min from the clock-in to the shift end, once.
		const open = await byMonth("2026-11-01T00:00:00Z");
		await mj.closeWork(workId, 250);
		const closed = await byMonth("2026-11-01T05:00:00Z");

		expect(before["2026-11"]?.total).toBe(8_000);
		for (const state of [open, closed]) {
			expect(state["2026-10"]?.total).toBe(0);
			expect(state["2026-11"]).toEqual({
				total: 8_333,
				fingerprint: before["2026-11"]?.fingerprint,
			});
		}
	});

	it("splits one clock-in over back-to-back shifts across a month boundary at the shift start", async () => {
		const { org, owner, worker } = await setup();
		// 10 € until 31 January, 20 € from 1 February.
		await mj.terms(worker, owner, { from: "2026-01-01", until: "2026-02-01", hourlyRate: 10 });
		await mj.terms(worker, owner, { from: "2026-02-01", hourlyRate: 20 });
		// 700 € earned in January (cap 603 €): an exceedance, documented before the night shift.
		await mj.monthWork(org, worker, "2026-01", 4200);
		// Shifts 31 January 18:00–24:00 and 1 February 00:00–06:00 Berlin, worked with one clock-in.
		await mj.shift(org, worker, owner, {
			date: "2026-01-31",
			startTime: "18:00",
			endTime: "00:00",
		});
		await mj.shift(org, worker, owner, {
			date: "2026-02-01",
			startTime: "00:00",
			endTime: "06:00",
		});
		const months = { from: "2026-01", until: "2026-03" };
		const byMonth = async (now: string) =>
			Object.fromEntries(
				(
					(await evaluate(org, [worker.employeeId], months, now)).employees.get(
						worker.employeeId,
					) ?? []
				)
					.filter((m) => m.month >= "2026-01")
					.map((m) => [
						m.month,
						{
							total: m.totalCents,
							status: m.exceedance?.status ?? null,
							fingerprint: m.fingerprint,
						},
					]),
			);
		const planned = await byMonth("2026-01-31T11:00:00Z");
		await acknowledgeMinijobExceedance(db, {
			organizationId: org.id,
			actorUserId: owner.userId,
			employeeId: worker.employeeId,
			month: "2026-01",
			reason: "Covered a sick colleague",
			expectedFingerprint: planned["2026-01"]?.fingerprint ?? "",
			now: Temporal.Instant.from("2026-01-31T11:00:00Z"),
		});

		const workId = await mj.openWork(org, worker, "2026-01-31", "18:00");
		// 1 February, 03:00 Berlin: still clocked in.
		const running = await byMonth("2026-02-01T02:00:00Z");
		await mj.closeWork(workId, 720);
		// 07:00 Berlin: clocked out on time.
		const closed = await byMonth("2026-02-01T06:00:00Z");

		// January: 700 € + 6 h × 10 €; February: 6 h × 20 €. Worked as planned, no overrun.
		expect(planned["2026-01"]?.total).toBe(76_000);
		expect(planned["2026-02"]?.total).toBe(12_000);
		for (const state of [running, closed]) {
			expect(state).toEqual({
				"2026-01": {
					total: 76_000,
					status: "acknowledged",
					fingerprint: planned["2026-01"]?.fingerprint,
				},
				"2026-02": { total: 12_000, status: null, fingerprint: planned["2026-02"]?.fingerprint },
			});
		}
	});

	it("prices each day at the terms in force and covers only months with Minijob days", async () => {
		const { org, owner, worker } = await setup();
		// 10 € until 15 March, 20 € from 16 March, a regular job from 15 April.
		await mj.terms(worker, owner, { from: "2026-01-01", until: "2026-03-16", hourlyRate: 10 });
		await mj.terms(worker, owner, { from: "2026-03-16", until: "2026-04-15", hourlyRate: 20 });
		await mj.terms(worker, owner, { from: "2026-04-15", hourlyRate: 30, profile: "regular" });
		for (const date of ["2026-03-15", "2026-03-16", "2026-04-14", "2026-04-15", "2026-05-04"]) {
			await mj.work(org, worker, date, 60);
		}

		const { employees } = await evaluate(org, [worker.employeeId], {
			from: "2026-03",
			until: "2026-06",
		});
		const months = (employees.get(worker.employeeId) ?? [])
			.filter((m) => m.month >= "2026-02")
			.map((m) => [m.month, m.isMinijob, m.earnedCents, m.plannedCents]);

		expect(months).toEqual([
			["2026-02", true, 0, 0],
			["2026-03", true, 3_000, 0],
			// 14 April at 20 €; from the 15th the work is a regular job's.
			["2026-04", true, 2_000, 0],
			["2026-05", false, 0, 0],
		]);
	});

	it("prices every employee at its own terms changes when several are evaluated together", async () => {
		const { org, owner, worker: early } = await setup();
		const late = await fx.employee(org, "late", { contractType: "hourly" });
		const leaver = await fx.employee(org, "leaver", { contractType: "hourly" });
		// early: 10 € → 20 € on 16 March. late: 12 € → 24 € on 10 April. leaver: 15 € Minijob until
		// 19 March, a regular job from 20 March.
		await mj.terms(early, owner, { from: "2026-01-01", until: "2026-03-16", hourlyRate: 10 });
		await mj.terms(early, owner, { from: "2026-03-16", hourlyRate: 20 });
		await mj.terms(late, owner, { from: "2026-01-01", until: "2026-04-10", hourlyRate: 12 });
		await mj.terms(late, owner, { from: "2026-04-10", hourlyRate: 24 });
		await mj.terms(leaver, owner, { from: "2026-01-01", until: "2026-03-20", hourlyRate: 15 });
		await mj.terms(leaver, owner, { from: "2026-03-20", hourlyRate: 30, profile: "regular" });
		for (const date of ["2026-03-15", "2026-03-16", "2026-04-09", "2026-04-10"]) {
			await mj.work(org, early, date, 60);
			await mj.work(org, late, date, 60);
		}
		for (const date of ["2026-03-19", "2026-03-20", "2026-04-10"]) {
			await mj.work(org, leaver, date, 60);
		}

		const { employees } = await evaluate(
			org,
			[early.employeeId, late.employeeId, leaver.employeeId],
			{ from: "2026-03", until: "2026-05" },
		);
		const months = (employeeId: string) =>
			(employees.get(employeeId) ?? [])
				.filter((m) => m.month >= "2026-03")
				.map((m) => [m.month, m.isMinijob, m.earnedCents]);

		expect(months(early.employeeId)).toEqual([
			["2026-03", true, 3_000],
			["2026-04", true, 4_000],
		]);
		expect(months(late.employeeId)).toEqual([
			["2026-03", true, 2_400],
			["2026-04", true, 3_600],
		]);
		expect(months(leaver.employeeId)).toEqual([
			["2026-03", true, 1_500],
			["2026-04", false, 0],
		]);
	});

	it("attributes work to the organization-local month it starts in", async () => {
		const { org, owner, worker } = await setup();
		await mj.terms(worker, owner, { from: "2026-01-01", hourlyRate: 15 });
		// 01:30 Berlin on 1 April is 23:30 UTC on 31 March.
		await mj.work(org, worker, "2026-04-01", 120, "01:30");

		const { employees } = await evaluate(org, [worker.employeeId], {
			from: "2026-03",
			until: "2026-05",
		});
		const earned = Object.fromEntries(
			(employees.get(worker.employeeId) ?? [])
				.filter((m) => m.month >= "2026-03")
				.map((m) => [m.month, m.earnedCents]),
		);

		expect(earned).toEqual({ "2026-03": 0, "2026-04": 3_000 });
	});

	it("reports nothing for employees outside the Minijob profile or the organization", async () => {
		const { org, owner, worker } = await setup();
		await mj.terms(worker, owner, { from: "2026-01-01", hourlyRate: 30, profile: "regular" });
		await mj.monthWork(org, worker, "2026-03", 6000);
		const other = await fx.organization("b");
		const stranger = await fx.employee(other, "stranger", { contractType: "hourly" });
		await mj.terms(stranger, owner, { from: "2026-01-01", hourlyRate: 30 });
		await mj.monthWork(other, stranger, "2026-03", 6000);

		const result = await evaluate(org, [worker.employeeId, stranger.employeeId], {
			from: "2026-03",
			until: "2026-04",
		});

		expect(result.findings).toEqual([]);
		expect([...result.employees.keys()]).toEqual([]);
	});
});
