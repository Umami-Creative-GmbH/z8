/**
 * #1989: occasional unforeseeable Minijob exceedances (§ 8 Abs. 1b SGB IV) — up to two months in
 * a rolling 12 months, each at most twice the month's cap, documented by an org admin. Anything
 * else, or any change to what an acknowledgement covered, is critical.
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

const NOW = Temporal.Instant.from("2026-11-23T12:00:00Z");

describe("Minijob unforeseeable exceedances (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	const fx = statutoryFixture(admin, "t1989-exceed");
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
		// 10 € an hour; the 2026 cap is 603 €, twice the cap 1,206 €.
		await mj.terms(worker, owner, { from: "2026-01-01", hourlyRate: 10 });
		return { org, owner, worker };
	}
	type Setup = Awaited<ReturnType<typeof setup>>;

	async function monthly({ org, worker }: Setup, from: string, until: string) {
		const { findings } = await evaluateMinijobEarnings(db, {
			organizationId: org.id,
			timezone: org.timezone,
			employeeIds: [worker.employeeId],
			months: { from, until },
			preferences: DEFAULT_STATUTORY_PREFERENCES,
			now: NOW,
		});
		return findings
			.filter((f) => f.kind === "minijob_monthly_cap" && f.summary.tier === "exceeded")
			.map((f) => [f.subjectKey, f.severity, f.adminDetail?.facts?.exceedanceStatus]);
	}

	function acknowledge(
		{ org, owner, worker }: Setup,
		month: string,
		reason = "Covered a sick colleague",
	) {
		return acknowledgeMinijobExceedance(db, {
			organizationId: org.id,
			actorUserId: owner.userId,
			employeeId: worker.employeeId,
			month,
			reason,
			now: NOW,
		});
	}

	it("lets two acknowledged exceedances pass and makes the third critical", async () => {
		const s = await setup();
		for (const month of ["2026-01", "2026-03", "2026-05"]) {
			await mj.monthWork(s.org, s.worker, month, 4200); // 700 €
		}

		expect(await monthly(s, "2026-01", "2026-06")).toEqual([
			["2026-01", "critical", "unacknowledged"],
			["2026-03", "critical", "unacknowledged"],
			["2026-05", "critical", "too_many_exceedances"],
		]);

		await acknowledge(s, "2026-01");
		await acknowledge(s, "2026-03");
		await expect(acknowledge(s, "2026-05")).rejects.toMatchObject({
			refusal: "minijob_exceedance_not_acknowledgeable",
		});

		expect(await monthly(s, "2026-01", "2026-06")).toEqual([
			["2026-01", "info", "acknowledged"],
			["2026-03", "info", "acknowledged"],
			["2026-05", "critical", "too_many_exceedances"],
		]);
	});

	it("leaves the excess of acknowledged months out of the rolling 12 months", async () => {
		const s = await setup();
		await mj.monthWork(s.org, s.worker, "2026-01", 4200);
		await mj.monthWork(s.org, s.worker, "2026-03", 4200);
		await acknowledge(s, "2026-01");
		await acknowledge(s, "2026-03");

		const { employees } = await evaluateMinijobEarnings(db, {
			organizationId: s.org.id,
			timezone: s.org.timezone,
			employeeIds: [s.worker.employeeId],
			months: { from: "2026-03", until: "2026-04" },
			preferences: DEFAULT_STATUTORY_PREFERENCES,
			now: NOW,
		});

		// January–March 2026 are the only Minijob months: 3 × 603 € of caps; 1,400 € earned, of
		// which 2 × 97 € is acknowledged excess.
		expect(employees.get(s.worker.employeeId)?.at(-1)?.rolling).toMatchObject({
			fromMonth: "2025-04",
			capCents: 180_900,
			totalCents: 120_600,
			excludedCents: 19_400,
			minijobMonths: 3,
		});
	});

	it("never accepts a month above twice the cap", async () => {
		const s = await setup();
		await mj.monthWork(s.org, s.worker, "2026-02", 7300); // 1,216.67 €

		await expect(acknowledge(s, "2026-02")).rejects.toMatchObject({
			refusal: "minijob_exceedance_not_acknowledgeable",
		});
		expect(await monthly(s, "2026-02", "2026-03")).toEqual([
			["2026-02", "critical", "over_double_cap"],
		]);
	});

	it("refuses to acknowledge a month within the cap", async () => {
		const s = await setup();
		await mj.monthWork(s.org, s.worker, "2026-02", 600);

		await expect(acknowledge(s, "2026-02")).rejects.toMatchObject({
			refusal: "minijob_not_exceeded",
		});
	});

	it("turns an acknowledgement stale when more work is recorded in the month", async () => {
		const s = await setup();
		await mj.monthWork(s.org, s.worker, "2026-01", 4200);
		await acknowledge(s, "2026-01");
		expect(await monthly(s, "2026-01", "2026-02")).toEqual([["2026-01", "info", "acknowledged"]]);

		await mj.work(s.org, s.worker, "2026-01-28", 60);

		expect(await monthly(s, "2026-01", "2026-02")).toEqual([["2026-01", "critical", "stale"]]);
	});

	it("turns an acknowledgement stale when another shift is planned in the month", async () => {
		const s = await setup();
		for (const date of [
			"2026-12-01",
			"2026-12-02",
			"2026-12-03",
			"2026-12-04",
			"2026-12-07",
			"2026-12-08",
			"2026-12-09",
		]) {
			await mj.shift(s.org, s.worker, s.owner, { date, startTime: "08:00", endTime: "18:00" });
		}
		expect(await monthly(s, "2026-12", "2027-01")).toEqual([
			["2026-12", "critical", "unacknowledged"],
		]);
		const record = await acknowledge(s, "2026-12", "Christmas cover agreed after a resignation");
		expect(record).toMatchObject({
			kind: "minijob_unforeseeable_exceedance",
			findingKind: "minijob_monthly_cap",
			subjectKey: "2026-12",
			reason: "Christmas cover agreed after a resignation",
		});
		expect(await monthly(s, "2026-12", "2027-01")).toEqual([["2026-12", "info", "acknowledged"]]);

		await mj.shift(s.org, s.worker, s.owner, {
			date: "2026-12-10",
			startTime: "08:00",
			endTime: "10:00",
		});

		expect(await monthly(s, "2026-12", "2027-01")).toEqual([["2026-12", "critical", "stale"]]);
	});
});
