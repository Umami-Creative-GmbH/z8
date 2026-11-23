/**
 * #1989: Minijob warnings reach Scheduling and Staffing through the statutory contributor seam,
 * wage-free: planners and scoped managers see the tier only, never EUR amounts or wages.
 */
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { integrationAdminPool } from "@/test/integration-database";
import { statutoryFixture } from "@/test/statutory-fixtures";
import { statutoryScheduleContributors } from "../scheduling/contributors";
import {
	addedStatutoryScheduleFindings,
	evaluateStatutoryScheduleFindings,
} from "../scheduling/evaluate";
import { minijobFixture } from "./minijob-database.test.fixture";
import { minijobScheduleContributor } from "./minijob-schedule-contributor";

const NOW = Temporal.Instant.from("2026-11-23T12:00:00Z");

describe("Minijob warnings in Scheduling and Staffing (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	const fx = statutoryFixture(admin, "t1989-schedule");
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
		// 13.37 € an hour: 41 h of December shifts earn 548.17 € of the 603 € cap (90 %).
		await mj.terms(worker, owner, { from: "2026-01-01", hourlyRate: 13.37 });
		for (const date of ["2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04"]) {
			await mj.shift(org, worker, owner, { date, startTime: "08:00", endTime: "18:00" });
		}
		await mj.shift(org, worker, owner, {
			date: "2026-12-07",
			startTime: "08:00",
			endTime: "09:00",
		});
		return { org, owner, worker };
	}

	it("is registered as the Minijob contributor", () => {
		expect(statutoryScheduleContributors).toContain(minijobScheduleContributor);
	});

	it("warns Scheduling with the tier only", async () => {
		const { org, worker } = await setup();

		const findings = await evaluateStatutoryScheduleFindings(
			db,
			{
				organizationId: org.id,
				timezone: org.timezone,
				window: { start: "2026-11-30", endExclusive: "2026-12-07" },
				employeeIds: [worker.employeeId],
				now: NOW,
			},
			[minijobScheduleContributor],
		);

		expect(findings).toEqual([
			{
				type: "statutory",
				employeeId: worker.employeeId,
				findingId: `minijob_monthly_cap:${worker.employeeId}:2026-12`,
				statutoryKind: "minijob_monthly_cap",
				domain: "minijob",
				severity: "warning",
				subjectKey: "2026-12",
				legalReference: "§ 8 Abs. 1 Nr. 1 SGB IV",
				summary: { tier: "warning" },
				acknowledgementStatus: null,
				blocksPublication: false,
			},
		]);
	});

	const PROJECTED_KEYS = [
		"acknowledgementStatus",
		"blocksPublication",
		"domain",
		"employeeId",
		"findingId",
		"legalReference",
		"severity",
		"statutoryKind",
		"subjectKey",
		"summary",
		"type",
	];

	it("tells Staffing that a shift would push a candidate over the cap, wage-free", async () => {
		const { org, worker } = await setup();
		const fresh = await fx.employee(org, "fresh", { contractType: "hourly" });
		await mj.terms(fresh, await fx.user("owner"), { from: "2026-01-01", hourlyRate: 13.37 });

		const added = await addedStatutoryScheduleFindings(
			db,
			{
				organizationId: org.id,
				timezone: org.timezone,
				window: { start: "2026-12-10", endExclusive: "2026-12-11" },
				employeeIds: [worker.employeeId, fresh.employeeId],
				now: NOW,
				proposedShift: { date: "2026-12-10", startTime: "08:00", endTime: "18:00" },
				replacesShiftId: null,
			},
			[minijobScheduleContributor],
		);

		// 51 h → 681.87 €: over the monthly cap; the unforeseeable exceedance is not documented.
		expect(added.get(worker.employeeId)).toEqual([
			expect.objectContaining({
				statutoryKind: "minijob_monthly_cap",
				severity: "critical",
				summary: { tier: "exceeded" },
				acknowledgementStatus: "none",
			}),
		]);
		expect(added.get(fresh.employeeId) ?? []).toEqual([]);
		expect(Object.keys(added.get(worker.employeeId)?.[0] ?? {}).sort()).toEqual(PROJECTED_KEYS);
	});

	it("leaves out the shift Staffing proposes to replace", async () => {
		const { org, owner, worker } = await setup();
		const replaced = await mj.shift(org, worker, owner, {
			date: "2026-12-08",
			startTime: "08:00",
			endTime: "18:00",
		});

		const findings = await evaluateStatutoryScheduleFindings(
			db,
			{
				organizationId: org.id,
				timezone: org.timezone,
				window: { start: "2026-12-08", endExclusive: "2026-12-09" },
				employeeIds: [worker.employeeId],
				now: NOW,
				replacesShiftId: replaced,
			},
			[minijobScheduleContributor],
		);

		expect(findings.map((f) => f.summary)).toEqual([{ tier: "warning" }]);
	});
});
