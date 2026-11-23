/**
 * #1992: the § 12 TzBfG on-call monitor against real PostgreSQL: 4-full-day call-in notice,
 * weekly call-off bands, the 3-hour minimum call and short-notice acknowledgements.
 */
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { integrationAdminPool } from "@/test/integration-database";
import { statutoryFixture } from "@/test/statutory-fixtures";
import { evaluateOnCallFindings } from "./monitor";
import { localInstant, onCallFixture } from "./testing/on-call-fixture";
import { loadOnCallEmployeeStatus } from "./views";

describe("§ 12 TzBfG on-call monitor (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	const fx = statutoryFixture(admin, "t1992-monitor");
	const onCall = onCallFixture(admin, fx);

	beforeEach(fx.cleanup);
	afterAll(fx.cleanup);

	async function onCallWorker(
		kind: "unspecified" | "minimum" | "maximum" | "exact" = "unspecified",
	) {
		const org = await onCall.organization("a");
		const worker = await fx.employee(org, "worker", { contractType: "hourly" });
		await onCall.onCallTerms(org, worker, { kind, weeklyMinutes: 600 });
		return { org, worker };
	}

	describe("4-full-day call-in notice (§ 12 Abs. 3 TzBfG)", () => {
		// Saturday 2026-03-07: Monday's notice leaves Tue–Fri (4 full days), Tuesday's leaves 3.
		it("passes a call published on Monday for Saturday and warns one published on Tuesday", async () => {
			const { org, worker } = await onCallWorker();
			const onTime = await onCall.shift(org, {
				employeeId: worker.employeeId,
				date: "2026-03-07",
				startTime: "09:00",
				endTime: "13:00",
				publishedAt: localInstant("2026-03-02", "23:59", org.timezone),
			});
			const late = await onCall.shift(org, {
				employeeId: worker.employeeId,
				date: "2026-03-07",
				startTime: "14:00",
				endTime: "18:00",
				publishedAt: localInstant("2026-03-03", "00:01", org.timezone),
			});

			const findings = await evaluateOnCallFindings(db, {
				organizationId: org.id,
				timezone: org.timezone,
				window: { start: "2026-03-07", endExclusive: "2026-03-08" },
				employeeIds: [worker.employeeId],
				now: Temporal.Instant.from("2026-03-04T12:00:00Z"),
			});

			const notice = findings.filter((f) => f.kind === "on_call_short_notice");
			expect(notice.map((f) => f.subjectKey)).toEqual([`shift:${late}`]);
			expect(notice[0]).toMatchObject({
				domain: "on_call",
				severity: "warning",
				legalReference: "§ 12 Abs. 3 TzBfG",
				acknowledgementKind: "on_call_short_notice_agreement",
				summary: { used: { unit: "days", value: 3 }, limit: { unit: "days", value: 4 } },
				adminDetail: null,
			});
			expect(findings.some((f) => f.subjectKey === `shift:${onTime}`)).toBe(false);
		});

		it.each([
			// Spring forward: Sunday 2026-03-29 has 23 hours and is still one full day.
			{
				shiftDate: "2026-03-30",
				onTime: "2026-03-25T22:30:00Z", // Wed 23:30 CET → Thu–Sun
				late: "2026-03-25T23:30:00Z", // Thu 00:30 CET (still Wednesday in UTC) → Fri–Sun
			},
			// Fall back: Sunday 2026-10-25 has 25 hours.
			{
				shiftDate: "2026-10-26",
				onTime: "2026-10-21T21:30:00Z", // Wed 23:30 CEST → Thu–Sun
				late: "2026-10-21T22:30:00Z", // Thu 00:30 CEST → Fri–Sun
			},
		])("counts organization-local calendar days across DST ($shiftDate)", async (input) => {
			const { org, worker } = await onCallWorker();
			const onTime = await onCall.shift(org, {
				employeeId: worker.employeeId,
				date: input.shiftDate,
				startTime: "08:00",
				endTime: "12:00",
				publishedAt: Temporal.Instant.from(input.onTime),
			});
			const late = await onCall.shift(org, {
				employeeId: worker.employeeId,
				date: input.shiftDate,
				startTime: "13:00",
				endTime: "17:00",
				publishedAt: Temporal.Instant.from(input.late),
			});

			const notice = (
				await evaluateOnCallFindings(db, {
					organizationId: org.id,
					timezone: org.timezone,
					window: {
						start: input.shiftDate,
						endExclusive: Temporal.PlainDate.from(input.shiftDate).add({ days: 1 }).toString(),
					},
					employeeIds: [worker.employeeId],
					now: Temporal.Instant.from("2026-12-01T00:00:00Z"),
				})
			).filter((f) => f.kind === "on_call_short_notice");

			expect(notice.map((f) => [f.subjectKey, f.summary.used?.value])).toEqual([
				[`shift:${late}`, 3],
			]);
			expect(notice.some((f) => f.subjectKey === `shift:${onTime}`)).toBe(false);
		});

		it("announces a draft when it is published, and a moved shift when it moved", async () => {
			const { org, worker } = await onCallWorker();
			const draft = await onCall.shift(org, {
				employeeId: worker.employeeId,
				date: "2026-03-07",
				startTime: "09:00",
				endTime: "13:00",
				status: "draft",
			});
			// Published well ahead on 2026-02-20, then moved on Thursday 2026-03-05.
			const moved = await onCall.shift(org, {
				employeeId: worker.employeeId,
				date: "2026-03-07",
				startTime: "14:00",
				endTime: "18:00",
				publishedAt: Temporal.Instant.from("2026-02-20T09:00:00Z"),
				assignmentChangedAt: Temporal.Instant.from("2026-03-05T09:00:00Z"),
			});
			const evaluate = (now: string) =>
				evaluateOnCallFindings(db, {
					organizationId: org.id,
					timezone: org.timezone,
					window: { start: "2026-03-07", endExclusive: "2026-03-08" },
					employeeIds: [worker.employeeId],
					now: Temporal.Instant.from(now),
				}).then((findings) =>
					findings
						.filter((f) => f.kind === "on_call_short_notice")
						.map((f) => [f.subjectKey, f.summary.used?.value]),
				);

			// Publishing the draft on Monday gives 4 full days; on Wednesday only 2.
			expect(await evaluate("2026-03-02T10:00:00Z")).toEqual([[`shift:${moved}`, 1]]);
			expect(await evaluate("2026-03-04T10:00:00Z")).toEqual([
				[`shift:${draft}`, 2],
				[`shift:${moved}`, 1],
			]);
		});

		it("ignores employees who are not on call that day", async () => {
			const org = await onCall.organization("a");
			const regular = await fx.employee(org, "regular");
			await onCall.regularTerms(org, regular);
			const later = await fx.employee(org, "later");
			await onCall.onCallTerms(org, later, { kind: "unspecified", from: "2026-03-08" });
			for (const who of [regular, later]) {
				await onCall.shift(org, {
					employeeId: who.employeeId,
					date: "2026-03-07",
					startTime: "09:00",
					endTime: "10:00",
					publishedAt: Temporal.Instant.from("2026-03-06T09:00:00Z"),
				});
			}

			const findings = await evaluateOnCallFindings(db, {
				organizationId: org.id,
				timezone: org.timezone,
				window: { start: "2026-03-07", endExclusive: "2026-03-08" },
				now: Temporal.Instant.from("2026-03-06T10:00:00Z"),
			});

			expect(findings.filter((f) => f.employeeId === regular.employeeId)).toEqual([]);
			expect(findings.filter((f) => f.periodStart === "2026-03-07")).toEqual([]);
		});
	});

	describe("minimum call (§ 12 Abs. 1 Satz 4 TzBfG)", () => {
		it("flags shifts and finished work days shorter than 3 hours or the agreed call", async () => {
			const org = await onCall.organization("a");
			const statutory = await fx.employee(org, "statutory");
			await onCall.onCallTerms(org, statutory, { kind: "unspecified" });
			const agreed = await fx.employee(org, "agreed");
			await onCall.onCallTerms(org, agreed, {
				kind: "exact",
				weeklyMinutes: 600,
				dailyMinutes: 240,
			});
			const shift = (who: { employeeId: string }, startTime: string, endTime: string) =>
				onCall.shift(org, {
					employeeId: who.employeeId,
					date: "2026-03-12",
					startTime,
					endTime,
					publishedAt: Temporal.Instant.from("2026-02-01T09:00:00Z"),
				});
			const twoHours59 = await shift(statutory, "09:00", "11:59");
			await shift(statutory, "13:00", "16:00");
			const threeHours = await shift(agreed, "09:00", "12:00");
			// More than a break later: a call of its own.
			await shift(agreed, "13:30", "17:30");
			await onCall.work(org, statutory, {
				date: "2026-03-10",
				startTime: "09:00",
				endTime: "11:00",
			});
			await onCall.work(org, statutory, {
				date: "2026-03-11",
				startTime: "09:00",
				endTime: "12:00",
			});
			await onCall.work(org, agreed, { date: "2026-03-10", startTime: "22:00", endTime: "01:00" });

			const findings = await evaluateOnCallFindings(db, {
				organizationId: org.id,
				timezone: org.timezone,
				window: { start: "2026-03-09", endExclusive: "2026-03-16" },
				now: Temporal.Instant.from("2026-03-11T23:30:00Z"),
			});
			const short = findings
				.filter((f) => f.kind === "on_call_short_call" || f.kind === "on_call_short_work_call")
				.map((f) => [f.employeeId, f.subjectKey, f.summary.used?.value, f.summary.limit?.value])
				.toSorted((a, b) => String(a).localeCompare(String(b)));

			expect(short).toEqual(
				[
					[statutory.employeeId, `shift:${twoHours59}`, 179, 180],
					[statutory.employeeId, "work:2026-03-10T09:00", 120, 180],
					[agreed.employeeId, `shift:${threeHours}`, 180, 240],
					[agreed.employeeId, "work:2026-03-10T22:00", 180, 240],
				].toSorted((a, b) => String(a).localeCompare(String(b))),
			);
			expect(findings.find((f) => f.kind === "on_call_short_call")?.legalReference).toBe(
				"§ 12 Abs. 1 Satz 4 TzBfG",
			);
		});

		it("judges each call separately: two short calls on one day are two violations", async () => {
			const org = await onCall.organization("a");
			const worker = await fx.employee(org, "worker");
			await onCall.onCallTerms(org, worker, { kind: "unspecified" });
			// Two calls on Tuesday, 6 hours apart: 4 h worked that day, but each call is 2 h.
			await onCall.work(org, worker, { date: "2026-03-10", startTime: "08:00", endTime: "10:00" });
			await onCall.work(org, worker, { date: "2026-03-10", startTime: "16:00", endTime: "18:00" });
			// Wednesday: one call of 3 h interrupted by a 30-minute break.
			await onCall.work(org, worker, { date: "2026-03-11", startTime: "08:00", endTime: "09:30" });
			await onCall.work(org, worker, { date: "2026-03-11", startTime: "10:00", endTime: "11:30" });
			// Thursday: one planned call, worked with a long break inside the shift.
			await onCall.shift(org, {
				employeeId: worker.employeeId,
				date: "2026-03-12",
				startTime: "08:00",
				endTime: "17:00",
				publishedAt: Temporal.Instant.from("2026-02-01T09:00:00Z"),
			});
			await onCall.work(org, worker, { date: "2026-03-12", startTime: "08:00", endTime: "10:00" });
			await onCall.work(org, worker, { date: "2026-03-12", startTime: "12:00", endTime: "13:30" });

			const findings = await evaluateOnCallFindings(db, {
				organizationId: org.id,
				timezone: org.timezone,
				window: { start: "2026-03-09", endExclusive: "2026-03-16" },
				employeeIds: [worker.employeeId],
				now: Temporal.Instant.from("2026-03-14T12:00:00Z"),
			});

			expect(
				findings
					.filter((f) => f.kind === "on_call_short_work_call")
					.map((f) => [f.subjectKey, f.periodStart, f.summary.used?.value])
					.toSorted((a, b) => String(a).localeCompare(String(b))),
			).toEqual([
				["work:2026-03-10T08:00", "2026-03-10", 120],
				["work:2026-03-10T16:00", "2026-03-10", 120],
			]);
		});

		it("joins planned shifts that are adjacent or a break apart into one call", async () => {
			const org = await onCall.organization("a");
			const worker = await fx.employee(org, "worker");
			await onCall.onCallTerms(org, worker, { kind: "unspecified" });
			const shift = (date: string, startTime: string, endTime: string) =>
				onCall.shift(org, {
					employeeId: worker.employeeId,
					date,
					startTime,
					endTime,
					publishedAt: Temporal.Instant.from("2026-02-01T09:00:00Z"),
				});
			// Tuesday: 08–10 and 10–12 are one 4-hour call.
			await shift("2026-03-10", "08:00", "10:00");
			await shift("2026-03-10", "10:00", "12:00");
			// Wednesday: 1.5 h, a 1-hour break, 1.5 h: one 3-hour call.
			await shift("2026-03-11", "08:00", "09:30");
			await shift("2026-03-11", "10:30", "12:00");
			// Thursday: two 2-hour calls 4 hours apart are two short calls.
			const morning = await shift("2026-03-12", "08:00", "10:00");
			const afternoon = await shift("2026-03-12", "14:00", "16:00");

			const findings = await evaluateOnCallFindings(db, {
				organizationId: org.id,
				timezone: org.timezone,
				window: { start: "2026-03-09", endExclusive: "2026-03-16" },
				employeeIds: [worker.employeeId],
				now: Temporal.Instant.from("2026-03-01T12:00:00Z"),
			});

			expect(
				findings
					.filter((f) => f.kind === "on_call_short_call")
					.map((f) => [f.subjectKey, f.summary.used?.value])
					.toSorted((a, b) => String(a).localeCompare(String(b))),
			).toEqual(
				[
					[`shift:${morning}`, 120],
					[`shift:${afternoon}`, 120],
				].toSorted((a, b) => String(a).localeCompare(String(b))),
			);
		});

		it("does not judge a call that is still running", async () => {
			const org = await onCall.organization("a");
			const worker = await fx.employee(org, "worker");
			await onCall.onCallTerms(org, worker, { kind: "unspecified" });
			// Started yesterday evening, back from a short break and still clocked in.
			await onCall.work(org, worker, { date: "2026-03-10", startTime: "20:00", endTime: "21:30" });
			await onCall.openWork(org, worker, { date: "2026-03-10", startTime: "22:00" });

			const findings = await evaluateOnCallFindings(db, {
				organizationId: org.id,
				timezone: org.timezone,
				window: { start: "2026-03-09", endExclusive: "2026-03-16" },
				employeeIds: [worker.employeeId],
				now: Temporal.Instant.from("2026-03-11T00:30:00Z"),
			});

			expect(findings.filter((f) => f.kind === "on_call_short_work_call")).toEqual([]);
		});
	});

	describe("weekly call-off band (§ 12 Abs. 2 TzBfG)", () => {
		/** Week 2026-W11 (Mon 2026-03-09 … Sun 03-15), judged after it ended. */
		const WEEK = { start: "2026-03-09", endExclusive: "2026-03-16" };
		const AFTER_WEEK = Temporal.Instant.from("2026-03-20T12:00:00Z");

		async function workerWorking(
			kind: "unspecified" | "minimum" | "maximum" | "exact",
			weeklyMinutes: number | null,
			workedHours: readonly number[],
		) {
			const org = await onCall.organization("a");
			const worker = await fx.employee(org, "worker");
			await onCall.onCallTerms(org, worker, { kind, weeklyMinutes });
			for (const [index, hours] of workedHours.entries()) {
				const date = Temporal.PlainDate.from(WEEK.start).add({ days: index }).toString();
				const end = `${String(8 + Math.floor(hours)).padStart(2, "0")}:${String(Math.round((hours % 1) * 60)).padStart(2, "0")}`;
				await onCall.work(org, worker, { date, startTime: "08:00", endTime: end });
			}
			const findings = await evaluateOnCallFindings(db, {
				organizationId: org.id,
				timezone: org.timezone,
				window: WEEK,
				employeeIds: [worker.employeeId],
				now: AFTER_WEEK,
			});
			return findings
				.filter((f) => f.kind.startsWith("on_call_weekly"))
				.map((f) => ({
					kind: f.kind,
					severity: f.severity,
					subjectKey: f.subjectKey,
					tier: f.summary.tier,
					used: f.summary.used?.value,
					limit: f.summary.limit?.value,
				}));
		}

		it("minimum: the band is the agreed minutes up to +25 %", async () => {
			// 10 h agreed → at least 10 h, at most 12.5 h (750 min).
			expect(await workerWorking("minimum", 600, [5, 5])).toEqual([]);
			await fx.cleanup();
			// 30 of the 150 headroom minutes used: below the 80 % warning tier.
			expect(await workerWorking("minimum", 600, [5, 5.5])).toEqual([]);
			await fx.cleanup();
			// 120 of 150 headroom minutes: approaching the ceiling.
			expect(await workerWorking("minimum", 600, [4, 4, 4])).toEqual([
				{
					kind: "on_call_weekly_over_band",
					severity: "warning",
					subjectKey: "2026-W11",
					tier: "warning",
					used: 720,
					limit: 750,
				},
			]);
			await fx.cleanup();
			// Exactly at the ceiling is lawful: approaching, never critical.
			expect(await workerWorking("minimum", 600, [4, 4, 4.5])).toEqual([
				expect.objectContaining({ tier: "critical", used: 750, limit: 750, severity: "warning" }),
			]);
			await fx.cleanup();
			expect(await workerWorking("minimum", 600, [4, 4, 4.5, 3])).toEqual([
				{
					kind: "on_call_weekly_over_band",
					severity: "critical",
					subjectKey: "2026-W11",
					tier: "exceeded",
					used: 930,
					limit: 750,
				},
			]);
			await fx.cleanup();
			// A finished week called for 4 h falls short of the agreed 10 h minimum.
			expect(await workerWorking("minimum", 600, [4])).toEqual([
				{
					kind: "on_call_weekly_under_band",
					severity: "warning",
					subjectKey: "2026-W11",
					tier: undefined,
					used: 240,
					limit: 600,
				},
			]);
		});

		it("maximum: the band is the agreed minutes down to −20 %", async () => {
			// 10 h agreed → at least 8 h (480 min), at most 10 h.
			expect(await workerWorking("maximum", 600, [4, 4])).toEqual([]);
			await fx.cleanup();
			expect(await workerWorking("maximum", 600, [5, 5])).toEqual([]);
			await fx.cleanup();
			expect(await workerWorking("maximum", 600, [4, 3.5])).toEqual([
				{
					kind: "on_call_weekly_under_band",
					severity: "warning",
					subjectKey: "2026-W11",
					tier: undefined,
					used: 450,
					limit: 480,
				},
			]);
			await fx.cleanup();
			// 14 h against a 10 h maximum is above the band.
			expect(await workerWorking("maximum", 600, [7, 7])).toEqual([
				{
					kind: "on_call_weekly_over_band",
					severity: "warning",
					subjectKey: "2026-W11",
					tier: "exceeded",
					used: 840,
					limit: 600,
				},
			]);
		});

		it("exact: flags any variance from the agreed minutes", async () => {
			expect(await workerWorking("exact", 600, [5, 5])).toEqual([]);
			await fx.cleanup();
			expect(await workerWorking("exact", 600, [5, 5.5])).toEqual([
				expect.objectContaining({ kind: "on_call_weekly_over_band", used: 630, limit: 600 }),
			]);
			await fx.cleanup();
			expect(await workerWorking("exact", 600, [5, 4.5])).toEqual([
				expect.objectContaining({ kind: "on_call_weekly_under_band", used: 570, limit: 600 }),
			]);
		});

		it("unspecified: judges the statutory 20-hour week from statutory_threshold", async () => {
			expect(await workerWorking("unspecified", null, [4, 4, 4, 4, 4])).toEqual([]);
			await fx.cleanup();
			expect(await workerWorking("unspecified", null, [4, 4, 4, 4, 3])).toEqual([
				expect.objectContaining({
					kind: "on_call_weekly_under_band",
					used: 1140,
					limit: 1200,
					severity: "warning",
				}),
			]);
		});

		it("adds planned shifts of the running week and only informs while it can still be called", async () => {
			const org = await onCall.organization("a");
			const worker = await fx.employee(org, "worker");
			await onCall.onCallTerms(org, worker, { kind: "maximum", weeklyMinutes: 600 });
			await onCall.work(org, worker, { date: "2026-03-09", startTime: "08:00", endTime: "12:00" });
			await onCall.shift(org, {
				employeeId: worker.employeeId,
				date: "2026-03-12",
				startTime: "08:00",
				endTime: "11:00",
				publishedAt: Temporal.Instant.from("2026-02-01T09:00:00Z"),
			});
			const evaluate = () =>
				evaluateOnCallFindings(db, {
					organizationId: org.id,
					timezone: org.timezone,
					window: WEEK,
					employeeIds: [worker.employeeId],
					now: Temporal.Instant.from("2026-03-10T12:00:00Z"),
				}).then((findings) => findings.filter((f) => f.kind.startsWith("on_call_weekly")));

			expect((await evaluate()).map((f) => [f.severity, f.summary.used?.value])).toEqual([
				["info", 420],
			]);
			await onCall.shift(org, {
				employeeId: worker.employeeId,
				date: "2026-03-13",
				startTime: "08:00",
				endTime: "09:00",
				publishedAt: Temporal.Instant.from("2026-02-01T09:00:00Z"),
			});
			expect(await evaluate()).toEqual([]);
		});

		describe("absence and public holidays (§ 12 Abs. 4–5 TzBfG: paid, not called)", () => {
			async function worker(kind: "exact" | "maximum") {
				const org = await onCall.organization("a");
				const who = await fx.employee(org, "worker");
				await onCall.onCallTerms(org, who, { kind, weeklyMinutes: 600 });
				return { org, who };
			}
			const bandFindings = (org: { id: string; timezone: string }, employeeId: string) =>
				evaluateOnCallFindings(db, {
					organizationId: org.id,
					timezone: org.timezone,
					window: WEEK,
					employeeIds: [employeeId],
					now: AFTER_WEEK,
				}).then((findings) =>
					findings
						.filter((f) => f.kind.startsWith("on_call_weekly"))
						.map((f) => [f.kind, f.summary.used?.value, f.summary.limit?.value]),
				);

			it("leaves a week of approved vacation out of an exact agreement", async () => {
				const { org, who } = await worker("exact");
				await onCall.absence(org, who, {
					type: "vacation",
					startDate: "2026-03-09",
					endDate: "2026-03-15",
				});

				expect(await bandFindings(org, who.employeeId)).toEqual([]);
			});

			it("prorates a maximum agreement for three sick days", async () => {
				const { org, who } = await worker("maximum");
				await onCall.absence(org, who, {
					type: "sick",
					startDate: "2026-03-09",
					endDate: "2026-03-11",
				});
				// Four callable days: at least 480 × 4/7 = 274, at most 600 × 4/7 = 343 minutes.
				await onCall.work(org, who, { date: "2026-03-12", startTime: "08:00", endTime: "13:00" });

				expect(await bandFindings(org, who.employeeId)).toEqual([]);
			});

			it("prorates the band for a public holiday, and still flags a week short of it", async () => {
				const { org, who } = await worker("maximum");
				await onCall.holiday(org, who, "2026-03-09");
				// Six callable days: at least 480 × 6/7 = 411 minutes.
				await onCall.work(org, who, { date: "2026-03-10", startTime: "08:00", endTime: "12:00" });
				await onCall.work(org, who, { date: "2026-03-11", startTime: "08:00", endTime: "11:00" });
				expect(await bandFindings(org, who.employeeId)).toEqual([]);

				await fx.cleanup();
				const again = await worker("maximum");
				await onCall.holiday(again.org, again.who, "2026-03-09");
				await onCall.work(again.org, again.who, {
					date: "2026-03-10",
					startTime: "08:00",
					endTime: "14:00",
				});
				expect(await bandFindings(again.org, again.who.employeeId)).toEqual([
					["on_call_weekly_under_band", 360, 411],
				]);
			});

			it("counts a holiday that was worked like any other day", async () => {
				const { org, who } = await worker("exact");
				await onCall.holiday(org, who, "2026-03-09");
				await onCall.work(org, who, { date: "2026-03-09", startTime: "08:00", endTime: "13:00" });
				await onCall.work(org, who, { date: "2026-03-10", startTime: "08:00", endTime: "13:00" });

				expect(await bandFindings(org, who.employeeId)).toEqual([]);
			});

			it("counts a call planned on a holiday, and still releases a holiday neither planned nor worked", async () => {
				const { org, who } = await worker("maximum");
				await onCall.holiday(org, who, "2026-03-09");
				await onCall.holiday(org, who, "2026-03-11");
				const publishedAt = Temporal.Instant.from("2026-02-01T09:00:00Z");
				await onCall.shift(org, {
					employeeId: who.employeeId,
					date: "2026-03-09",
					startTime: "08:00",
					endTime: "16:00",
					publishedAt,
				});
				await onCall.shift(org, {
					employeeId: who.employeeId,
					date: "2026-03-10",
					startTime: "08:00",
					endTime: "11:00",
					publishedAt,
				});

				const findings = await evaluateOnCallFindings(db, {
					organizationId: org.id,
					timezone: org.timezone,
					window: WEEK,
					employeeIds: [who.employeeId],
					now: Temporal.Instant.from("2026-03-02T12:00:00Z"),
				});

				// Wednesday is released, Monday is called: six callable days, at most 600 × 6/7 = 514
				// minutes, and 480 + 180 = 660 planned.
				expect(
					findings
						.filter((f) => f.kind.startsWith("on_call_weekly"))
						.map((f) => [f.kind, f.summary.used?.value, f.summary.limit?.value]),
				).toEqual([["on_call_weekly_over_band", 660, 514]]);
			});
		});

		it("adds today's unplanned call to the shift still to come", async () => {
			const org = await onCall.organization("a");
			const worker = await fx.employee(org, "worker");
			await onCall.onCallTerms(org, worker, { kind: "exact", weeklyMinutes: 600 });
			await onCall.work(org, worker, { date: "2026-03-09", startTime: "08:00", endTime: "12:00" });
			// Tuesday: called in 06:00–08:00 unplanned, and planned 14:00–18:00 later the same day.
			await onCall.work(org, worker, { date: "2026-03-10", startTime: "06:00", endTime: "08:00" });
			await onCall.shift(org, {
				employeeId: worker.employeeId,
				date: "2026-03-10",
				startTime: "14:00",
				endTime: "18:00",
				publishedAt: Temporal.Instant.from("2026-02-01T09:00:00Z"),
			});

			const band = (
				await evaluateOnCallFindings(db, {
					organizationId: org.id,
					timezone: org.timezone,
					window: WEEK,
					employeeIds: [worker.employeeId],
					now: localInstant("2026-03-10", "12:00", org.timezone),
				})
			).filter((f) => f.kind.startsWith("on_call_weekly"));

			expect(band).toEqual([]);
		});

		it("counts a running call on a planned shift once: up to now, then the rest of the shift", async () => {
			const org = await onCall.organization("a");
			const worker = await fx.employee(org, "worker");
			await onCall.onCallTerms(org, worker, { kind: "exact", weeklyMinutes: 600 });
			await onCall.work(org, worker, { date: "2026-03-09", startTime: "08:00", endTime: "12:00" });
			await onCall.shift(org, {
				employeeId: worker.employeeId,
				date: "2026-03-10",
				startTime: "08:00",
				endTime: "14:00",
				publishedAt: Temporal.Instant.from("2026-02-01T09:00:00Z"),
			});
			await onCall.openWork(org, worker, { date: "2026-03-10", startTime: "08:00" });

			const band = (
				await evaluateOnCallFindings(db, {
					organizationId: org.id,
					timezone: org.timezone,
					window: WEEK,
					employeeIds: [worker.employeeId],
					now: localInstant("2026-03-10", "11:00", org.timezone),
				})
			).filter((f) => f.kind.startsWith("on_call_weekly"));

			expect(band).toEqual([]);
		});

		it("counts a running clock-in up to now", async () => {
			const org = await onCall.organization("a");
			const worker = await fx.employee(org, "worker");
			await onCall.onCallTerms(org, worker, { kind: "maximum", weeklyMinutes: 600 });
			await onCall.work(org, worker, { date: "2026-03-09", startTime: "08:00", endTime: "12:00" });
			// Clocked in since Thursday 08:00 and never clocked out: 32 hours by Friday 16:00.
			await onCall.openWork(org, worker, { date: "2026-03-12", startTime: "08:00" });

			const band = (
				await evaluateOnCallFindings(db, {
					organizationId: org.id,
					timezone: org.timezone,
					window: WEEK,
					employeeIds: [worker.employeeId],
					now: Temporal.Instant.from("2026-03-13T15:00:00Z"),
				})
			).filter((f) => f.kind.startsWith("on_call_weekly"));

			expect(band.map((f) => [f.kind, f.summary.used?.value])).toEqual([
				["on_call_weekly_over_band", 240 + 32 * 60],
			]);
		});

		/** Band findings of week 2026-W11 for an exact 600-minute worker, judged at `now`. */
		async function exactWeek(
			now: (timezone: string) => Temporal.Instant,
			seed: (
				org: Awaited<ReturnType<typeof onCall.organization>>,
				worker: Awaited<ReturnType<typeof fx.employee>>,
			) => Promise<void>,
		) {
			const org = await onCall.organization("a");
			const worker = await fx.employee(org, "worker");
			await onCall.onCallTerms(org, worker, { kind: "exact", weeklyMinutes: 600 });
			await seed(org, worker);
			return async (at = now(org.timezone)) =>
				(
					await evaluateOnCallFindings(db, {
						organizationId: org.id,
						timezone: org.timezone,
						window: WEEK,
						employeeIds: [worker.employeeId],
						now: at,
					})
				)
					.filter((f) => f.kind.startsWith("on_call_weekly"))
					.map((f) => [f.kind, f.severity, f.summary.used?.value]);
		}

		it("does not count today's shift that ended unworked as still planned", async () => {
			const band = await exactWeek(
				(timezone) => localInstant("2026-03-10", "20:00", timezone),
				async (org, worker) => {
					await onCall.work(org, worker, {
						date: "2026-03-09",
						startTime: "08:00",
						endTime: "12:00",
					});
					// A no-show on Tuesday's 08:00–16:00 shift.
					await onCall.shift(org, {
						employeeId: worker.employeeId,
						date: "2026-03-10",
						startTime: "08:00",
						endTime: "16:00",
						publishedAt: Temporal.Instant.from("2026-02-01T09:00:00Z"),
					});
				},
			);

			expect(await band()).toEqual([["on_call_weekly_under_band", "info", 240]]);
		});

		it("keeps counting the rest of a running shift during a clocked-out break", async () => {
			const band = await exactWeek(
				(timezone) => localInstant("2026-03-10", "10:30", timezone),
				async (org, worker) => {
					await onCall.work(org, worker, {
						date: "2026-03-09",
						startTime: "08:00",
						endTime: "12:30",
					});
					await onCall.shift(org, {
						employeeId: worker.employeeId,
						date: "2026-03-10",
						startTime: "08:00",
						endTime: "14:00",
						publishedAt: Temporal.Instant.from("2026-02-01T09:00:00Z"),
					});
					// Worked 08:00–10:00, on a break since: 270 + 120 + the 210 minutes still to come.
					await onCall.work(org, worker, {
						date: "2026-03-10",
						startTime: "08:00",
						endTime: "10:00",
					});
				},
			);

			expect(await band()).toEqual([]);
		});

		it("counts a running call with a clock-in at seconds steadily within the minute", async () => {
			const band = await exactWeek(
				(timezone) => localInstant("2026-03-10", "11:00:10", timezone),
				async (org, worker) => {
					await onCall.work(org, worker, {
						date: "2026-03-09",
						startTime: "08:00",
						endTime: "12:00",
					});
					await onCall.shift(org, {
						employeeId: worker.employeeId,
						date: "2026-03-10",
						startTime: "08:00",
						endTime: "14:00",
						publishedAt: Temporal.Instant.from("2026-02-01T09:00:00Z"),
					});
					// Clocked in at seconds, just before the shift: 360 minutes in all at any second.
					await onCall.openWork(org, worker, { date: "2026-03-10", startTime: "07:59:42" });
				},
			);

			for (const second of ["11:00:10", "11:00:35", "11:00:50"]) {
				expect(await band(localInstant("2026-03-10", second, "Europe/Berlin"))).toEqual([]);
			}
		});

		it("keeps the rest of yesterday's overnight shift still running past midnight", async () => {
			const seedOvernight =
				(clockIn: string | null) =>
				async (
					org: Awaited<ReturnType<typeof onCall.organization>>,
					worker: Awaited<ReturnType<typeof fx.employee>>,
				) => {
					await onCall.work(org, worker, {
						date: "2026-03-09",
						startTime: "08:00",
						endTime: "10:00",
					});
					// Tuesday's 22:00–06:00 night shift, judged at Wednesday 02:00: 120 + 480 = 600.
					await onCall.shift(org, {
						employeeId: worker.employeeId,
						date: "2026-03-10",
						startTime: "22:00",
						endTime: "06:00",
						publishedAt: Temporal.Instant.from("2026-02-01T09:00:00Z"),
					});
					if (clockIn) {
						await onCall.openWork(org, worker, { date: "2026-03-10", startTime: clockIn });
					}
				};

			// Clocked in at seconds: worked up to now plus the rest of the shift, steady in the minute.
			const clockedIn = await exactWeek(
				(timezone) => localInstant("2026-03-11", "02:00:10", timezone),
				seedOvernight("21:59:42"),
			);
			for (const second of ["02:00:10", "02:00:35", "02:00:50"]) {
				expect(await clockedIn(localInstant("2026-03-11", second, "Europe/Berlin"))).toEqual([]);
			}
			await fx.cleanup();

			// Not clocked in yet: the rest of the shift after now is still planned (120 + 240).
			const late = await exactWeek(
				(timezone) => localInstant("2026-03-11", "02:00", timezone),
				seedOvernight(null),
			);
			expect(await late()).toEqual([["on_call_weekly_under_band", "info", 360]]);
		});

		it("judges a week whose terms change mid-week by each day's terms", async () => {
			const org = await onCall.organization("a");
			const worker = await fx.employee(org, "worker");
			await onCall.onCallTerms(org, worker, {
				kind: "exact",
				weeklyMinutes: 600,
				until: "2026-03-12",
			});
			await onCall.onCallTerms(org, worker, {
				kind: "exact",
				weeklyMinutes: 1200,
				from: "2026-03-12",
			});
			await onCall.work(org, worker, { date: "2026-03-09", startTime: "08:00", endTime: "16:00" });
			await onCall.work(org, worker, { date: "2026-03-10", startTime: "08:00", endTime: "15:00" });

			const band = (
				await evaluateOnCallFindings(db, {
					organizationId: org.id,
					timezone: org.timezone,
					window: WEEK,
					employeeIds: [worker.employeeId],
					now: AFTER_WEEK,
				})
			).filter((f) => f.kind.startsWith("on_call_weekly"));

			// Mon–Wed 600 × 3/7 + Thu–Sun 1200 × 4/7 = 257.1 + 685.7 ≈ 943 minutes.
			expect(band.map((f) => [f.kind, f.summary.used?.value, f.summary.limit?.value])).toEqual([
				["on_call_weekly_under_band", 900, 943],
			]);
		});
	});

	describe("employee status: drafts stay with the planners", () => {
		// Wednesday of ISO week 2026-W10; the draft call is on Saturday 2026-03-07.
		const NOW = Temporal.Instant.from("2026-03-04T10:00:00Z");

		it("shows the employee no finding and no band minutes of a draft call until it is published", async () => {
			const { org, worker } = await onCallWorker();
			const draft = await onCall.shift(org, {
				employeeId: worker.employeeId,
				date: "2026-03-07",
				startTime: "09:00",
				endTime: "11:00",
				status: "draft",
			});
			const statusOf = (viewer: { audience: "full" | "restricted"; selfView: boolean }) =>
				loadOnCallEmployeeStatus(db, {
					organizationId: org.id,
					employeeId: worker.employeeId,
					timezone: org.timezone,
					now: NOW,
					method: "three_months",
					...viewer,
				}).then((status) =>
					status.findings
						.filter((f) => f.periodStart <= "2026-03-07" && f.periodEnd > "2026-03-07")
						.map((f) => [f.kind, f.summary.used?.value])
						.toSorted(),
				);
			const self = { audience: "restricted", selfView: true } as const;

			// The employee sees an empty planned week: 0 of the statutory 20 hours, nothing short.
			expect(await statusOf(self)).toEqual([["on_call_weekly_under_band", 0]]);
			// Org admins and planners still judge the draft.
			const planned = [
				["on_call_short_call", 120],
				["on_call_short_notice", 2],
				["on_call_weekly_under_band", 120],
			];
			expect(await statusOf({ audience: "full", selfView: false })).toEqual(planned);
			expect(await statusOf({ audience: "restricted", selfView: false })).toEqual(planned);

			await admin.query(`UPDATE shift SET status = 'published', published_at = $2 WHERE id = $1`, [
				draft,
				new Date(NOW.epochMilliseconds),
			]);
			expect(await statusOf(self)).toEqual(planned);
		});
	});
});
