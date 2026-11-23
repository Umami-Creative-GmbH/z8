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

		it("takes the limit from the year's short-term terms when today is outside them", async () => {
			const org = await fx.organization("a");
			const worker = await fx.employee(org, "worker", { contractType: "hourly" });
			await st.terms(worker, {
				from: "2026-06-01",
				until: "2026-09-01",
				workPolicyId: await st.weekdayPolicy(org),
			});

			const [evaluation] = await evaluate(org, [worker.employeeId]);

			expect(evaluation?.allowance).toMatchObject({ limitKind: "months", used: 0, limit: 90 });
		});
	});

	describe("limit chosen from the real week when the terms plan none", () => {
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
		await st.terms(changed, { from: "2026-01-01", until: "2026-03-01", profile: "regular" });
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
