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

	it("judges a continuous five-day week against 3 months, from the first to the last day", async () => {
		const org = await fx.organization("a");
		const atLimit = await fx.employee(org, "at-limit", { contractType: "hourly" });
		const over = await fx.employee(org, "over", { contractType: "hourly" });
		for (const worker of [atLimit, over]) {
			await st.terms(worker, { from: "2026-06-01", weeklyMinutes: 2400 });
			await st.work(org, worker, "2026-06-15");
		}
		await st.work(org, atLimit, "2026-09-14");
		await st.work(org, over, "2026-09-15");

		const evaluations = await evaluate(org, [atLimit.employeeId, over.employeeId]);
		const byEmployee = new Map(evaluations.map((e) => [e.employeeId, e]));

		expect(byEmployee.get(atLimit.employeeId)?.allowance).toMatchObject({
			limitKind: "months",
			used: 3,
			limit: 3,
			remaining: 0,
			tier: "critical",
		});
		expect(byEmployee.get(over.employeeId)?.allowance).toMatchObject({
			limitKind: "months",
			used: 4,
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
					usedPercent: 133,
					used: { unit: "months", value: 4 },
					limit: { unit: "months", value: 3 },
					remaining: { unit: "months", value: 0 },
				},
				acknowledgementKind: null,
			}),
		]);
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
		async function earner(key: string, days: number) {
			const org = await fx.organization(key);
			const worker = await fx.employee(org, "worker", { contractType: "hourly" });
			await st.terms(worker, { from: "2026-01-01", hourlyRate: 20 });
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
