/**
 * #1990: short-term employment (§ 8 Abs. 1 Nr. 2 SGB IV) calendar-year allowance and the
 * Berufsmäßigkeit verification prompt, evaluated against real PostgreSQL.
 */
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { integrationAdminPool } from "@/test/integration-database";
import { statutoryFixture } from "@/test/statutory-fixtures";
import {
	attachAcknowledgementStates,
	recordStatutoryAcknowledgement,
	type StatutoryAcknowledgementSubject,
	statutoryAcknowledgementSubjectOf,
} from "../acknowledgements";
import type { StatutoryFinding } from "../finding";
import { evaluateShortTermEmployment } from "./evaluate";
import {
	acknowledgeShortTermBerufsmaessigkeit,
	listShortTermBerufsmaessigkeitReviews,
} from "./monitor";
import { shortTermFixture } from "./testing/short-term-fixture";

describe("short-term employment evaluator (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	const fx = statutoryFixture(admin, "t1990-eval");
	const st = shortTermFixture(admin, () => fx.user("creator"));

	beforeEach(async () => {
		st.reset();
		await fx.cleanup();
	});
	afterAll(fx.cleanup);

	const NOW = Temporal.Instant.from("2026-12-31T12:00:00Z");

	it("counts distinct local days of completed work against the 70-day limit", async () => {
		const org = await fx.organization("a");
		const worker = await fx.employee(org, "worker", { contractType: "hourly" });
		await st.terms(worker, { from: "2026-01-01" });
		// Two work periods on one day count as one working day.
		await st.work(org, worker, "2026-03-02", "08:00", "10:00");
		await st.work(org, worker, "2026-03-02", "14:00", "16:00");
		await st.work(org, worker, "2026-03-03");

		const [evaluation] = await evaluateShortTermEmployment(db, {
			organizationId: org.id,
			timezone: org.timezone,
			employeeIds: [worker.employeeId],
			years: [2026],
			now: NOW,
		});

		expect(evaluation?.allowance).toMatchObject({
			year: 2026,
			limitKind: "work_days",
			used: 2,
			limit: 70,
			remaining: 68,
			tier: "ok",
		});
		expect(evaluation?.findings).toEqual([]);
	});

	function evaluate(
		org: { id: string; timezone: string },
		employeeIds: string[],
		options: { years?: number[]; now?: Temporal.Instant } = {},
	) {
		return evaluateShortTermEmployment(db, {
			organizationId: org.id,
			timezone: org.timezone,
			employeeIds,
			years: options.years ?? [2026],
			now: options.now ?? NOW,
		});
	}

	/** Work on each of `dates` (a stint is not interrupted by up to 14 days without work). */
	async function workOn(
		org: { id: string; timezone: string },
		worker: Awaited<ReturnType<typeof fx.employee>>,
		dates: readonly string[],
	) {
		for (const date of dates) await st.work(org, worker, date);
	}

	/** Every `weekdays` (ISO 1–7) day from `from` to `until`, both inclusive. */
	function datesOn(from: string, until: string, weekdays: readonly number[]): string[] {
		const dates: string[] = [];
		for (
			let date = Temporal.PlainDate.from(from);
			Temporal.PlainDate.compare(date, until) <= 0;
			date = date.add({ days: 1 })
		) {
			if (weekdays.includes(date.dayOfWeek)) dates.push(date.toString());
		}
		return dates;
	}

	describe("3-month limit (continuous week of five or more work days)", () => {
		it("measures one stint in time months from its first day, in calendar days", async () => {
			const org = await fx.organization("a");
			const atLimit = await fx.employee(org, "at-limit", { contractType: "hourly" });
			const over = await fx.employee(org, "over", { contractType: "hourly" });
			const stint = ["2026-06-15", "2026-06-26", "2026-07-08", "2026-07-20", "2026-08-01"];
			for (const worker of [atLimit, over]) {
				await st.terms(worker, { from: "2026-06-01", workPolicyId: await st.weekdayPolicy(org) });
				await workOn(org, worker, [...stint, "2026-08-14", "2026-08-28", "2026-09-07"]);
			}
			// 15 June to 14 September is 3 months: 92 calendar days.
			await st.work(org, atLimit, "2026-09-14");
			await st.work(org, over, "2026-09-15");

			const evaluations = await evaluate(org, [atLimit.employeeId, over.employeeId]);
			const byEmployee = new Map(evaluations.map((e) => [e.employeeId, e]));

			expect(byEmployee.get(atLimit.employeeId)?.allowance).toMatchObject({
				limitKind: "months",
				used: 92,
				limit: 92,
				remaining: 0,
				tier: "critical",
			});
			expect(byEmployee.get(over.employeeId)?.allowance).toMatchObject({
				limitKind: "months",
				used: 93,
				tier: "exceeded",
			});
			expect(byEmployee.get(over.employeeId)?.findings).toEqual([
				expect.objectContaining({
					id: `short_term_months:${over.employeeId}:2026`,
					kind: "short_term_months",
					domain: "short_term",
					severity: "critical",
					subjectKey: "2026",
					summary: {
						tier: "exceeded",
						usedPercent: 101,
						used: { unit: "days", value: 93 },
						limit: { unit: "days", value: 92 },
						remaining: { unit: "days", value: 0 },
					},
					acknowledgementKind: null,
				}),
			]);
		});

		it("does not use up a started month: two months and a day leave a month", async () => {
			const org = await fx.organization("a");
			const worker = await fx.employee(org, "worker", { contractType: "hourly" });
			await st.terms(worker, { from: "2026-06-01", workPolicyId: await st.weekdayPolicy(org) });
			await workOn(org, worker, ["2026-06-15", "2026-06-26", "2026-07-08", "2026-07-20"]);
			await workOn(org, worker, ["2026-08-01", "2026-08-14"]);
			await st.shift(org, worker, "2026-08-15");

			const [evaluation] = await evaluate(org, [worker.employeeId], {
				now: Temporal.Instant.from("2026-08-15T05:00:00Z"),
			});

			// 15 June – 15 August is 62 of the 92 days up to 14 September.
			expect(evaluation?.allowance).toMatchObject({
				limitKind: "months",
				used: 62,
				limit: 92,
				remaining: 30,
				tier: "ok",
			});
		});

		it("adds separate stints in calendar days against 90, not the months between them", async () => {
			const org = await fx.organization("a");
			const worker = await fx.employee(org, "worker", { contractType: "hourly" });
			await st.terms(worker, { from: "2026-01-01", workPolicyId: await st.weekdayPolicy(org) });
			// Three weeks in February and three in August.
			await workOn(org, worker, ["2026-02-02", "2026-02-10", "2026-02-20"]);
			await workOn(org, worker, ["2026-08-03", "2026-08-12", "2026-08-21"]);

			const [evaluation] = await evaluate(org, [worker.employeeId]);

			expect(evaluation?.allowance).toMatchObject({
				limitKind: "months",
				used: 38,
				ownUsed: 38,
				limit: 90,
				remaining: 52,
				tier: "ok",
				firstDay: "2026-02-02",
				lastDay: "2026-08-21",
			});
		});

		it("counts a full calendar month of a stint as 30 days", async () => {
			const org = await fx.organization("a");
			const worker = await fx.employee(org, "worker", { contractType: "hourly" });
			await st.terms(worker, { from: "2026-01-01", workPolicyId: await st.weekdayPolicy(org) });
			// All of July (31 days) and all of September.
			await workOn(org, worker, ["2026-07-01", "2026-07-10", "2026-07-20", "2026-07-31"]);
			await workOn(org, worker, ["2026-09-01", "2026-09-14", "2026-09-28", "2026-09-30"]);

			const [evaluation] = await evaluate(org, [worker.employeeId]);

			expect(evaluation?.allowance).toMatchObject({ used: 60, limit: 90, remaining: 30 });
		});

		it("adds prior-employer months as 30 calendar days each", async () => {
			const org = await fx.organization("a");
			const worker = await fx.employee(org, "worker", { contractType: "hourly" });
			await st.terms(worker, { from: "2026-01-01", workPolicyId: await st.weekdayPolicy(org) });
			await workOn(org, worker, ["2026-07-01", "2026-07-08", "2026-07-15"]);
			await st.priorShortTerm(worker, "prior_short_term_months", 2026, 1);

			const [evaluation] = await evaluate(org, [worker.employeeId]);

			expect(evaluation?.allowance).toMatchObject({
				limitKind: "months",
				used: 45,
				ownUsed: 15,
				priorEmployerUsed: 30,
				limit: 90,
			});
		});

		it("averages the work days of a multi-week schedule cycle", async () => {
			const org = await fx.organization("a");
			const worker = await fx.employee(org, "worker", { contractType: "hourly" });
			// Five days one week, three the next: 4 a week on average.
			const rota = await st.workPolicy(org, [
				["monday", "tuesday", "wednesday", "thursday", "friday"],
				["monday", "tuesday", "wednesday"],
			]);
			await st.terms(worker, { from: "2026-01-01", workPolicyId: rota });
			// A Friday in the five-day cycle week (an even number of weeks after 1970-01-05).
			const weeks = Temporal.PlainDate.from("1970-01-05").until("2026-06-01").days / 7;
			const fiveDayMonday = Temporal.PlainDate.from("2026-06-01").add({ weeks: weeks % 2 });
			await st.work(org, worker, fiveDayMonday.add({ days: 4 }).toString());

			const [evaluation] = await evaluate(org, [worker.employeeId]);

			expect(evaluation?.allowance).toMatchObject({ limitKind: "work_days", used: 1, limit: 70 });
		});

		it.each([
			// 31 January – 30 April: April has no 31st, so the period ends on its last day.
			["2026-01-31", 90],
			// 31 March – 30 June.
			["2026-03-31", 92],
			// 31 August – 30 November.
			["2026-08-31", 92],
			// 10 February – 9 May.
			["2026-02-10", 89],
		])("measures 3 time months from a stint starting on %s as %i days", async (start, days) => {
			const org = await fx.organization("a");
			const worker = await fx.employee(org, "worker", { contractType: "hourly" });
			await st.terms(worker, { from: "2026-01-01", workPolicyId: await st.weekdayPolicy(org) });
			await st.work(org, worker, start);

			const [evaluation] = await evaluate(org, [worker.employeeId]);

			expect(evaluation?.allowance).toMatchObject({ limitKind: "months", used: 1, limit: days });
		});

		it("counts only the stints worked under framework terms that regular terms later replace", async () => {
			const org = await fx.organization("a");
			const worker = await fx.employee(org, "worker", { contractType: "hourly" });
			// Open-ended framework terms, no agreed end; regular terms take over from 1 July.
			await st.terms(worker, { from: "2026-01-01", workPolicyId: await st.weekdayPolicy(org) });
			await workOn(org, worker, ["2026-03-02", "2026-03-06", "2026-03-13"]);
			await workOn(org, worker, ["2026-05-04", "2026-05-08", "2026-05-15"]);
			await st.terms(worker, { from: "2026-07-01", profile: "regular" });

			const [evaluation] = await evaluate(org, [worker.employeeId]);

			// Two stints of 12 days each; the months before, between and after them do not count.
			expect(evaluation?.allowance).toMatchObject({
				limitKind: "months",
				used: 24,
				limit: 90,
				remaining: 66,
			});
		});

		describe("one fixed-term employment counts its whole length, pauses included", () => {
			it("uses up 3 months with June and August worked and July off", async () => {
				const org = await fx.organization("a");
				const worker = await fx.employee(org, "worker", { contractType: "hourly" });
				// One Monday–Friday contract, agreed from 1 June to 31 August.
				await st.terms(worker, { from: "2026-06-01", workPolicyId: await st.weekdayPolicy(org) });
				await st.fixedTermAgreement(worker, "2026-06-01", "2026-08-31");
				await workOn(org, worker, ["2026-06-01", "2026-06-12", "2026-06-22", "2026-06-30"]);
				await workOn(org, worker, ["2026-08-01", "2026-08-12", "2026-08-24", "2026-08-31"]);

				const [evaluation] = await evaluate(org, [worker.employeeId]);

				// 1 June – 31 August is 3 time months: 92 calendar days, July included.
				expect(evaluation?.allowance).toMatchObject({
					limitKind: "months",
					used: 92,
					limit: 92,
					remaining: 0,
					tier: "critical",
				});
			});

			it("stays one employment across a wage change and counts its agreed length", async () => {
				const org = await fx.organization("a");
				const worker = await fx.employee(org, "worker", { contractType: "hourly" });
				const policy = await st.weekdayPolicy(org);
				await st.terms(worker, { from: "2026-06-01", workPolicyId: policy });
				await st.terms(worker, { from: "2026-07-15", workPolicyId: policy, hourlyRate: 16 });
				await st.fixedTermAgreement(worker, "2026-06-01", "2026-08-31");
				// First worked 8 June, then nothing from 19 June to 31 July.
				await workOn(org, worker, ["2026-06-08", "2026-06-18", "2026-08-03", "2026-08-10"]);

				const [evaluation] = await evaluate(org, [worker.employeeId]);

				// 1 June – 31 August is agreed: all 92 days from 1 June, though work stopped on 10 August.
				expect(evaluation?.allowance).toMatchObject({ used: 92, limit: 92, remaining: 0 });
			});

			it("is exceeded by an agreed term over 3 months before its shifts are planned", async () => {
				const org = await fx.organization("a");
				const worker = await fx.employee(org, "worker", { contractType: "hourly" });
				await st.terms(worker, { from: "2026-06-01", workPolicyId: await st.weekdayPolicy(org) });
				await st.fixedTermAgreement(worker, "2026-06-01", "2026-09-30");
				await workOn(org, worker, ["2026-06-01", "2026-06-05", "2026-06-09"]);
				for (const date of ["2026-06-15", "2026-06-26", "2026-07-06", "2026-07-15"]) {
					await st.shift(org, worker, date);
				}

				const [evaluation] = await evaluate(org, [worker.employeeId], {
					now: Temporal.Instant.from("2026-06-10T12:00:00Z"),
				});

				// 1 June – 30 September is agreed: 122 calendar days against 1 June – 31 August's 92.
				expect(evaluation?.allowance).toMatchObject({
					limitKind: "months",
					used: 122,
					limit: 92,
					tier: "exceeded",
				});
				expect(evaluation?.findings[0]?.adminDetail?.facts).toMatchObject({
					reason: "agreed_fixed_term_exceeds_limit",
					agreedFirstDay: "2026-06-01",
					agreedLastDay: "2026-09-30",
				});
			});

			it("ends the employment on the agreed last day", async () => {
				const org = await fx.organization("a");
				const worker = await fx.employee(org, "worker", { contractType: "hourly" });
				await st.terms(worker, { from: "2026-06-01", workPolicyId: await st.weekdayPolicy(org) });
				await st.fixedTermAgreement(worker, "2026-06-01", "2026-06-30");
				await workOn(org, worker, ["2026-06-01", "2026-06-15", "2026-06-29"]);
				// Work after the agreed end is not part of the fixed-term employment.
				await workOn(org, worker, ["2026-08-03", "2026-08-10"]);

				const [evaluation] = await evaluate(org, [worker.employeeId]);

				// All of June as agreed (a full month: 30 days) and 3 – 10 August (8 days) against 90,
				// not July between.
				expect(evaluation?.allowance).toMatchObject({ used: 38, limit: 90 });
			});

			it("ends an employment where later regular terms take over", async () => {
				const org = await fx.organization("a");
				const worker = await fx.employee(org, "worker", { contractType: "hourly" });
				const policy = await st.weekdayPolicy(org);
				await st.terms(worker, { from: "2026-06-01", workPolicyId: policy });
				await st.terms(worker, { from: "2026-07-01", profile: "regular" });
				await st.terms(worker, { from: "2026-08-01", workPolicyId: policy });
				await st.fixedTermAgreement(worker, "2026-06-01", "2026-08-31");
				await workOn(org, worker, ["2026-06-01", "2026-06-30", "2026-08-01", "2026-08-31"]);

				const [evaluation] = await evaluate(org, [worker.employeeId]);

				// June and August are separate short-term employments: two full calendar months of
				// 30 days each against 90, July not counted.
				expect(evaluation?.allowance).toMatchObject({ used: 60, limit: 90, remaining: 30 });
			});
		});

		describe("a fixed-term employment across the year end is judged on its whole agreed length", () => {
			it("is exceeded in both years by a term from 1 November to 28 February", async () => {
				const org = await fx.organization("a");
				const worker = await fx.employee(org, "worker", { contractType: "hourly" });
				const policy = await st.weekdayPolicy(org);
				await st.terms(worker, { from: "2026-11-01", workPolicyId: policy });
				// A wage change: the terms row from 1 November ends before 2027.
				await st.terms(worker, { from: "2026-12-15", workPolicyId: policy, hourlyRate: 16 });
				await st.fixedTermAgreement(worker, "2026-11-01", "2027-02-28");
				await workOn(org, worker, ["2026-11-02", "2026-11-13"]);

				const both = await evaluate(org, [worker.employeeId], { years: [2026, 2027] });
				const [onlyNextYear] = await evaluate(org, [worker.employeeId], { years: [2027] });

				// 1 November – 28 February is 120 calendar days; 3 months from 1 November are 92.
				const exceeded = { limitKind: "months", used: 120, limit: 92, tier: "exceeded" };
				expect(both.map((e) => [e.year, e.allowance])).toEqual([
					[2026, expect.objectContaining(exceeded)],
					[2027, expect.objectContaining(exceeded)],
				]);
				expect(onlyNextYear?.allowance).toMatchObject(exceeded);
			});

			it("judges a term within 3 months once over its whole length in either year", async () => {
				const org = await fx.organization("a");
				const worker = await fx.employee(org, "worker", { contractType: "hourly" });
				await st.terms(worker, { from: "2026-12-01", workPolicyId: await st.weekdayPolicy(org) });
				await st.fixedTermAgreement(worker, "2026-12-01", "2027-02-15");
				await workOn(org, worker, ["2026-12-01", "2026-12-04"]);

				const both = await evaluate(org, [worker.employeeId], { years: [2026, 2027] });
				const [onlyNextYear] = await evaluate(org, [worker.employeeId], { years: [2027] });

				// 1 December – 15 February: 77 of the 90 days from 1 December to 28 February.
				const whole = { limitKind: "months", used: 77, limit: 90, remaining: 13 };
				expect(both.map((e) => [e.year, e.allowance])).toEqual([
					[2026, expect.objectContaining(whole)],
					[2027, expect.objectContaining(whole)],
				]);
				expect(onlyNextYear?.allowance).toMatchObject(whole);
			});

			it("counts the other year's working days of the term against 70", async () => {
				const org = await fx.organization("a");
				const planned = await fx.employee(org, "planned", { contractType: "hourly" });
				const hoursOnly = await fx.employee(org, "hours-only", { contractType: "hourly" });
				const threeDays = await st.workPolicy(org, [["monday", "tuesday", "wednesday"]]);
				await st.terms(planned, { from: "2026-12-01", workPolicyId: threeDays });
				// Weekly hours alone plan no week: only the days worked or planned count.
				await st.terms(hoursOnly, { from: "2026-12-01", weeklyMinutes: 720 });
				for (const worker of [planned, hoursOnly]) {
					await st.fixedTermAgreement(worker, "2026-12-01", "2027-01-31");
					await workOn(org, worker, ["2026-12-01", "2026-12-02", "2026-12-07"]);
					for (const date of ["2027-01-04", "2027-01-05"]) await st.shift(org, worker, date);
				}

				const ids = [planned.employeeId, hoursOnly.employeeId];
				const thisYear = await evaluate(org, ids, { years: [2026] });
				const nextYear = await evaluate(org, ids, { years: [2027] });
				const allowances = (evaluations: typeof thisYear) =>
					new Map(evaluations.map((e) => [e.employeeId, e.allowance]));

				// Monday – Wednesday from 1 December to 31 January: 14 days in December, 12 in January.
				for (const evaluations of [thisYear, nextYear]) {
					expect(allowances(evaluations).get(planned.employeeId)).toMatchObject({
						limitKind: "work_days",
						used: 26,
					});
					expect(allowances(evaluations).get(hoursOnly.employeeId)).toMatchObject({
						limitKind: "work_days",
						used: 5,
					});
				}
			});

			it("chooses one limit for the term in both years from its whole agreed length", async () => {
				const org = await fx.organization("a");
				const worker = await fx.employee(org, "worker", { contractType: "hourly" });
				// Weekly hours alone plan no week: the week is read from the days worked.
				await st.terms(worker, { from: "2026-12-01", weeklyMinutes: 1200 });
				await st.fixedTermAgreement(worker, "2026-12-01", "2027-02-28");
				// Monday – Friday all through December; nothing in January yet.
				await workOn(org, worker, datesOn("2026-12-01", "2026-12-31", [1, 2, 3, 4, 5]));

				const both = await evaluate(org, [worker.employeeId], { years: [2026, 2027] });
				const [onlyNextYear] = await evaluate(org, [worker.employeeId], { years: [2027] });

				// 1 December – 28 February: all 90 days of 3 months from 1 December, in either year.
				const whole = { limitKind: "months", used: 90, limit: 90, remaining: 0 };
				expect(both.map((e) => [e.year, e.allowance])).toEqual([
					[2026, expect.objectContaining(whole)],
					[2027, expect.objectContaining(whole)],
				]);
				expect(onlyNextYear?.allowance).toMatchObject(whole);
			});

			it("chooses one limit for the term in both years when the other year has a shorter stint", async () => {
				const org = await fx.organization("a");
				const worker = await fx.employee(org, "worker", { contractType: "hourly" });
				// A Monday – Friday fixed term from 1 December to 28 February, then framework terms
				// without an own week, under which Monday – Thursday from 3 to 13 May 2027 is planned.
				await st.terms(worker, { from: "2026-12-01", workPolicyId: await st.weekdayPolicy(org) });
				await st.fixedTermAgreement(worker, "2026-12-01", "2027-02-28");
				await st.terms(worker, { from: "2027-03-01", weeklyMinutes: 960 });
				for (const date of datesOn("2027-05-03", "2027-05-13", [1, 2, 3, 4])) {
					await st.shift(org, worker, date);
				}
				const now = Temporal.Instant.from("2026-11-20T12:00:00Z");

				const both = await evaluate(org, [worker.employeeId], { years: [2026, 2027], now });
				const [onlyThisYear] = await evaluate(org, [worker.employeeId], { years: [2026], now });
				const [onlyNextYear] = await evaluate(org, [worker.employeeId], { years: [2027], now });

				// The May stint's four-day week puts 2027 under 70 working days, and with it the fixed
				// term, which counts in 2026 too.
				expect(both.map((e) => [e.year, e.allowance?.limitKind])).toEqual([
					[2026, "work_days"],
					[2027, "work_days"],
				]);
				expect(onlyThisYear?.allowance).toMatchObject({ year: 2026, limitKind: "work_days" });
				expect(onlyNextYear?.allowance).toMatchObject({ year: 2027, limitKind: "work_days" });
			});

			it("judges only the short-term fixed term after a long fixed-term regular one", async () => {
				const org = await fx.organization("a");
				const longServing = await fx.employee(org, "long", { contractType: "hourly" });
				const seasonal = await fx.employee(org, "seasonal", { contractType: "hourly" });
				const policy = await st.weekdayPolicy(org);
				// Three years of fixed-term regular work, then a short-term fixed term in the same
				// employment period.
				await st.terms(longServing, { from: "2023-06-01", profile: "regular" });
				await st.fixedTermAgreement(longServing, "2023-06-01", "2026-05-31");
				await workOn(org, longServing, ["2024-03-04", "2025-11-03", "2026-05-29"]);
				await st.terms(longServing, { from: "2026-06-01", workPolicyId: policy });
				await st.fixedTermExtension(longServing, "2026-06-01", "2026-08-15");
				await workOn(org, longServing, ["2026-06-01", "2026-06-05"]);
				// Evaluated together with someone whose short-term fixed term crosses the year end.
				await st.terms(seasonal, { from: "2026-11-01", workPolicyId: policy });
				await st.fixedTermAgreement(seasonal, "2026-11-01", "2027-01-15");
				await workOn(org, seasonal, ["2026-11-02", "2026-11-06"]);

				const evaluations = await evaluate(org, [longServing.employeeId, seasonal.employeeId]);
				const byEmployee = new Map(evaluations.map((e) => [e.employeeId, e.allowance]));

				// 1 June – 15 August: 76 of the 92 days from 1 June; regular days never count.
				expect(byEmployee.get(longServing.employeeId)).toMatchObject({
					limitKind: "months",
					used: 76,
					limit: 92,
					firstDay: "2026-06-01",
				});
				// 1 November – 15 January: 76 of the 92 days from 1 November.
				expect(byEmployee.get(seasonal.employeeId)).toMatchObject({
					limitKind: "months",
					used: 76,
					limit: 92,
				});
			});

			it("still resets on January 1 between separate employments", async () => {
				const org = await fx.organization("a");
				const worker = await fx.employee(org, "worker", { contractType: "hourly" });
				const policy = await st.weekdayPolicy(org);
				await st.terms(worker, { from: "2026-06-01", workPolicyId: policy });
				await st.fixedTermAgreement(worker, "2026-06-01", "2026-08-15");
				await st.terms(worker, { from: "2026-08-16", profile: "regular" });
				await st.terms(worker, { from: "2027-06-01", workPolicyId: policy });
				await workOn(org, worker, ["2026-06-01", "2026-08-14"]);
				await workOn(org, worker, ["2027-06-01", "2027-06-07", "2027-06-12"]);

				const evaluations = await evaluate(org, [worker.employeeId], {
					years: [2026, 2027],
					now: Temporal.Instant.from("2027-12-31T12:00:00Z"),
				});

				// 1 June – 15 August 2026 as agreed; in 2027 only 1 – 12 June.
				expect(evaluations.map((e) => [e.year, e.allowance?.used, e.allowance?.limit])).toEqual([
					[2026, 76, 92],
					[2027, 12, 92],
				]);
			});
		});

		it("takes the limit from the year's short-term terms when today is outside them", async () => {
			const org = await fx.organization("a");
			const worker = await fx.employee(org, "worker", { contractType: "hourly" });
			await st.terms(worker, { from: "2026-06-01", workPolicyId: await st.weekdayPolicy(org) });
			await st.terms(worker, { from: "2026-09-01", profile: "regular" });
			await st.work(org, worker, "2026-06-01");

			const [evaluation] = await evaluate(org, [worker.employeeId]);

			// One day from 1 June, of the 92 that 1 June – 31 August holds.
			expect(evaluation?.allowance).toMatchObject({ limitKind: "months", used: 1, limit: 92 });
		});
	});

	describe("limit chosen from the real week when the terms plan none", () => {
		it("applies 3 months to a Monday–Friday roster of published shifts", async () => {
			const org = await fx.organization("a");
			const worker = await fx.employee(org, "worker", { contractType: "hourly" });
			await st.terms(worker, { from: "2026-06-01", scheduleSource: "published_shifts" });
			for (const date of datesOn("2026-06-01", "2026-09-04", [1, 2, 3, 4, 5])) {
				await st.shift(org, worker, date, "09:00", "13:00", "published");
			}

			const [evaluation] = await evaluate(org, [worker.employeeId], {
				now: Temporal.Instant.from("2026-05-31T12:00:00Z"),
			});

			// 1 June – 31 August is 3 months (92 days); 1 June – 4 September uses 96.
			expect(evaluation?.allowance).toMatchObject({
				limitKind: "months",
				used: 96,
				limit: 92,
				tier: "exceeded",
			});
		});

		it("applies 70 working days to irregular weeks of three and five days", async () => {
			const org = await fx.organization("a");
			const alternating = await fx.employee(org, "alternating", { contractType: "hourly" });
			const paired = await fx.employee(org, "paired", { contractType: "hourly" });
			for (const worker of [alternating, paired]) {
				await st.terms(worker, { from: "2026-06-01", weeklyMinutes: 960 });
			}
			// Mon–Wed, then Mon–Fri.
			await workOn(org, alternating, [
				...datesOn("2026-06-01", "2026-06-03", [1, 2, 3]),
				...datesOn("2026-06-08", "2026-06-12", [1, 2, 3, 4, 5]),
			]);
			// Two weeks of Mon–Wed, then two of Mon–Fri.
			await workOn(org, paired, [
				...datesOn("2026-06-01", "2026-06-10", [1, 2, 3]),
				...datesOn("2026-06-15", "2026-06-26", [1, 2, 3, 4, 5]),
			]);

			const evaluations = await evaluate(org, [alternating.employeeId, paired.employeeId]);
			const byEmployee = new Map(evaluations.map((e) => [e.employeeId, e]));

			expect(byEmployee.get(alternating.employeeId)?.allowance).toMatchObject({
				limitKind: "work_days",
				used: 8,
				limit: 70,
			});
			expect(byEmployee.get(paired.employeeId)?.allowance).toMatchObject({
				limitKind: "work_days",
				used: 16,
				limit: 70,
			});
		});

		it("applies 3 months to a Monday–Friday roster with a public-holiday week", async () => {
			const org = await fx.organization("a");
			const worker = await fx.employee(org, "worker", { contractType: "hourly" });
			await st.terms(worker, { from: "2026-06-01", weeklyMinutes: 1200 });
			// Four weeks Mon–Fri from 1 June; Thursday 4 June (Corpus Christi) off.
			await workOn(
				org,
				worker,
				datesOn("2026-06-01", "2026-06-26", [1, 2, 3, 4, 5]).filter(
					(date) => date !== "2026-06-04",
				),
			);

			const [evaluation] = await evaluate(org, [worker.employeeId]);

			// 1 June – 26 June: 26 calendar days of the 92 that 1 June – 31 August holds.
			expect(evaluation?.allowance).toMatchObject({ limitKind: "months", used: 26, limit: 92 });
		});

		it("applies 3 months to a Monday–Friday roster with a week off inside the stint", async () => {
			const org = await fx.organization("a");
			const worker = await fx.employee(org, "worker", { contractType: "hourly" });
			await st.terms(worker, { from: "2026-06-01", scheduleSource: "published_shifts" });
			// Monday–Friday from 1 June to 11 September, 13 – 17 July off.
			const dates = datesOn("2026-06-01", "2026-09-11", [1, 2, 3, 4, 5]).filter(
				(date) => date < "2026-07-13" || date > "2026-07-17",
			);
			for (const date of dates) await st.shift(org, worker, date, "09:00", "13:00", "published");

			const [evaluation] = await evaluate(org, [worker.employeeId], {
				now: Temporal.Instant.from("2026-05-31T12:00:00Z"),
			});

			// An empty week says nothing about the week: 1 June – 11 September is 103 calendar days
			// against the 92 of 1 June – 31 August.
			expect(evaluation?.allowance).toMatchObject({
				limitKind: "months",
				used: 103,
				limit: 92,
				tier: "exceeded",
			});
		});

		it("does not read a shorter week from a week short by an approved sickness", async () => {
			const org = await fx.organization("a");
			const sick = await fx.employee(org, "sick", { contractType: "hourly" });
			const unexplained = await fx.employee(org, "unexplained", { contractType: "hourly" });
			// Four weeks Monday–Friday from 1 June; Wednesday – Friday 10 – 12 June not worked.
			const dates = datesOn("2026-06-01", "2026-06-26", [1, 2, 3, 4, 5]).filter(
				(date) => date < "2026-06-10" || date > "2026-06-12",
			);
			for (const worker of [sick, unexplained]) {
				await st.terms(worker, { from: "2026-06-01", weeklyMinutes: 1200 });
				await workOn(org, worker, dates);
			}
			// Only one of them was off sick, approved.
			await st.absence(sick, "2026-06-10", "2026-06-12");
			// Pending absences and home office explain nothing.
			await st.absence(unexplained, "2026-06-10", "2026-06-10", { status: "pending" });
			await st.absence(unexplained, "2026-06-11", "2026-06-12", {
				type: "home_office",
				requiresWorkTime: true,
			});

			const evaluations = await evaluate(org, [sick.employeeId, unexplained.employeeId]);
			const byEmployee = new Map(evaluations.map((e) => [e.employeeId, e]));

			// 1 June – 26 June: 26 calendar days of the 92 that 1 June – 31 August holds.
			expect(byEmployee.get(sick.employeeId)?.allowance).toMatchObject({
				limitKind: "months",
				used: 26,
				limit: 92,
			});
			// Weeks of 5, 2, 5 and 5 days without a reason: an irregular week.
			expect(byEmployee.get(unexplained.employeeId)?.allowance).toMatchObject({
				limitKind: "work_days",
				used: 17,
				limit: 70,
			});
		});

		it("applies 70 working days to the year once one stint has a shorter week", async () => {
			const org = await fx.organization("a");
			const worker = await fx.employee(org, "worker", { contractType: "hourly" });
			// Framework terms without an own week: weekly hours alone.
			await st.terms(worker, { from: "2026-01-01", weeklyMinutes: 1200 });
			// Monday – Saturday from 1 January to 15 March (63 days), then Monday – Thursday from 4 to
			// 14 May (8 days): the longer stint's six-day weeks do not hide the shorter one's.
			await workOn(org, worker, datesOn("2026-01-01", "2026-03-15", [1, 2, 3, 4, 5, 6]));
			await workOn(org, worker, datesOn("2026-05-04", "2026-05-14", [1, 2, 3, 4]));

			const [evaluation] = await evaluate(org, [worker.employeeId]);

			expect(evaluation?.allowance).toMatchObject({
				limitKind: "work_days",
				used: 71,
				limit: 70,
				tier: "exceeded",
			});
		});

		it("applies 70 working days to a weekly-hours helper who works two days a week", async () => {
			const org = await fx.organization("a");
			const worker = await fx.employee(org, "worker", { contractType: "hourly" });
			// 12 hours a week, no work policy: the resolver spreads them Monday–Friday.
			await st.terms(worker, { from: "2026-06-01", weeklyMinutes: 720 });
			await workOn(org, worker, datesOn("2026-06-02", "2026-09-03", [2, 4]));

			const [evaluation] = await evaluate(org, [worker.employeeId]);

			expect(evaluation?.allowance).toMatchObject({
				limitKind: "work_days",
				used: 28,
				limit: 70,
				tier: "ok",
			});
		});

		it("lets only terms with counted days choose the limit, not unworked weekly-hours terms", async () => {
			const org = await fx.organization("a");
			const worker = await fx.employee(org, "worker", { contractType: "hourly" });
			// Weekly hours alone from 1 January, never worked under; an own Monday–Friday policy from
			// 1 June.
			await st.terms(worker, { from: "2026-01-01", weeklyMinutes: 1200 });
			await st.terms(worker, { from: "2026-06-01", workPolicyId: await st.weekdayPolicy(org) });
			await workOn(org, worker, datesOn("2026-06-02", "2026-09-04", [1, 2, 3, 4, 5]));

			const [evaluation] = await evaluate(org, [worker.employeeId]);

			// 2 June – 1 September is 3 months (92 days); 2 June – 4 September uses 95.
			expect(evaluation?.allowance).toMatchObject({
				limitKind: "months",
				used: 95,
				limit: 92,
				tier: "exceeded",
			});
		});

		it("lets only worked framework terms with their own week choose the limit", async () => {
			const org = await fx.organization("a");
			const worker = await fx.employee(org, "worker", { contractType: "hourly" });
			// Open-ended framework terms planning Monday and Tuesday from 1 January to 28 February,
			// never worked under; an own Monday–Saturday week from 1 June.
			await st.terms(worker, {
				from: "2026-01-01",
				workPolicyId: await st.workPolicy(org, [["monday", "tuesday"]]),
			});
			await st.terms(worker, { from: "2026-03-01", profile: "regular" });
			const mondayToSaturday = await st.workPolicy(org, [
				["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"],
			]);
			await st.terms(worker, { from: "2026-06-01", workPolicyId: mondayToSaturday });
			await workOn(org, worker, datesOn("2026-06-01", "2026-08-31", [1, 2, 3, 4, 5, 6]));

			const [evaluation] = await evaluate(org, [worker.employeeId]);

			// 1 June – 31 August is 3 months: all 92 days, within the limit.
			expect(evaluation?.allowance).toMatchObject({
				limitKind: "months",
				used: 92,
				limit: 92,
				remaining: 0,
				tier: "critical",
			});
		});

		it("reads the week from the work, not from a work policy the employee only inherits", async () => {
			const org = await fx.organization("a");
			const weekdays = await st.weekdayPolicy(org);
			await st.assignPolicy(org, weekdays);
			const saturdayHelper = await fx.employee(org, "saturday", { contractType: "hourly" });
			const weekdayWorker = await fx.employee(org, "weekday", { contractType: "hourly" });
			await st.assignPolicy(org, weekdays, weekdayWorker);
			for (const worker of [saturdayHelper, weekdayWorker]) {
				await st.terms(worker, { from: "2026-06-01" });
			}
			// 16 Saturdays from 6 June to 19 September under the organization's Monday–Friday policy.
			await workOn(org, saturdayHelper, datesOn("2026-06-06", "2026-09-19", [6]));
			// Two weeks Monday–Friday under the Monday–Friday policy assigned to the employee.
			await workOn(org, weekdayWorker, datesOn("2026-06-01", "2026-06-12", [1, 2, 3, 4, 5]));

			const evaluations = await evaluate(org, [
				saturdayHelper.employeeId,
				weekdayWorker.employeeId,
			]);
			const byEmployee = new Map(evaluations.map((e) => [e.employeeId, e]));

			expect(byEmployee.get(saturdayHelper.employeeId)?.allowance).toMatchObject({
				limitKind: "work_days",
				used: 16,
				limit: 70,
				tier: "ok",
			});
			// 1 – 12 June: 12 calendar days of the 92 that 1 June – 31 August holds.
			expect(byEmployee.get(weekdayWorker.employeeId)?.allowance).toMatchObject({
				limitKind: "months",
				used: 12,
				limit: 92,
			});
		});
	});

	describe("a fixed-term employment with its own week counts its agreed working days against 70", () => {
		it("is exceeded by a year-long two-day week before any shift is planned", async () => {
			const org = await fx.organization("a");
			const worker = await fx.employee(org, "worker", { contractType: "hourly" });
			const twoDays = await st.workPolicy(org, [["monday", "tuesday"]]);
			await st.terms(worker, { from: "2026-03-01", workPolicyId: twoDays });
			await st.fixedTermAgreement(worker, "2026-03-01", "2027-02-28");

			const [evaluation] = await evaluate(org, [worker.employeeId], {
				now: Temporal.Instant.from("2026-02-15T12:00:00Z"),
			});

			// Sunday 1 March 2026 – Sunday 28 February 2027 holds 52 weeks of Monday and Tuesday.
			expect(evaluation?.allowance).toMatchObject({
				limitKind: "work_days",
				used: 104,
				limit: 70,
				tier: "exceeded",
			});
			expect(evaluation?.findings[0]?.adminDetail?.facts).toMatchObject({
				reason: "agreed_fixed_term_exceeds_working_days",
				agreedFirstDay: "2026-03-01",
				agreedLastDay: "2027-02-28",
				agreedWorkingDays: 104,
			});
		});

		it("is not flagged before work when its agreed working days stay within 70", async () => {
			const org = await fx.organization("a");
			const worker = await fx.employee(org, "worker", { contractType: "hourly" });
			const twoDays = await st.workPolicy(org, [["monday", "tuesday"]]);
			await st.terms(worker, { from: "2026-06-01", workPolicyId: twoDays });
			await st.fixedTermAgreement(worker, "2026-06-01", "2026-08-31");

			const [evaluation] = await evaluate(org, [worker.employeeId], {
				now: Temporal.Instant.from("2026-05-15T12:00:00Z"),
			});

			// Monday 1 June – Monday 31 August: 13 weeks of Monday and Tuesday and one more Monday.
			expect(evaluation?.allowance).toMatchObject({
				limitKind: "work_days",
				used: 27,
				limit: 70,
				tier: "ok",
			});
			expect(evaluation?.findings).toEqual([]);
		});

		it("counts work on a day the week does not plan on top of the agreed days", async () => {
			const org = await fx.organization("a");
			const worker = await fx.employee(org, "worker", { contractType: "hourly" });
			const twoDays = await st.workPolicy(org, [["monday", "tuesday"]]);
			await st.terms(worker, { from: "2026-06-01", workPolicyId: twoDays });
			await st.fixedTermAgreement(worker, "2026-06-01", "2026-08-31");
			// A planned Monday and an extra Wednesday.
			await workOn(org, worker, ["2026-06-01", "2026-06-03"]);

			const [evaluation] = await evaluate(org, [worker.employeeId]);

			expect(evaluation?.allowance).toMatchObject({ limitKind: "work_days", used: 28 });
		});

		it("counts a multi-week rota by its mean", async () => {
			const org = await fx.organization("a");
			const worker = await fx.employee(org, "worker", { contractType: "hourly" });
			// A fortnightly rota of 5 and 3 days: 4 days a week on average.
			const rota = await st.workPolicy(org, [
				["monday", "tuesday", "wednesday", "thursday", "friday"],
				["monday", "tuesday", "wednesday"],
			]);
			await st.terms(worker, { from: "2026-06-01", workPolicyId: rota });
			await st.fixedTermAgreement(worker, "2026-06-01", "2026-08-31");

			const [evaluation] = await evaluate(org, [worker.employeeId], {
				now: Temporal.Instant.from("2026-05-15T12:00:00Z"),
			});

			// 1 June – 31 August: 92 days × 4 / 7 = 52.6, rounded once to 53 working days.
			expect(evaluation?.allowance).toMatchObject({ limitKind: "work_days", used: 53, limit: 70 });
		});

		it("follows a new version of the employee's own policy within the term", async () => {
			const org = await fx.organization("a");
			const worker = await fx.employee(org, "worker", { contractType: "hourly" });
			const policy = await st.workPolicy(org, [["monday", "tuesday", "wednesday"]]);
			await st.terms(worker, { from: "2026-03-01", workPolicyId: policy });
			await st.fixedTermAgreement(worker, "2026-03-01", "2026-08-31");
			// The policy plans Mondays only from 1 May; the terms stay as they are.
			await st.policyVersion(org, policy, "2026-05-01", [["monday"]]);

			const [evaluation] = await evaluate(org, [worker.employeeId], {
				now: Temporal.Instant.from("2026-02-15T12:00:00Z"),
			});

			// Monday – Wednesday in March (14) and April (13), then 18 Mondays from May to August.
			expect(evaluation?.allowance).toMatchObject({
				limitKind: "work_days",
				used: 45,
				limit: 70,
				tier: "ok",
			});
		});

		it("counts a week of the employee's own from an individual assignment within the term", async () => {
			const org = await fx.organization("a");
			const worker = await fx.employee(org, "worker", { contractType: "hourly" });
			// Weekly hours alone from 1 March; a Monday–Tuesday policy assigned to the employee from
			// 1 April.
			await st.terms(worker, { from: "2026-03-01", weeklyMinutes: 600 });
			await st.fixedTermAgreement(worker, "2026-03-01", "2026-08-31");
			const twoDays = await st.workPolicy(org, [["monday", "tuesday"]]);
			await st.assignPolicy(org, twoDays, worker, { from: "2026-04-01" });
			await st.work(org, worker, "2026-03-03");

			const [evaluation] = await evaluate(org, [worker.employeeId], {
				now: Temporal.Instant.from("2026-03-10T12:00:00Z"),
			});

			// March has no own week: its one worked day. April – August: 43 Mondays and Tuesdays.
			expect(evaluation?.allowance).toMatchObject({ limitKind: "work_days", used: 44 });
		});

		it("counts a five-day term's agreed working days when prior working days switch it to 70", async () => {
			const org = await fx.organization("a");
			const worker = await fx.employee(org, "worker", { contractType: "hourly" });
			await st.terms(worker, { from: "2026-06-01", workPolicyId: await st.weekdayPolicy(org) });
			await st.fixedTermAgreement(worker, "2026-06-01", "2026-07-31");
			await st.priorShortTerm(worker, "prior_short_term_work_days", 2026, 10);

			const [evaluation] = await evaluate(org, [worker.employeeId], {
				now: Temporal.Instant.from("2026-05-15T12:00:00Z"),
			});

			// Monday – Friday from 1 June to 31 July: 22 + 23 working days, before any shift.
			expect(evaluation?.allowance).toMatchObject({
				limitKind: "work_days",
				used: 55,
				ownUsed: 45,
				priorEmployerUsed: 10,
				limit: 70,
			});
		});

		describe("allowance fingerprint", () => {
			const BEFORE_TERM = Temporal.Instant.from("2026-02-15T12:00:00Z");

			async function yearLongTwoDayTerm() {
				const org = await fx.organization("a");
				const worker = await fx.employee(org, "worker", { contractType: "hourly" });
				const twoDays = await st.workPolicy(org, [["monday", "tuesday"]]);
				await st.terms(worker, { from: "2026-03-01", workPolicyId: twoDays });
				await st.fixedTermAgreement(worker, "2026-03-01", "2027-02-28");
				return { org, worker, twoDays };
			}

			async function allowanceFinding(
				org: { id: string; timezone: string },
				employeeId: string,
				now: Temporal.Instant,
			) {
				const [evaluation] = await evaluate(org, [employeeId], { now });
				const finding = evaluation?.findings.find((f) => f.kind === "short_term_work_days");
				return { allowance: evaluation?.allowance, fingerprint: finding?.inputFingerprint };
			}

			it("changes when the agreed week changes, not with time alone", async () => {
				const { org, worker, twoDays } = await yearLongTwoDayTerm();
				const before = await allowanceFinding(org, worker.employeeId, BEFORE_TERM);
				const later = await allowanceFinding(
					org,
					worker.employeeId,
					Temporal.Instant.from("2026-02-27T12:00:00Z"),
				);
				// Mondays only from 1 September.
				await st.policyVersion(org, twoDays, "2026-09-01", [["monday"]]);
				const after = await allowanceFinding(org, worker.employeeId, BEFORE_TERM);

				expect(before.allowance).toMatchObject({ used: 104, tier: "exceeded" });
				expect(later.fingerprint).toBe(before.fingerprint);
				// 53 Mondays and Tuesdays from March to August, then 25 Mondays.
				expect(after.allowance).toMatchObject({ used: 78, tier: "exceeded" });
				expect(after.fingerprint).toBeDefined();
				expect(after.fingerprint).not.toBe(before.fingerprint);
			});

			it("changes when the planned weekdays change but the agreed days do not", async () => {
				const { org, worker, twoDays } = await yearLongTwoDayTerm();
				// A worked Wednesday the week does not plan.
				await st.work(org, worker, "2026-03-04");
				const now = Temporal.Instant.from("2026-03-10T12:00:00Z");
				const before = await allowanceFinding(org, worker.employeeId, now);
				// The week is corrected to Monday and Wednesday from the term's first day.
				await st.policyVersion(org, twoDays, "2026-03-01", [["monday", "wednesday"]]);
				const after = await allowanceFinding(org, worker.employeeId, now);

				expect(before.allowance).toMatchObject({ used: 105 });
				expect(after.allowance).toMatchObject({ used: 104 });
				expect(after.fingerprint).toBeDefined();
				expect(after.fingerprint).not.toBe(before.fingerprint);
			});
		});
	});

	describe("stints counted in different units", () => {
		it("judges against 70 working days when prior working days meet a five-day week", async () => {
			const org = await fx.organization("a");
			const worker = await fx.employee(org, "worker", { contractType: "hourly" });
			await st.terms(worker, { from: "2026-01-01", workPolicyId: await st.weekdayPolicy(org) });
			await workOn(org, worker, ["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09"]);
			await st.work(org, worker, "2026-07-10");
			await st.priorShortTerm(worker, "prior_short_term_work_days", 2026, 10);

			const [evaluation] = await evaluate(org, [worker.employeeId]);

			expect(evaluation?.allowance).toMatchObject({
				limitKind: "work_days",
				used: 15,
				ownUsed: 5,
				priorEmployerUsed: 10,
				limit: 70,
			});
		});

		it("counts prior-employer months as working days against 70 for a short week", async () => {
			const org = await fx.organization("a");
			const worker = await fx.employee(org, "worker", { contractType: "hourly" });
			await st.terms(worker, { from: "2026-01-01" });
			await workOn(org, worker, ["2026-07-06", "2026-07-07"]);
			// One month of a five-day week is 70 / 3 working days, rounded up.
			await st.priorShortTerm(worker, "prior_short_term_months", 2026, 1);

			const [evaluation] = await evaluate(org, [worker.employeeId]);

			expect(evaluation?.allowance).toMatchObject({
				limitKind: "work_days",
				used: 26,
				ownUsed: 2,
				priorEmployerUsed: 24,
			});
		});
	});

	it("ignores short-term terms superseded by later regular terms", async () => {
		const org = await fx.organization("a");
		const worker = await fx.employee(org, "worker", { contractType: "hourly" });
		await st.terms(worker, { from: "2025-06-01" });
		await st.terms(worker, { from: "2026-01-01", profile: "regular" });
		await st.work(org, worker, "2026-03-02");

		expect(await evaluate(org, [worker.employeeId])).toEqual([]);
	});

	it("adds prior-employer days of the same calendar year and warns from the org's tier", async () => {
		const org = await fx.organization("a");
		const worker = await fx.employee(org, "worker", { contractType: "hourly" });
		await st.terms(worker, { from: "2026-01-01" });
		await st.work(org, worker, "2026-05-04");
		await st.work(org, worker, "2026-05-05");
		await st.priorShortTerm(worker, "prior_short_term_work_days", 2026, 54);
		// Another year's offset never counts.
		await st.priorShortTerm(worker, "prior_short_term_work_days", 2025, 30);

		const [evaluation] = await evaluate(org, [worker.employeeId]);

		expect(evaluation?.allowance).toMatchObject({
			used: 56,
			ownUsed: 2,
			priorEmployerUsed: 54,
			remaining: 14,
			tier: "warning",
			usedPercent: 80,
		});
		expect(evaluation?.findings.map((f) => [f.kind, f.severity, f.summary.remaining])).toEqual([
			["short_term_work_days", "warning", { unit: "days", value: 14 }],
		]);
	});

	it("resets on January 1 in the organization's timezone", async () => {
		const org = await fx.organization("a");
		const worker = await fx.employee(org, "worker", { contractType: "hourly" });
		await st.terms(worker, { from: "2025-01-01" });
		await st.priorShortTerm(worker, "prior_short_term_work_days", 2025, 60);
		await st.work(org, worker, "2025-12-31", "08:00", "12:00");
		// 00:30 in Berlin on New Year's Day is still 2025 in UTC.
		await st.work(org, worker, "2026-01-01", "00:30", "04:00");

		const evaluations = await evaluate(org, [worker.employeeId], { years: [2025, 2026] });

		expect(evaluations.map((e) => [e.year, e.allowance?.used, e.allowance?.firstDay])).toEqual([
			[2025, 61, "2025-12-31"],
			[2026, 1, "2026-01-01"],
		]);
	});

	it("forecasts planned shifts from today on and counts a day once with work and a shift", async () => {
		const org = await fx.organization("a");
		const worker = await fx.employee(org, "worker", { contractType: "hourly" });
		await st.terms(worker, { from: "2026-01-01" });
		await st.work(org, worker, "2026-04-06");
		// A past shift that was not worked does not count; today's and later ones do.
		await st.shift(org, worker, "2026-04-07");
		await st.shift(org, worker, "2026-04-10", "09:00", "13:00", "published");
		await st.shift(org, worker, "2026-04-13");
		const edited = await st.shift(org, worker, "2026-04-14");
		// Work today plus today's shift is one day.
		await st.work(org, worker, "2026-04-10", "08:00", "09:00");

		const evaluations = await evaluateShortTermEmployment(db, {
			organizationId: org.id,
			timezone: org.timezone,
			employeeIds: [worker.employeeId],
			years: [2026],
			now: Temporal.Instant.from("2026-04-10T06:00:00Z"),
			replacesShiftId: edited,
			proposedShifts: [
				{ employeeId: worker.employeeId, date: "2026-04-15", startTime: "22:00", endTime: "02:00" },
			],
		});

		// 04-06, 04-10, 04-13, 04-15 (the night shift counts on its start day only).
		expect(evaluations[0]?.allowance).toMatchObject({ used: 4, lastDay: "2026-04-15" });
	});

	describe("Berufsmäßigkeit verification", () => {
		/** Seven or eight 4-hour days at 20 EUR: 560 or 640 EUR against the 603 EUR cap of 2026. */
		async function earner(key: string, days: number, hourlyRate = 20) {
			const org = await fx.organization(key);
			const worker = await fx.employee(org, "worker", { contractType: "hourly" });
			await st.terms(worker, { from: "2026-01-01", hourlyRate });
			for (let day = 1; day <= days; day++) {
				await st.work(org, worker, `2026-05-${String(day).padStart(2, "0")}`);
			}
			return { org, worker };
		}

		it("prompts when a month's earnings exceed the Minijob cap, with EUR in admin detail only", async () => {
			const below = await earner("below", 7);
			const above = await earner("above", 8);

			const [belowEvaluation] = await evaluate(below.org, [below.worker.employeeId]);
			const [aboveEvaluation] = await evaluate(above.org, [above.worker.employeeId]);

			expect(belowEvaluation?.findings).toEqual([]);
			expect(aboveEvaluation?.findings).toEqual([
				expect.objectContaining({
					id: `short_term_berufsmaessigkeit_check:${above.worker.employeeId}:2026-05`,
					kind: "short_term_berufsmaessigkeit_check",
					domain: "short_term",
					severity: "warning",
					subjectKey: "2026-05",
					periodStart: "2026-05-01",
					periodEnd: "2026-06-01",
					earningsDerived: true,
					acknowledgementKind: "short_term_berufsmaessigkeit_verified",
					summary: { tier: "exceeded", usedPercent: 106 },
					adminDetail: expect.objectContaining({
						currency: "EUR",
						amountsCents: { earned: 64_000, planned: 0, total: 64_000, cap: 60_300 },
					}),
				}),
			]);
		});

		it("counts planned shifts of the month and goes stale when earnings or shifts change", async () => {
			const { org, worker } = await earner("a", 7);
			const owner = await fx.user("owner");
			const now = Temporal.Instant.from("2026-05-20T06:00:00Z");
			const evaluateMay = async () =>
				(
					await evaluateShortTermEmployment(db, {
						organizationId: org.id,
						timezone: org.timezone,
						employeeIds: [worker.employeeId],
						years: [2026],
						now,
					})
				)[0]?.findings.find((f) => f.kind === "short_term_berufsmaessigkeit_check");

			expect(await evaluateMay()).toBeUndefined();
			await st.shift(org, worker, "2026-05-28");
			const prompted = await evaluateMay();
			expect(prompted?.adminDetail?.amountsCents).toMatchObject({ earned: 56_000, planned: 8_000 });

			const subject = statutoryAcknowledgementSubjectOf(prompted as StatutoryFinding);
			await recordStatutoryAcknowledgement(db, {
				...(subject as StatutoryAcknowledgementSubject),
				organizationId: org.id,
				actorUserId: owner.userId,
				inputFingerprint: prompted?.inputFingerprint ?? "",
				reason: "Student, no other employment this year (questionnaire on file)",
			});
			const stateOf = async () => {
				const finding = await evaluateMay();
				const [attached] = await attachAcknowledgementStates(db, org.id, finding ? [finding] : []);
				return attached?.acknowledgement?.status;
			};
			expect(await stateOf()).toBe("current");

			await st.shift(org, worker, "2026-05-29");
			expect(await stateOf()).toBe("stale");
		});

		it("prices a shift that has not started yet on a day that already has completed work", async () => {
			const { org, worker } = await earner("a", 7);
			// 08:00 in Berlin: the morning's work is done, the afternoon shift is still ahead.
			const now = Temporal.Instant.from("2026-05-20T06:00:00Z");
			await st.work(org, worker, "2026-05-20", "05:00", "07:00");
			// Started this morning: its recorded work stands for it.
			await st.shift(org, worker, "2026-05-20", "05:00", "07:00");
			await st.shift(org, worker, "2026-05-20", "14:00", "18:00");

			const [evaluation] = await evaluate(org, [worker.employeeId], { now });

			// 560 EUR before today + 40 EUR this morning + 80 EUR planned this afternoon.
			expect(evaluation?.findings).toEqual([
				expect.objectContaining({
					kind: "short_term_berufsmaessigkeit_check",
					adminDetail: expect.objectContaining({
						amountsCents: { earned: 60_000, planned: 8_000, total: 68_000, cap: 60_300 },
					}),
				}),
			]);
		});

		describe("verification fingerprint", () => {
			async function verifiedAt(now: Temporal.Instant) {
				const { org, worker } = await earner("a", 7);
				const owner = await fx.user("owner");
				// 560 EUR worked + 80 EUR planned on 20 May, 09:00–13:00.
				await st.shift(org, worker, "2026-05-20", "09:00", "13:00");
				const [finding] = (await evaluate(org, [worker.employeeId], { now }))[0]?.findings ?? [];
				await recordStatutoryAcknowledgement(db, {
					...(statutoryAcknowledgementSubjectOf(
						finding as StatutoryFinding,
					) as StatutoryAcknowledgementSubject),
					organizationId: org.id,
					actorUserId: owner.userId,
					inputFingerprint: finding?.inputFingerprint ?? "",
					reason: "Verified",
				});
				const stateAt = async (at: Temporal.Instant) => {
					const [after] =
						(await evaluate(org, [worker.employeeId], { now: at }))[0]?.findings ?? [];
					const [attached] = await attachAcknowledgementStates(db, org.id, after ? [after] : []);
					return attached?.acknowledgement?.status;
				};
				return { org, worker, stateAt };
			}

			it("stays current when a shift is worked as planned and past midnight", async () => {
				const { org, worker, stateAt } = await verifiedAt(
					Temporal.Instant.from("2026-05-20T05:00:00Z"),
				);
				await st.work(org, worker, "2026-05-20", "09:00", "13:00");

				expect(await stateAt(Temporal.Instant.from("2026-05-20T12:00:00Z"))).toBe("current");
				expect(await stateAt(Temporal.Instant.from("2026-05-20T22:30:00Z"))).toBe("current");

				await st.shift(org, worker, "2026-05-27");
				expect(await stateAt(Temporal.Instant.from("2026-05-20T22:30:00Z"))).toBe("stale");
			});

			it("stays current while the shift's clock-in is open", async () => {
				const { org, worker, stateAt } = await verifiedAt(
					Temporal.Instant.from("2026-05-20T05:00:00Z"),
				);
				await st.openWork(org, worker, "2026-05-20", "09:00");

				expect(await stateAt(Temporal.Instant.from("2026-05-20T07:30:30Z"))).toBe("current");
				expect(await stateAt(Temporal.Instant.from("2026-05-20T10:10:45Z"))).toBe("current");
			});

			/** The month's prompt total and fingerprint at each instant, in order. */
			async function promptsAt(
				org: { id: string; timezone: string },
				employeeId: string,
				instants: readonly string[],
			) {
				const seen: { total: unknown; fingerprint: string | undefined }[] = [];
				for (const at of instants) {
					const [finding] =
						(
							await evaluate(org, [employeeId], { now: Temporal.Instant.from(at) })
						)[0]?.findings.filter((f) => f.kind === "short_term_berufsmaessigkeit_check") ?? [];
					seen.push({
						total: finding?.adminDetail?.amountsCents?.total,
						fingerprint: finding?.inputFingerprint,
					});
				}
				return seen;
			}

			it("keeps total and fingerprint while a clock-in with seconds is open", async () => {
				// 20.10 EUR an hour: half a cent a minute, so rounding shows up on odd minutes.
				const { org, worker } = await earner("a", 7, 20.1);
				await st.shift(org, worker, "2026-05-20", "09:00", "13:00");
				await st.openWork(org, worker, "2026-05-20", "09:00:42");

				const seen = await promptsAt(org, worker.employeeId, [
					// 10:15:30 and 10:15:50 in Berlin, either side of the clock-in's 42 seconds.
					"2026-05-20T08:15:30Z",
					"2026-05-20T08:15:50Z",
					"2026-05-20T08:16:30Z",
					"2026-05-20T08:17:41Z",
					"2026-05-20T09:47:55Z",
					"2026-05-20T10:59:59Z",
				]);

				// 28 hours before + the shift from 09:00 to 13:00: 32 hours at 20.10 EUR.
				expect(seen[0]?.total).toBe(64_320);
				expect(seen[0]?.fingerprint).toEqual(expect.any(String));
				for (const later of seen) expect(later).toEqual(seen[0]);
			});

			it("dates an early clock-in for a midnight shift on the shift's day throughout", async () => {
				const { org, worker } = await earner("a", 7);
				await st.shift(org, worker, "2026-05-20", "00:00", "06:00");
				const clockIn = await st.openWork(org, worker, "2026-05-19", "23:50");
				const allowanceAt = async (at: string) =>
					(await evaluate(org, [worker.employeeId], { now: Temporal.Instant.from(at) }))[0]
						?.allowance;

				// 23:55 on 19 May and 03:00 on 20 May in Berlin.
				const open = await promptsAt(org, worker.employeeId, [
					"2026-05-19T21:55:00Z",
					"2026-05-20T01:00:00Z",
				]);
				expect(await allowanceAt("2026-05-19T21:55:00Z")).toMatchObject({
					used: 8,
					lastDay: "2026-05-20",
				});
				await st.clockOut(org, clockIn, "2026-05-20", "06:00");
				const [closed] = await promptsAt(org, worker.employeeId, ["2026-05-20T05:00:00Z"]);

				// 560 EUR before + 23:50–06:00 at 20 EUR.
				expect(open[0]?.total).toBe(68_333);
				for (const later of [open[1], closed]) expect(later).toEqual(open[0]);
				expect(await allowanceAt("2026-05-20T05:00:00Z")).toMatchObject({
					used: 8,
					lastDay: "2026-05-20",
				});
			});

			it("keeps an early clock-in for a shift on the 1st in the shift's month", async () => {
				const { org, worker } = await earner("a", 7);
				await st.shift(org, worker, "2026-06-01", "00:00", "06:00");
				const clockIn = await st.openWork(org, worker, "2026-05-31", "23:50");
				const mayAt = async (at: string) => {
					const [evaluation] = await evaluate(org, [worker.employeeId], {
						now: Temporal.Instant.from(at),
					});
					return {
						days: evaluation?.allowance?.used,
						mayPrompt: evaluation?.findings.some((f) => f.subjectKey === "2026-05"),
					};
				};

				// 23:55 on 31 May and 03:00 on 1 June in Berlin, then after clocking out.
				const before = await mayAt("2026-05-31T21:55:00Z");
				const during = await mayAt("2026-06-01T01:00:00Z");
				await st.clockOut(org, clockIn, "2026-06-01", "06:00");
				const after = await mayAt("2026-06-01T05:00:00Z");

				// May keeps its 560 EUR below the cap; the night's 123 EUR belong to June.
				expect(before).toEqual({ days: 8, mayPrompt: false });
				expect(during).toEqual(before);
				expect(after).toEqual(before);
			});

			it("splits one clock-in over shifts on two days at the later shift's start", async () => {
				const { org, worker } = await earner("a", 7);
				await st.shift(org, worker, "2026-05-31", "22:00", "00:00");
				await st.shift(org, worker, "2026-06-01", "00:00", "06:00");
				await st.work(org, worker, "2026-05-31", "22:00", "06:00");

				const [evaluation] = await evaluate(org, [worker.employeeId]);

				// 31 May keeps 2 hours (600 EUR in May, below the cap); 1 June gets the other 6.
				expect(evaluation?.allowance).toMatchObject({ used: 9, lastDay: "2026-06-01" });
				expect(evaluation?.findings.some((f) => f.subjectKey === "2026-05")).toBe(false);
			});

			it("keeps counting the rest of the shift during a clocked-out break", async () => {
				const { org, worker } = await earner("a", 7);
				await st.shift(org, worker, "2026-05-20", "08:00", "18:00");
				const morning = await st.openWork(org, worker, "2026-05-20", "08:00");
				const [beforeBreak] = await promptsAt(org, worker.employeeId, ["2026-05-20T09:59:30Z"]);
				// 560 EUR before + the 10-hour shift at 20 EUR.
				expect(beforeBreak?.total).toBe(76_000);

				await st.clockOut(org, morning, "2026-05-20", "12:00");
				const duringBreak = await promptsAt(org, worker.employeeId, [
					"2026-05-20T10:00:30Z",
					"2026-05-20T10:15:00Z",
					"2026-05-20T10:29:59Z",
				]);
				for (const during of duringBreak) expect(during).toEqual(beforeBreak);

				// Back at 12:30: the unworked half hour drops out, and the total stays put again.
				await st.openWork(org, worker, "2026-05-20", "12:30");
				const afterBreak = await promptsAt(org, worker.employeeId, [
					"2026-05-20T10:30:30Z",
					"2026-05-20T13:00:00Z",
				]);
				expect(afterBreak[0]?.total).toBe(75_000);
				expect(afterBreak[1]).toEqual(afterBreak[0]);
			});

			it("drops the rest of a shift left early once the shift has ended", async () => {
				const { org, worker } = await earner("a", 7);
				await st.shift(org, worker, "2026-05-20", "08:00", "18:00");
				await st.work(org, worker, "2026-05-20", "08:00", "12:00");

				const [during, after] = await promptsAt(org, worker.employeeId, [
					"2026-05-20T12:00:00Z",
					"2026-05-20T16:00:01Z",
				]);

				// 14:00 in Berlin: the rest until 18:00 still counts; after 18:00 only the 4 hours worked.
				expect(during?.total).toBe(76_000);
				expect(after?.total).toBe(64_000);
			});

			it("stays current when a clock-in with seconds is clocked out", async () => {
				const { org, worker } = await earner("a", 7);
				const owner = await fx.user("owner");
				await st.shift(org, worker, "2026-05-20", "09:00", "17:00");
				const clockIn = await st.openWork(org, worker, "2026-05-20", "09:00:50");
				// 12:30:20 in Berlin, during the shift.
				const during = Temporal.Instant.from("2026-05-20T10:30:20Z");
				const [finding] =
					(await evaluate(org, [worker.employeeId], { now: during }))[0]?.findings ?? [];
				// 560 EUR before + the 8-hour shift at 20 EUR.
				expect(finding?.adminDetail?.amountsCents?.total).toBe(72_000);
				await recordStatutoryAcknowledgement(db, {
					...(statutoryAcknowledgementSubjectOf(
						finding as StatutoryFinding,
					) as StatutoryAcknowledgementSubject),
					organizationId: org.id,
					actorUserId: owner.userId,
					inputFingerprint: finding?.inputFingerprint ?? "",
					reason: "Verified",
				});

				// Out at 17:00:10: 7 hours 59 minutes 20 seconds of recorded work, the shift worked.
				await st.clockOut(org, clockIn, "2026-05-20", "17:00:10");
				const [after] =
					(
						await evaluate(org, [worker.employeeId], {
							now: Temporal.Instant.from("2026-05-20T15:30:00Z"),
						})
					)[0]?.findings ?? [];
				const [attached] = await attachAcknowledgementStates(db, org.id, after ? [after] : []);

				expect(after?.adminDetail?.amountsCents?.total).toBe(72_000);
				expect(attached?.acknowledgement?.status).toBe("current");
			});

			describe("with an open clock-in without a shift", () => {
				/** 640 EUR worked in May, and a clock-in without a shift on 20 May. */
				async function unplannedClockIn(clockIn = "08:00") {
					const { org, worker } = await earner("a", 8);
					const owner = await fx.user("owner");
					await st.openWork(org, worker, "2026-05-20", clockIn);
					/** The May prompt in Reviews & Conflicts at `at`. */
					const shownAt = async (at: string) =>
						(
							await listShortTermBerufsmaessigkeitReviews(db, {
								organizationId: org.id,
								timezone: org.timezone,
								now: Temporal.Instant.from(at),
								includeResolved: true,
							})
						).find((review) => review.month === "2026-05")?.finding;
					const acknowledgeAt = (at: string, shown: StatutoryFinding | undefined) =>
						acknowledgeShortTermBerufsmaessigkeit(db, {
							organizationId: org.id,
							actorUserId: owner.userId,
							employeeId: worker.employeeId,
							timezone: org.timezone,
							month: "2026-05",
							reason: "Student, no other employment this year",
							expectedFingerprint: shown?.inputFingerprint ?? "",
							expectedTotalCents: shown?.adminDetail?.amountsCents?.total ?? 0,
							now: Temporal.Instant.from(at),
						});
					return { org, worker, shownAt, acknowledgeAt };
				}

				it("documents the total the admin was shown", async () => {
					const { shownAt, acknowledgeAt } = await unplannedClockIn();
					// 10:00 in Berlin: 640 EUR + 2 hours at 20 EUR.
					const shown = await shownAt("2026-05-20T08:00:00Z");
					expect(shown?.adminDetail?.amountsCents?.total).toBe(68_000);

					// Submitted at 10:10, with 3.33 EUR more on the clock.
					const record = await acknowledgeAt("2026-05-20T08:10:00Z", shown);

					expect(record.metadata).toMatchObject({ documentedTotalCents: 68_000 });
					expect((await shownAt("2026-05-20T08:10:00Z"))?.acknowledgement?.status).toBe("current");
				});

				it("refuses a total that rose by more than 15 minutes' pay since it was shown", async () => {
					const { shownAt, acknowledgeAt } = await unplannedClockIn();
					const shown = await shownAt("2026-05-20T08:00:00Z");

					await expect(acknowledgeAt("2026-05-20T08:30:00Z", shown)).rejects.toMatchObject({
						refusal: "short_term_figures_changed",
					});
				});

				it("goes stale once the clock-in runs more than 15 minutes' pay past the documented total", async () => {
					const { shownAt, acknowledgeAt } = await unplannedClockIn();
					await acknowledgeAt("2026-05-20T08:00:00Z", await shownAt("2026-05-20T08:00:00Z"));

					expect((await shownAt("2026-05-20T08:14:00Z"))?.acknowledgement?.status).toBe("current");
					expect((await shownAt("2026-05-20T08:16:00Z"))?.acknowledgement?.status).toBe("stale");
				});

				it("keeps the fingerprint steady minute by minute and the total within each minute", async () => {
					const { org, worker } = await unplannedClockIn("08:00:42");

					const seen = await promptsAt(org, worker.employeeId, [
						// 10:00:50, 10:00:59, 10:07:20 and 10:14:41 in Berlin.
						"2026-05-20T08:00:50Z",
						"2026-05-20T08:00:59Z",
						"2026-05-20T08:07:20Z",
						"2026-05-20T08:14:41Z",
					]);

					// 640 EUR + 08:00 to 10:00 on the minute grid.
					expect(seen[0]?.total).toBe(68_000);
					expect(seen[1]).toEqual(seen[0]);
					expect(seen.map((s) => s.fingerprint)).toEqual(Array(4).fill(seen[0]?.fingerprint));
					expect(seen[3]?.total).toBe(68_467);
				});

				it("stays current when the clock-in closes within the step", async () => {
					const { org, shownAt, acknowledgeAt } = await unplannedClockIn();
					const shown = await shownAt("2026-05-20T08:00:00Z");
					await acknowledgeAt("2026-05-20T08:00:00Z", shown);
					const [period] = (
						await admin.query<{ id: string }>(
							"SELECT id FROM work_period WHERE organization_id = $1 AND is_active",
							[org.id],
						)
					).rows;

					await st.clockOut(org, period?.id ?? "", "2026-05-20", "10:05");

					expect((await shownAt("2026-05-20T12:00:00Z"))?.acknowledgement?.status).toBe("current");
				});
			});
		});

		describe("work on New Year's Eve for a shift on 1 January", () => {
			const JANUARY_NOW = Temporal.Instant.from("2027-01-20T12:00:00Z");

			/** Eight 4-hour January days at 20 EUR: 640 EUR against the 633 EUR cap of 2027. */
			async function januaryEarner() {
				const org = await fx.organization("a");
				const worker = await fx.employee(org, "worker", { contractType: "hourly" });
				await st.terms(worker, { from: "2026-12-01", hourlyRate: 20 });
				for (let day = 4; day <= 11; day++) {
					await st.work(org, worker, `2027-01-${String(day).padStart(2, "0")}`);
				}
				return { org, worker };
			}

			function januaryPrompt(evaluations: Awaited<ReturnType<typeof evaluate>>) {
				const finding = evaluations
					.flatMap((e) => e.findings)
					.find(
						(f) => f.kind === "short_term_berufsmaessigkeit_check" && f.subjectKey === "2027-01",
					);
				return {
					amounts: finding?.adminDetail?.amountsCents,
					fingerprint: finding?.inputFingerprint,
				};
			}

			it("gives January the same figures whether or not the previous year is evaluated", async () => {
				const { org, worker } = await januaryEarner();
				await st.shift(org, worker, "2026-12-31", "18:00", "00:00");
				await st.shift(org, worker, "2027-01-01", "00:00", "06:00");
				await st.work(org, worker, "2026-12-31", "18:00", "06:00");

				const alone = januaryPrompt(
					await evaluate(org, [worker.employeeId], { years: [2027], now: JANUARY_NOW }),
				);
				const withPrevious = januaryPrompt(
					await evaluate(org, [worker.employeeId], { years: [2026, 2027], now: JANUARY_NOW }),
				);

				// 640 EUR + the 6 hours after midnight at 20 EUR.
				expect(alone.amounts).toMatchObject({ earned: 76_000, total: 76_000 });
				expect(alone.fingerprint).toEqual(expect.any(String));
				expect(withPrevious).toEqual(alone);
			});

			it("keeps a clock-in 3 hours before a midnight shift on 1 January in January", async () => {
				const { org, worker } = await januaryEarner();
				await st.shift(org, worker, "2027-01-01", "00:00", "06:00");
				await st.work(org, worker, "2026-12-31", "21:00", "06:00");

				const [evaluation] = await evaluate(org, [worker.employeeId], {
					years: [2027],
					now: JANUARY_NOW,
				});

				// 640 EUR + 21:00–06:00 at 20 EUR, all on the shift's day.
				expect(januaryPrompt([evaluation].filter((e) => e !== undefined)).amounts).toMatchObject({
					earned: 82_000,
				});
				expect(evaluation?.allowance).toMatchObject({ firstDay: "2027-01-01" });
			});

			it("acknowledges the prompt shown in Reviews & Conflicts", async () => {
				const { org, worker } = await januaryEarner();
				const owner = await fx.user("owner");
				await st.shift(org, worker, "2026-12-31", "18:00", "00:00");
				await st.shift(org, worker, "2027-01-01", "00:00", "06:00");
				await st.work(org, worker, "2026-12-31", "18:00", "06:00");

				const reviews = await listShortTermBerufsmaessigkeitReviews(db, {
					organizationId: org.id,
					timezone: org.timezone,
					now: JANUARY_NOW,
				});
				const shown = reviews.find((review) => review.month === "2027-01");
				expect(shown).toBeDefined();

				await expect(
					acknowledgeShortTermBerufsmaessigkeit(db, {
						organizationId: org.id,
						actorUserId: owner.userId,
						employeeId: worker.employeeId,
						timezone: org.timezone,
						month: "2027-01",
						reason: "Student, no other employment this year",
						expectedFingerprint: shown?.finding.inputFingerprint ?? "",
						expectedTotalCents: shown?.finding.adminDetail?.amountsCents?.total ?? 0,
						now: JANUARY_NOW,
					}),
				).resolves.toMatchObject({ inputFingerprint: shown?.finding.inputFingerprint });
			});
		});

		describe("work after midnight for a night shift on 31 December", () => {
			const JANUARY_NOW = Temporal.Instant.from("2027-01-20T12:00:00Z");

			/** Eight 4-hour December days at 20 EUR: 640 EUR against the 603 EUR cap of 2026. */
			async function decemberEarner() {
				const org = await fx.organization("a");
				const worker = await fx.employee(org, "worker", { contractType: "hourly" });
				await st.terms(worker, { from: "2026-12-01", hourlyRate: 20 });
				for (const day of [1, 2, 3, 4, 7, 8, 9, 10]) {
					await st.work(org, worker, `2026-12-${String(day).padStart(2, "0")}`);
				}
				return { org, worker };
			}

			function decemberPrompt(evaluations: Awaited<ReturnType<typeof evaluate>>) {
				const finding = evaluations
					.flatMap((e) => e.findings)
					.find(
						(f) => f.kind === "short_term_berufsmaessigkeit_check" && f.subjectKey === "2026-12",
					);
				return {
					amounts: finding?.adminDetail?.amountsCents,
					fingerprint: finding?.inputFingerprint,
				};
			}

			it("gives December the same figures whether or not the next year is evaluated", async () => {
				const { org, worker } = await decemberEarner();
				await st.shift(org, worker, "2026-12-31", "22:00", "04:00");
				await st.work(org, worker, "2026-12-31", "22:00", "23:30");
				// Back from a break after midnight.
				await st.work(org, worker, "2027-01-01", "00:30", "04:00");

				const alone = decemberPrompt(
					await evaluate(org, [worker.employeeId], { years: [2026], now: JANUARY_NOW }),
				);
				const withNext = decemberPrompt(
					await evaluate(org, [worker.employeeId], { years: [2026, 2027], now: JANUARY_NOW }),
				);

				// 640 EUR + 1.5 + 3.5 hours of the night shift at 20 EUR.
				expect(alone.amounts).toMatchObject({ earned: 74_000, total: 74_000 });
				expect(alone.fingerprint).toEqual(expect.any(String));
				expect(withNext).toEqual(alone);
			});

			it("counts 31 December for a late clock-in after midnight", async () => {
				const { org, worker } = await decemberEarner();
				await st.shift(org, worker, "2026-12-31", "23:00", "05:00");
				await st.work(org, worker, "2027-01-01", "00:05", "05:00");

				const [evaluation] = await evaluate(org, [worker.employeeId], {
					years: [2026],
					now: JANUARY_NOW,
				});

				expect(evaluation?.allowance).toMatchObject({ used: 9, lastDay: "2026-12-31" });
			});

			it("prices a still open clock-in after midnight the same in both runs", async () => {
				const { org, worker } = await decemberEarner();
				// 02:00 in Berlin on 1 January: back from a break since 00:30, the shift runs until 04:00.
				const now = Temporal.Instant.from("2027-01-01T01:00:00Z");
				await st.shift(org, worker, "2026-12-31", "22:00", "04:00");
				await st.work(org, worker, "2026-12-31", "22:00", "23:30");
				await st.openWork(org, worker, "2027-01-01", "00:30");

				const alone = decemberPrompt(
					await evaluate(org, [worker.employeeId], { years: [2026], now }),
				);
				const withNext = decemberPrompt(
					await evaluate(org, [worker.employeeId], { years: [2026, 2027], now }),
				);

				// 640 EUR + 1.5 hours + 1.5 hours so far, and 2 hours for the rest.
				expect(alone.amounts).toMatchObject({ earned: 70_000, planned: 4_000, total: 74_000 });
				expect(withNext).toEqual(alone);
			});

			it("acknowledges the prompt shown in Reviews & Conflicts", async () => {
				const { org, worker } = await decemberEarner();
				const owner = await fx.user("owner");
				await st.shift(org, worker, "2026-12-31", "22:00", "04:00");
				await st.work(org, worker, "2026-12-31", "22:00", "23:30");
				await st.work(org, worker, "2027-01-01", "00:30", "04:00");

				const reviews = await listShortTermBerufsmaessigkeitReviews(db, {
					organizationId: org.id,
					timezone: org.timezone,
					now: JANUARY_NOW,
				});
				const shown = reviews.find((review) => review.month === "2026-12");
				expect(shown).toBeDefined();

				await expect(
					acknowledgeShortTermBerufsmaessigkeit(db, {
						organizationId: org.id,
						actorUserId: owner.userId,
						employeeId: worker.employeeId,
						timezone: org.timezone,
						month: "2026-12",
						reason: "Student, no other employment this year",
						expectedFingerprint: shown?.finding.inputFingerprint ?? "",
						expectedTotalCents: shown?.finding.adminDetail?.amountsCents?.total ?? 0,
						now: JANUARY_NOW,
					}),
				).resolves.toMatchObject({ inputFingerprint: shown?.finding.inputFingerprint });
			});
		});

		it("lists next year's prompt in Reviews & Conflicts and acknowledges it", async () => {
			const org = await fx.organization("a");
			const worker = await fx.employee(org, "worker", { contractType: "hourly" });
			const owner = await fx.user("owner");
			await st.terms(worker, { from: "2026-12-01", hourlyRate: 20 });
			await st.fixedTermAgreement(worker, "2026-12-01", "2027-01-31");
			// The January rota: nine 4-hour shifts at 20 EUR, 720 EUR against the 633 EUR cap of 2027.
			for (let day = 4; day <= 12; day++) {
				await st.shift(org, worker, `2027-01-${String(day).padStart(2, "0")}`);
			}
			const now = Temporal.Instant.from("2026-11-23T12:00:00Z");

			const reviews = await listShortTermBerufsmaessigkeitReviews(db, {
				organizationId: org.id,
				timezone: org.timezone,
				now,
			});
			const shown = reviews.find((review) => review.month === "2027-01");

			expect(shown?.finding.adminDetail?.amountsCents).toMatchObject({
				earned: 0,
				planned: 72_000,
				total: 72_000,
			});
			await expect(
				acknowledgeShortTermBerufsmaessigkeit(db, {
					organizationId: org.id,
					actorUserId: owner.userId,
					employeeId: worker.employeeId,
					timezone: org.timezone,
					month: "2027-01",
					reason: "Student, no other employment next year",
					expectedFingerprint: shown?.finding.inputFingerprint ?? "",
					expectedTotalCents: shown?.finding.adminDetail?.amountsCents?.total ?? 0,
					now,
				}),
			).resolves.toMatchObject({ subjectKey: "2027-01" });
		});

		it("keeps a second shift of a day with completed work while its clock-in is open", async () => {
			const { org, worker } = await earner("a", 7);
			// 15:00 in Berlin: the morning shift is worked, the afternoon one runs since 14:00.
			const now = Temporal.Instant.from("2026-05-20T13:00:00Z");
			await st.shift(org, worker, "2026-05-20", "08:00", "10:00");
			await st.work(org, worker, "2026-05-20", "08:00", "10:00");
			await st.shift(org, worker, "2026-05-20", "14:00", "18:00");
			await st.openWork(org, worker, "2026-05-20", "14:00");

			const [evaluation] = await evaluate(org, [worker.employeeId], { now });

			// 560 EUR before + 40 EUR this morning + 20 EUR so far, and 60 EUR for the rest.
			expect(evaluation?.findings).toEqual([
				expect.objectContaining({
					kind: "short_term_berufsmaessigkeit_check",
					adminDetail: expect.objectContaining({
						amountsCents: { earned: 62_000, planned: 6_000, total: 68_000, cap: 60_300 },
					}),
				}),
			]);
		});

		it("keeps a night shift that is still running after midnight", async () => {
			const { org, worker } = await earner("a", 7);
			// 03:00 in Berlin on 20 May: the night shift of 19 May runs until 06:00.
			const now = Temporal.Instant.from("2026-05-20T01:00:00Z");
			await st.shift(org, worker, "2026-05-19", "22:00", "06:00");
			await st.openWork(org, worker, "2026-05-19", "22:00");

			const [evaluation] = await evaluate(org, [worker.employeeId], { now });

			// 560 EUR before + 100 EUR worked since 22:00 + 60 EUR for the last three hours.
			expect(evaluation?.allowance).toMatchObject({ used: 8, lastDay: "2026-05-19" });
			expect(evaluation?.findings).toEqual([
				expect.objectContaining({
					kind: "short_term_berufsmaessigkeit_check",
					adminDetail: expect.objectContaining({
						amountsCents: { earned: 66_000, planned: 6_000, total: 72_000, cap: 60_300 },
					}),
				}),
			]);
		});

		it("prices a planned shift across the end of summer time by its real length", async () => {
			const org = await fx.organization("a");
			const worker = await fx.employee(org, "worker", { contractType: "hourly" });
			await st.terms(worker, { from: "2026-01-01", hourlyRate: 20 });
			await workOn(org, worker, ["2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06"]);
			await workOn(org, worker, ["2026-10-07", "2026-10-08", "2026-10-09"]);
			// Clocks go back at 03:00 on 25 October 2026: midnight to 06:00 is seven hours.
			await st.shift(org, worker, "2026-10-25", "00:00", "06:00");

			const [evaluation] = await evaluate(org, [worker.employeeId], {
				now: Temporal.Instant.from("2026-10-20T06:00:00Z"),
			});

			expect(evaluation?.findings).toEqual([
				expect.objectContaining({
					kind: "short_term_berufsmaessigkeit_check",
					adminDetail: expect.objectContaining({
						amountsCents: { earned: 56_000, planned: 14_000, total: 70_000, cap: 60_300 },
					}),
				}),
			]);
		});

		it("goes stale when completed work of the month changes", async () => {
			const { org, worker } = await earner("a", 8);
			const owner = await fx.user("owner");
			const [before] = (await evaluate(org, [worker.employeeId]))[0]?.findings ?? [];
			await recordStatutoryAcknowledgement(db, {
				...(statutoryAcknowledgementSubjectOf(
					before as StatutoryFinding,
				) as StatutoryAcknowledgementSubject),
				organizationId: org.id,
				actorUserId: owner.userId,
				inputFingerprint: before?.inputFingerprint ?? "",
				reason: "Verified",
			});

			await st.work(org, worker, "2026-05-20");
			const [after] = (await evaluate(org, [worker.employeeId]))[0]?.findings ?? [];
			const [attached] = await attachAcknowledgementStates(db, org.id, after ? [after] : []);

			expect(attached?.acknowledgement?.status).toBe("stale");
		});
	});

	it("counts only days under short-term terms and skips other employees", async () => {
		const org = await fx.organization("a");
		const changed = await fx.employee(org, "changed", { contractType: "hourly" });
		const regular = await fx.employee(org, "regular", { contractType: "hourly" });
		await st.terms(changed, { from: "2026-01-01", profile: "regular" });
		await st.terms(changed, { from: "2026-03-01" });
		await st.terms(regular, { from: "2026-01-01", profile: "regular" });
		await st.work(org, changed, "2026-02-27");
		await st.work(org, changed, "2026-03-02");
		await st.work(org, regular, "2026-03-02");

		const evaluations = await evaluate(org, [changed.employeeId, regular.employeeId]);

		expect(evaluations.map((e) => [e.employeeId, e.allowance?.used])).toEqual([
			[changed.employeeId, 1],
		]);
	});
});
