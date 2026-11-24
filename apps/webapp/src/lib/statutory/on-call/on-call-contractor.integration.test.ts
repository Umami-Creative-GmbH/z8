/**
 * #2010 (spec #1935): the § 12 TzBfG on-call monitor reads employee time only. An External
 * Contractor on on-call terms is judged by no call-off band; a person converted mid-week counts
 * only the calls worked after the conversion instant.
 */
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { integrationAdminPool } from "@/test/integration-database";
import { type FixtureEmployee, statutoryFixture } from "@/test/statutory-fixtures";
import { evaluateOnCallFindings } from "./monitor";
import { localInstant, type OnCallOrganization, onCallFixture } from "./__tests__/on-call-fixture";

/** Week 2026-W11 (Mon 2026-03-09 … Sun 03-15), judged after it ended. */
const WEEK = { start: "2026-03-09", endExclusive: "2026-03-16" };
const AFTER_WEEK = Temporal.Instant.from("2026-03-20T12:00:00Z");

describe("§ 12 TzBfG on-call work of External Contractors (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	const fx = statutoryFixture(admin, "t2010-oc");
	const onCall = onCallFixture(admin, fx);

	beforeEach(fx.cleanup);
	afterAll(fx.cleanup);

	async function weeklyFindings(org: OnCallOrganization, employeeIds: string[]) {
		const findings = await evaluateOnCallFindings(db, {
			organizationId: org.id,
			timezone: org.timezone,
			window: WEEK,
			employeeIds,
			now: AFTER_WEEK,
		});
		return findings
			.filter((finding) => finding.kind.startsWith("on_call_weekly"))
			.map((finding) => ({
				employeeId: finding.employeeId,
				kind: finding.kind,
				tier: finding.summary.tier,
				used: finding.summary.used?.value,
				limit: finding.summary.limit?.value,
			}));
	}

	/** Calls from 08:00 for `hours` on each day of `days` (`YYYY-MM-DD`). */
	async function calls(
		org: OnCallOrganization,
		who: FixtureEmployee,
		days: readonly (readonly [string, number])[],
	) {
		for (const [date, hours] of days) {
			const end = `${String(8 + Math.floor(hours)).padStart(2, "0")}:${String((hours % 1) * 60).padStart(2, "0")}`;
			await onCall.work(org, who, { date, startTime: "08:00", endTime: end });
		}
	}

	it("judges no week of a contractor on on-call terms; the same employee goes over the band", async () => {
		const org = await onCall.organization("a");
		const contractor = await fx.employee(org, "contractor", { contractType: "hourly" });
		const employee = await fx.employee(org, "employee", { contractType: "hourly" });
		await fx.stint(contractor, "contractor", "2024-12-31T23:00:00Z");
		for (const who of [contractor, employee]) {
			// At least 10 h a week, at most 12.5 h (750 min).
			await onCall.onCallTerms(org, who, { kind: "minimum", weeklyMinutes: 600 });
			await calls(org, who, [
				["2026-03-09", 4],
				["2026-03-10", 4],
				["2026-03-11", 4.5],
				["2026-03-12", 3],
			]);
		}

		expect(await weeklyFindings(org, [contractor.employeeId, employee.employeeId])).toEqual([
			{
				employeeId: employee.employeeId,
				kind: "on_call_weekly_over_band",
				tier: "exceeded",
				used: 930,
				limit: 750,
			},
		]);
	});

	it("counts a person converted on Wednesday at noon only from the conversion instant on", async () => {
		const org = await onCall.organization("a");
		const converted = await fx.employee(org, "converted", { contractType: "hourly" });
		const contractorStint = await fx.stint(converted, "contractor", "2024-12-31T23:00:00Z");
		const conversion = localInstant("2026-03-11", "12:00", org.timezone).toString();
		await fx.endStint(contractorStint, conversion);
		await fx.stint(converted, "employee", conversion);
		await onCall.onCallTerms(org, converted, { kind: "minimum", weeklyMinutes: 600 });
		// As a contractor: Monday and Tuesday 4 h, Wednesday 08:00–11:00.
		await calls(org, converted, [
			["2026-03-09", 4],
			["2026-03-10", 4],
			["2026-03-11", 3],
		]);
		// As an employee: Wednesday 13:00–17:00, Thursday 4 h, Friday 5 h.
		await onCall.work(org, converted, { date: "2026-03-11", startTime: "13:00", endTime: "17:00" });
		await calls(org, converted, [
			["2026-03-12", 4],
			["2026-03-13", 5],
		]);

		// 13 h of calls, against the band of the five days on on-call terms (Wednesday to Sunday):
		// 750 min × 5 / 7.
		expect(await weeklyFindings(org, [converted.employeeId])).toEqual([
			{
				employeeId: converted.employeeId,
				kind: "on_call_weekly_over_band",
				tier: "exceeded",
				used: 780,
				limit: 536,
			},
		]);
	});
});
