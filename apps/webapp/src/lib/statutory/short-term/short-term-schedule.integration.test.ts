/**
 * #1990: short-term allowance warnings reach Scheduling compliance and Staffing suggestions through
 * the #1988 contributor registry, wage-free and with remaining days.
 */
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { integrationAdminPool } from "@/test/integration-database";
import { statutoryFixture } from "@/test/statutory-fixtures";
import {
	addedStatutoryScheduleFindings,
	evaluateStatutoryScheduleFindings,
} from "../scheduling/evaluate";
import { shortTermFixture } from "./testing/short-term-fixture";

describe("short-term allowance in Scheduling and Staffing (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	const fx = statutoryFixture(admin, "t1990-sched");
	const st = shortTermFixture(admin, () => fx.user("creator"));

	beforeEach(async () => {
		st.reset();
		await fx.cleanup();
	});
	afterAll(fx.cleanup);

	const NOW = Temporal.Instant.from("2026-06-01T06:00:00Z");

	/** `days` distinct 4-hour work days at 20 EUR from 2 January 2026 on. */
	async function workDays(
		org: { id: string; timezone: string },
		worker: Awaited<ReturnType<typeof fx.employee>>,
		days: number,
	) {
		let date = Temporal.PlainDate.from("2026-01-02");
		for (let n = 0; n < days; n++) {
			await st.work(org, worker, date.toString());
			date = date.add({ days: 1 });
		}
	}

	it("warns planners with remaining days and never passes earnings", async () => {
		const org = await fx.organization("a");
		const worker = await fx.employee(org, "worker", { contractType: "hourly" });
		await st.terms(worker, { from: "2026-01-01", hourlyRate: 20 });
		await workDays(org, worker, 50);
		await st.priorShortTerm(worker, "prior_short_term_work_days", 2026, 10);
		await st.shift(org, worker, "2026-06-03", "09:00", "17:00", "published");

		const findings = await evaluateStatutoryScheduleFindings(db, {
			organizationId: org.id,
			timezone: org.timezone,
			window: { start: "2026-06-01", endExclusive: "2026-06-08" },
			employeeIds: [worker.employeeId],
			now: NOW,
		});

		// 50 worked + 10 prior + 1 planned = 61 of 70 days (87 %). January's 50 × 4 h × 20 EUR
		// exceeds the Minijob cap, but that Berufsmäßigkeit prompt is for org admins, not planners.
		expect(findings).toEqual([
			{
				type: "statutory",
				employeeId: worker.employeeId,
				findingId: `short_term_work_days:${worker.employeeId}:2026`,
				statutoryKind: "short_term_work_days",
				domain: "short_term",
				severity: "warning",
				subjectKey: "2026",
				legalReference: "§ 8 Abs. 1 Nr. 2 SGB IV",
				summary: {
					tier: "warning",
					usedPercent: 87,
					used: { unit: "days", value: 61 },
					limit: { unit: "days", value: 70 },
					remaining: { unit: "days", value: 9 },
				},
				acknowledgementStatus: null,
				blocksPublication: false,
			},
		]);
	});

	it("skips employees who are not short-term in the judged window", async () => {
		const org = await fx.organization("a");
		const former = await fx.employee(org, "former", { contractType: "hourly" });
		await st.terms(former, { from: "2026-01-01", until: "2026-05-01" });
		await st.terms(former, { from: "2026-05-01", profile: "regular" });
		await workDays(org, former, 69);

		const findings = await evaluateStatutoryScheduleFindings(db, {
			organizationId: org.id,
			timezone: org.timezone,
			window: { start: "2026-06-01", endExclusive: "2026-06-08" },
			employeeIds: [former.employeeId],
			now: NOW,
		});

		expect(findings).toEqual([]);
	});

	it("tells Staffing which candidate the proposed shift would push over the limit", async () => {
		const org = await fx.organization("a");
		const full = await fx.employee(org, "full", { contractType: "hourly" });
		const fresh = await fx.employee(org, "fresh", { contractType: "hourly" });
		for (const worker of [full, fresh]) await st.terms(worker, { from: "2026-01-01" });
		await workDays(org, full, 10);
		await st.priorShortTerm(full, "prior_short_term_work_days", 2026, 60);
		await workDays(org, fresh, 3);

		const added = await addedStatutoryScheduleFindings(db, {
			organizationId: org.id,
			timezone: org.timezone,
			window: { start: "2026-06-03", endExclusive: "2026-06-06" },
			employeeIds: [full.employeeId, fresh.employeeId],
			now: NOW,
			proposedShift: { date: "2026-06-03", startTime: "09:00", endTime: "17:00" },
			replacesShiftId: null,
		});

		expect(added.get(full.employeeId)?.map((f) => [f.statutoryKind, f.summary])).toEqual([
			[
				"short_term_work_days",
				{
					tier: "exceeded",
					usedPercent: 101,
					used: { unit: "days", value: 71 },
					limit: { unit: "days", value: 70 },
					remaining: { unit: "days", value: 0 },
				},
			],
		]);
		expect(added.get(fresh.employeeId) ?? []).toEqual([]);
	});
});
