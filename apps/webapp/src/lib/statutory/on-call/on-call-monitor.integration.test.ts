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
			await shift(agreed, "13:00", "17:00");
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
					[statutory.employeeId, "work:2026-03-10", 120, 180],
					[agreed.employeeId, `shift:${threeHours}`, 180, 240],
					[agreed.employeeId, "work:2026-03-10", 180, 240],
				].toSorted((a, b) => String(a).localeCompare(String(b))),
			);
			expect(findings.find((f) => f.kind === "on_call_short_call")?.legalReference).toBe(
				"§ 12 Abs. 1 Satz 4 TzBfG",
			);
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

		it("minimum: passes up to +25 % and flags above it", async () => {
			// 10 h agreed → at most 12.5 h (750 min).
			expect(await workerWorking("minimum", 600, [4, 4, 4.5])).toEqual([
				expect.objectContaining({ tier: "critical", used: 750, limit: 750, severity: "critical" }),
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
			expect(await workerWorking("minimum", 600, [3, 3, 3])).toEqual([]);
		});

		it("maximum: passes down to −20 % and flags below it", async () => {
			// 10 h agreed → at least 8 h (480 min).
			expect(await workerWorking("maximum", 600, [4, 4])).toEqual([]);
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
			// Above the maximum is no § 12 Abs. 2 breach.
			expect(await workerWorking("maximum", 600, [6, 6])).toEqual([]);
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
	});
});
