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
