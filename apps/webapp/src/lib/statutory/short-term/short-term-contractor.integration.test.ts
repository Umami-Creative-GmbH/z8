/**
 * #2010 (spec #1935): the short-term monitor reads employee time only. An External Contractor
 * stint counts no short-term day, month or stint, even when it carries a `short_term` terms row
 * and a fixed-term agreement; a conversion counts only the employee stint, split at the exact
 * instant on the conversion day.
 */
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { integrationAdminPool } from "@/test/integration-database";
import { type FixtureEmployee, statutoryFixture } from "@/test/statutory-fixtures";
import { evaluateShortTermEmployment } from "./evaluate";
import { shortTermFixture } from "./__tests__/short-term-fixture";

describe("short-term employment of External Contractors (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	const fx = statutoryFixture(admin, "t2010-st");
	const st = shortTermFixture(admin, () => fx.user("creator"));

	beforeEach(async () => {
		st.reset();
		await fx.cleanup();
	});
	afterAll(fx.cleanup);

	const NOW = Temporal.Instant.from("2026-12-31T12:00:00Z");
	/** Monday 15 June 2026, 12:00 in Berlin. */
	const CONVERSION = "2026-06-15T10:00:00Z";

	function evaluate(org: { id: string; timezone: string }, employeeIds: string[]) {
		return evaluateShortTermEmployment(db, {
			organizationId: org.id,
			timezone: org.timezone,
			employeeIds,
			years: [2026],
			now: NOW,
		});
	}

	async function workOn(
		org: { id: string; timezone: string },
		worker: FixtureEmployee,
		dates: readonly string[],
	) {
		for (const date of dates) await st.work(org, worker, date);
	}

	/** Fixed-term short-term terms from 1 June to 30 September, Monday to Friday, and its work. */
	async function seasonalTerms(org: { id: string; timezone: string }, worker: FixtureEmployee) {
		await st.terms(worker, { from: "2026-06-01", workPolicyId: await st.weekdayPolicy(org) });
		await st.fixedTermAgreement(worker, "2026-06-01", "2026-09-30");
		await workOn(org, worker, ["2026-06-01", "2026-06-05", "2026-06-09"]);
		await st.shift(org, worker, "2026-07-06");
	}

	it("counts nothing for a contractor stint carrying short-term terms", async () => {
		const org = await fx.organization("a");
		const contractor = await fx.employee(org, "contractor", { contractType: "hourly" });
		const employee = await fx.employee(org, "employee", { contractType: "hourly" });
		await fx.stint(contractor, "contractor", "2025-12-31T23:00:00Z");
		await seasonalTerms(org, contractor);
		await seasonalTerms(org, employee);

		const evaluations = await evaluate(org, [contractor.employeeId, employee.employeeId]);

		expect(evaluations.map((evaluation) => evaluation.employeeId)).toEqual([employee.employeeId]);
		// The employee control: 1 June – 30 September is agreed, 122 days against 92.
		expect(evaluations[0]?.allowance).toMatchObject({
			limitKind: "months",
			used: 122,
			limit: 92,
			tier: "exceeded",
		});
		expect(evaluations[0]?.findings).toEqual([
			expect.objectContaining({ kind: "short_term_months", severity: "critical" }),
		]);
	});

	describe("a contractor converted to an employee at noon on 15 June", () => {
		/**
		 * A contractor from 1 January with fixed-term short-term terms from 1 March to 30 June and
		 * work in March and June, up to 15 June 08:00–11:00; then an employee on open-ended
		 * short-term terms, Monday to Friday, working from 16 June.
		 */
		async function converted(org: { id: string; timezone: string }, key: string) {
			const worker = await fx.employee(org, key, { contractType: "hourly" });
			const policy = await st.weekdayPolicy(org);
			const contractorStint = await fx.stint(worker, "contractor", "2025-12-31T23:00:00Z");
			await st.terms(worker, { from: "2026-03-01", workPolicyId: policy });
			await st.fixedTermAgreement(worker, "2026-03-01", "2026-06-30");
			await workOn(org, worker, ["2026-03-02", "2026-03-13", "2026-06-01", "2026-06-12"]);
			await st.work(org, worker, "2026-06-15", "08:00", "11:00");
			await fx.endStint(contractorStint, CONVERSION);
			await fx.stint(worker, "employee", CONVERSION);
			await st.terms(worker, { from: "2026-06-15", workPolicyId: policy });
			await workOn(org, worker, ["2026-06-16", "2026-06-19", "2026-06-26"]);
			return worker;
		}

		it("counts only the employee stint, not the contractor morning of the conversion day", async () => {
			const org = await fx.organization("a");
			const worker = await converted(org, "worker");

			const [evaluation] = await evaluate(org, [worker.employeeId]);

			// One stint, 16 – 26 June: 11 calendar days of the 92 up to 15 September.
			expect(evaluation?.allowance).toMatchObject({
				limitKind: "months",
				used: 11,
				ownUsed: 11,
				limit: 92,
				tier: "ok",
				firstDay: "2026-06-16",
				lastDay: "2026-06-26",
			});
			expect(evaluation?.findings).toEqual([]);
		});

		it("counts the conversion day for employee work after the instant", async () => {
			const org = await fx.organization("a");
			const worker = await converted(org, "worker");
			await st.work(org, worker, "2026-06-15", "13:00", "16:00");

			const [evaluation] = await evaluate(org, [worker.employeeId]);

			// 15 – 26 June: 12 calendar days.
			expect(evaluation?.allowance).toMatchObject({
				used: 12,
				firstDay: "2026-06-15",
				lastDay: "2026-06-26",
			});
		});
	});
});
