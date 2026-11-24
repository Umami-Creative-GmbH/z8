/**
 * #1992: the on-call monitor through the Scheduling / Staffing seam, short-notice agreements and
 * their invalidation when a planner edits the shift.
 */
import { Effect, Layer } from "effect";
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { ValidationError } from "@/lib/effect/errors";
import { DatabaseServiceLive } from "@/lib/effect/services/database.service";
import {
	ScheduleComplianceService,
	ScheduleComplianceServiceLive,
} from "@/lib/effect/services/schedule-compliance.service";
import { ShiftService, ShiftServiceLive } from "@/lib/effect/services/shift.service";
import { WorkPolicyService } from "@/lib/effect/services/work-policy.service";
import { shiftStoredDate } from "@/lib/scheduling/shift-date";
import { withCanonicalRecords } from "@/lib/time-tracking/work-records/__tests__/historical-work";
import { integrationAdminPool } from "@/test/integration-database";
import { statutoryFixture } from "@/test/statutory-fixtures";
import {
	addedStatutoryScheduleFindings,
	deepensBreachedLimit,
	evaluateStatutoryScheduleFindings,
	evaluateStatutoryScheduleWindow,
} from "../scheduling/evaluate";
import { statutoryScheduleContributors } from "../scheduling/contributors";
import { acknowledgeOnCallShortNotice } from "./acknowledge";
import { onCallScheduleContributor } from "./contributor";
import { evaluateOnCallFindings } from "./monitor";
import { localInstant, onCallFixture } from "./__tests__/on-call-fixture";

const shiftLayer = ShiftServiceLive.pipe(Layer.provide(DatabaseServiceLive));
const complianceLayer = ScheduleComplianceServiceLive.pipe(
	Layer.provide(
		Layer.succeed(WorkPolicyService, {
			getEffectivePolicy: () => Effect.succeed(null),
		} as never),
	),
	Layer.provide(DatabaseServiceLive),
);

describe("§ 12 TzBfG on-call in Scheduling and Staffing (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	const fx = statutoryFixture(admin, "t1992-schedule");
	const onCall = onCallFixture(admin, fx);

	beforeEach(fx.cleanup);
	afterAll(fx.cleanup);

	/** The fingerprint of the short-notice finding an org admin is shown for the shift's day. */
	async function shownNoticeFingerprint(
		org: { id: string; timezone: string },
		employeeId: string,
		shiftDate: string,
		now: Temporal.Instant,
	): Promise<string> {
		const findings = await evaluateOnCallFindings(db, {
			organizationId: org.id,
			timezone: org.timezone,
			window: {
				start: shiftDate,
				endExclusive: Temporal.PlainDate.from(shiftDate).add({ days: 1 }).toString(),
			},
			employeeIds: [employeeId],
			now,
		});
		const notice = findings.find((f) => f.kind === "on_call_short_notice");
		if (!notice) throw new Error("no short-notice finding shown");
		return notice.inputFingerprint;
	}

	it("is registered as a Scheduling contributor", () => {
		expect(statutoryScheduleContributors).toContain(onCallScheduleContributor);
	});

	it("records a voluntary short-notice agreement that goes stale when the shift is moved", async () => {
		const org = await onCall.organization("a");
		const hr = await fx.user("hr");
		const worker = await fx.employee(org, "worker");
		await onCall.onCallTerms(org, worker, { kind: "unspecified" });
		// Real dates: the planner's edit below stamps the material change with the real clock.
		const now = Temporal.Now.instant();
		const today = now.toZonedDateTimeISO(org.timezone).toPlainDate();
		const shiftDate = today.add({ days: 3 }).toString();
		const shiftId = await onCall.shift(org, {
			employeeId: worker.employeeId,
			date: shiftDate,
			startTime: "09:00",
			endTime: "13:00",
			publishedAt: localInstant(today.toString(), "00:00", org.timezone),
		});
		const request = {
			organizationId: org.id,
			timezone: org.timezone,
			window: { start: shiftDate, endExclusive: today.add({ days: 4 }).toString() },
			employeeIds: [worker.employeeId],
			now,
		};
		const noticeStatus = async () =>
			(await evaluateStatutoryScheduleFindings(db, request, [onCallScheduleContributor]))
				.filter((f) => f.statutoryKind === "on_call_short_notice")
				.map((f) => [f.subjectKey, f.acknowledgementStatus, f.summary]);

		expect(await noticeStatus()).toEqual([
			[
				`shift:${shiftId}`,
				"none",
				{
					used: { unit: "days", value: 2 },
					limit: { unit: "days", value: 4 },
					limitDirection: "floor",
				},
			],
		]);

		const shown = await shownNoticeFingerprint(org, worker.employeeId, shiftDate, now);
		await acknowledgeOnCallShortNotice(db, {
			organizationId: org.id,
			timezone: org.timezone,
			actorUserId: hr.userId,
			shiftId,
			expectedFingerprint: shown,
			reason: "Employee agreed by phone to cover the Saturday",
			now,
		});
		expect((await noticeStatus()).map(([, status]) => status)).toEqual(["current"]);

		const {
			rows: [stored],
		} = await admin.query(
			`SELECT review_kind, finding_kind, subject_key, employment_history_id, agreement_id, note
			 FROM contract_review_acknowledgement WHERE organization_id = $1`,
			[org.id],
		);
		expect(stored).toEqual({
			review_kind: "on_call_short_notice_agreement",
			finding_kind: "on_call_short_notice",
			subject_key: `shift:${shiftId}`,
			employment_history_id: null,
			agreement_id: null,
			note: "Employee agreed by phone to cover the Saturday",
		});

		const edit = (startTime: string, notes: string) =>
			Effect.runPromise(
				Effect.gen(function* () {
					const service = yield* ShiftService;
					return yield* service.upsertShift({
						id: shiftId,
						organizationId: org.id,
						employeeId: worker.employeeId,
						subareaId: org.subareaId,
						date: shiftStoredDate(shiftDate, org.timezone),
						timezone: org.timezone,
						startTime,
						endTime: "13:00",
						notes,
						createdBy: org.plannerUserId,
					});
				}).pipe(Effect.provide(shiftLayer)),
			);

		// A note is no material change: the agreement still covers the call.
		await edit("09:00", "Bring the keys");
		expect((await noticeStatus()).map(([, status]) => status)).toEqual(["current"]);

		// Moving the start is a new call-in: the agreement no longer covers it.
		await edit("10:00", "Bring the keys");
		expect((await noticeStatus()).map(([, status]) => status)).toEqual(["stale"]);
	});

	it("refuses an agreement for figures the admin was not shown", async () => {
		const org = await onCall.organization("a");
		const hr = await fx.user("hr");
		const worker = await fx.employee(org, "worker");
		await onCall.onCallTerms(org, worker, { kind: "unspecified" });
		const now = Temporal.Instant.from("2026-03-04T12:00:00Z");
		const shiftId = await onCall.shift(org, {
			employeeId: worker.employeeId,
			date: "2026-03-07",
			startTime: "09:00",
			endTime: "13:00",
			publishedAt: localInstant("2026-03-03", "10:00", org.timezone),
		});
		const shown = await shownNoticeFingerprint(org, worker.employeeId, "2026-03-07", now);
		// The shift moves before the admin submits (a new call-in, as `upsertShift` stamps it): the
		// finding they saw is gone.
		await admin.query(
			`UPDATE shift SET start_time = '10:00', assignment_changed_at = $2 WHERE id = $1`,
			[shiftId, new Date("2026-03-04T11:00:00Z")],
		);

		await expect(
			acknowledgeOnCallShortNotice(db, {
				organizationId: org.id,
				timezone: org.timezone,
				actorUserId: hr.userId,
				shiftId,
				expectedFingerprint: shown,
				reason: "Agreed",
				now,
			}),
		).rejects.toMatchObject({
			_tag: "ValidationError",
			refusal: "on_call_notice_finding_changed",
		} satisfies Partial<ValidationError>);
		const { rows } = await admin.query(
			`SELECT 1 FROM contract_review_acknowledgement WHERE organization_id = $1`,
			[org.id],
		);
		expect(rows).toEqual([]);
	});

	it("documents agreements to published calls only, which stay current from one day to the next", async () => {
		const org = await onCall.organization("a");
		const hr = await fx.user("hr");
		const worker = await fx.employee(org, "worker");
		await onCall.onCallTerms(org, worker, { kind: "unspecified" });
		// Monday 2026-03-02; the draft call is on Thursday 2026-03-05.
		const monday = localInstant("2026-03-02", "12:00", org.timezone);
		const tuesday = localInstant("2026-03-03", "12:00", org.timezone);
		const shiftId = await onCall.shift(org, {
			employeeId: worker.employeeId,
			date: "2026-03-05",
			startTime: "09:00",
			endTime: "13:00",
			status: "draft",
			publishedAt: null,
			assignmentChangedAt: localInstant("2026-03-01", "10:00", org.timezone),
		});
		const request = (now: Temporal.Instant) => ({
			organizationId: org.id,
			timezone: org.timezone,
			window: { start: "2026-03-05", endExclusive: "2026-03-06" },
			employeeIds: [worker.employeeId],
			now,
		});
		const noticeStatus = async (now: Temporal.Instant) =>
			(await evaluateStatutoryScheduleFindings(db, request(now), [onCallScheduleContributor]))
				.filter((f) => f.statutoryKind === "on_call_short_notice")
				.map((f) => f.acknowledgementStatus);
		const acknowledge = async (now: Temporal.Instant) =>
			acknowledgeOnCallShortNotice(db, {
				organizationId: org.id,
				timezone: org.timezone,
				actorUserId: hr.userId,
				shiftId,
				expectedFingerprint: await shownNoticeFingerprint(
					org,
					worker.employeeId,
					"2026-03-05",
					now,
				),
				reason: "Employee agreed by phone",
				now,
			});

		// A draft announces nothing yet: the planner is warned, but there is no call to agree to.
		expect(await noticeStatus(monday)).toEqual([null]);
		await expect(acknowledge(monday)).rejects.toMatchObject({
			_tag: "ValidationError",
			refusal: "on_call_notice_shift_not_published",
		} satisfies Partial<ValidationError>);
		const { rows } = await admin.query(
			`SELECT 1 FROM contract_review_acknowledgement WHERE organization_id = $1`,
			[org.id],
		);
		expect(rows).toEqual([]);

		// Published on Monday: two full days' notice. The agreement documented Monday still holds
		// Tuesday, with no change to the shift.
		await admin.query(`UPDATE shift SET status = 'published', published_at = $2 WHERE id = $1`, [
			shiftId,
			new Date(monday.epochMilliseconds),
		]);
		await acknowledge(monday);
		expect(await noticeStatus(monday)).toEqual(["current"]);
		expect(await noticeStatus(tuesday)).toEqual(["current"]);
	});

	it("keeps the short-notice finding of a past shift whose end is corrected afterwards", async () => {
		const org = await onCall.organization("a");
		const worker = await fx.employee(org, "worker");
		await onCall.onCallTerms(org, worker, { kind: "unspecified" });
		// Real dates: the planner's correction below runs on the real clock, after the shift.
		const today = Temporal.Now.instant().toZonedDateTimeISO(org.timezone).toPlainDate();
		const shiftDate = today.subtract({ days: 1 }).toString();
		// Published two days before the shift: one full day of notice.
		const shiftId = await onCall.shift(org, {
			employeeId: worker.employeeId,
			date: shiftDate,
			startTime: "09:00",
			endTime: "13:00",
			publishedAt: localInstant(today.subtract({ days: 3 }).toString(), "10:00", org.timezone),
			assignmentChangedAt: localInstant(
				today.subtract({ days: 3 }).toString(),
				"10:00",
				org.timezone,
			),
		});
		const notice = async () =>
			(
				await evaluateStatutoryScheduleFindings(
					db,
					{
						organizationId: org.id,
						timezone: org.timezone,
						window: { start: shiftDate, endExclusive: today.toString() },
						employeeIds: [worker.employeeId],
						now: Temporal.Now.instant(),
					},
					[onCallScheduleContributor],
				)
			)
				.filter((f) => f.statutoryKind === "on_call_short_notice")
				.map((f) => [f.subjectKey, f.summary.used?.value]);
		expect(await notice()).toEqual([[`shift:${shiftId}`, 1]]);

		await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* ShiftService;
				return yield* service.upsertShift({
					id: shiftId,
					organizationId: org.id,
					employeeId: worker.employeeId,
					subareaId: org.subareaId,
					date: shiftStoredDate(shiftDate, org.timezone),
					timezone: org.timezone,
					startTime: "09:00",
					endTime: "14:30",
					createdBy: org.plannerUserId,
				});
			}).pipe(Effect.provide(shiftLayer)),
		);

		expect(await notice()).toEqual([[`shift:${shiftId}`, 1]]);
	});

	/** Runs `run` with the wall clock at `instant` (only `Date` is faked; timers stay real). */
	async function at<T>(instant: Temporal.Instant, run: () => Promise<T>): Promise<T> {
		vi.useFakeTimers({ toFake: ["Date"] });
		try {
			vi.setSystemTime(new Date(instant.epochMilliseconds));
			return await run();
		} finally {
			vi.useRealTimers();
		}
	}

	function upsert(
		org: { id: string; timezone: string; subareaId: string; plannerUserId: string },
		input: { id: string; employeeId: string; date: string; startTime: string; endTime: string },
	) {
		return Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* ShiftService;
				return yield* service.upsertShift({
					id: input.id,
					organizationId: org.id,
					employeeId: input.employeeId,
					subareaId: org.subareaId,
					date: shiftStoredDate(input.date, org.timezone),
					timezone: org.timezone,
					startTime: input.startTime,
					endTime: input.endTime,
					createdBy: org.plannerUserId,
				});
			}).pipe(Effect.provide(shiftLayer)),
		);
	}

	it("announces a started shift anew to the employee it is reassigned to", async () => {
		const org = await onCall.organization("a");
		const regular = await fx.employee(org, "regular");
		await onCall.regularTerms(org, regular);
		const onCallWorker = await fx.employee(org, "oncall");
		await onCall.onCallTerms(org, onCallWorker, { kind: "unspecified" });
		// Published well ahead to a regular employee, then handed over at 10:00 while it runs.
		const shiftId = await onCall.shift(org, {
			employeeId: regular.employeeId,
			date: "2026-03-10",
			startTime: "09:00",
			endTime: "17:00",
			publishedAt: localInstant("2026-03-01", "10:00", org.timezone),
			assignmentChangedAt: localInstant("2026-03-01", "10:00", org.timezone),
		});
		const reassignedAt = localInstant("2026-03-10", "10:00", org.timezone);
		await at(reassignedAt, () =>
			upsert(org, {
				id: shiftId,
				employeeId: onCallWorker.employeeId,
				date: "2026-03-10",
				startTime: "09:00",
				endTime: "17:00",
			}),
		);

		const findings = await evaluateOnCallFindings(db, {
			organizationId: org.id,
			timezone: org.timezone,
			window: { start: "2026-03-10", endExclusive: "2026-03-11" },
			employeeIds: [onCallWorker.employeeId],
			now: localInstant("2026-03-10", "10:05", org.timezone),
		});
		expect(
			findings
				.filter((f) => f.kind === "on_call_short_notice")
				.map((f) => [f.subjectKey, f.summary.used?.value]),
		).toEqual([[`shift:${shiftId}`, 0]]);
	});

	it.each([
		["while it runs", "10:00", 1],
		["after it ended", "15:00", 0],
	])(
		"judges a shift reassigned %s on its own day as a call-in accordingly",
		async (_when, reassignedAtTime, expected) => {
			const org = await onCall.organization("a");
			const regular = await fx.employee(org, "regular");
			await onCall.regularTerms(org, regular);
			const onCallWorker = await fx.employee(org, "oncall");
			await onCall.onCallTerms(org, onCallWorker, { kind: "unspecified" });
			// Tuesday 08:00–11:00, published well ahead to a regular employee.
			const shiftId = await onCall.shift(org, {
				employeeId: regular.employeeId,
				date: "2026-03-10",
				startTime: "08:00",
				endTime: "11:00",
				publishedAt: localInstant("2026-03-01", "10:00", org.timezone),
				assignmentChangedAt: localInstant("2026-03-01", "10:00", org.timezone),
			});
			// A correction after the shift is over records who worked it; it calls nobody in.
			await at(localInstant("2026-03-10", reassignedAtTime, org.timezone), () =>
				upsert(org, {
					id: shiftId,
					employeeId: onCallWorker.employeeId,
					date: "2026-03-10",
					startTime: "08:00",
					endTime: "11:00",
				}),
			);

			const findings = await evaluateOnCallFindings(db, {
				organizationId: org.id,
				timezone: org.timezone,
				window: { start: "2026-03-10", endExclusive: "2026-03-11" },
				employeeIds: [onCallWorker.employeeId],
				now: localInstant("2026-03-10", "16:00", org.timezone),
			});
			expect(findings.filter((f) => f.kind === "on_call_short_notice")).toHaveLength(expected);
		},
	);

	it("keeps a short-notice agreement current when the started shift's end is corrected", async () => {
		const org = await onCall.organization("a");
		const hr = await fx.user("hr");
		const worker = await fx.employee(org, "worker");
		await onCall.onCallTerms(org, worker, { kind: "unspecified" });
		// Announced two days ahead: one full day of notice.
		const shiftId = await onCall.shift(org, {
			employeeId: worker.employeeId,
			date: "2026-03-10",
			startTime: "09:00",
			endTime: "17:00",
			publishedAt: localInstant("2026-03-08", "10:00", org.timezone),
			assignmentChangedAt: localInstant("2026-03-08", "10:00", org.timezone),
		});
		const noon = localInstant("2026-03-10", "12:00", org.timezone);
		await acknowledgeOnCallShortNotice(db, {
			organizationId: org.id,
			timezone: org.timezone,
			actorUserId: hr.userId,
			shiftId,
			expectedFingerprint: await shownNoticeFingerprint(org, worker.employeeId, "2026-03-10", noon),
			reason: "Employee agreed to cover",
			now: noon,
		});

		await at(noon, () =>
			upsert(org, {
				id: shiftId,
				employeeId: worker.employeeId,
				date: "2026-03-10",
				startTime: "09:00",
				endTime: "18:00",
			}),
		);

		const notice = (
			await evaluateStatutoryScheduleFindings(
				db,
				{
					organizationId: org.id,
					timezone: org.timezone,
					window: { start: "2026-03-10", endExclusive: "2026-03-11" },
					employeeIds: [worker.employeeId],
					now: localInstant("2026-03-10", "12:05", org.timezone),
				},
				[onCallScheduleContributor],
			)
		).filter((f) => f.statutoryKind === "on_call_short_notice");
		expect(notice.map((f) => [f.summary.used?.value, f.acknowledgementStatus])).toEqual([
			[1, "current"],
		]);
	});

	it("refuses to acknowledge a shift announced in time", async () => {
		const org = await onCall.organization("a");
		const hr = await fx.user("hr");
		const worker = await fx.employee(org, "worker");
		await onCall.onCallTerms(org, worker, { kind: "unspecified" });
		const shiftId = await onCall.shift(org, {
			employeeId: worker.employeeId,
			date: "2026-03-07",
			startTime: "09:00",
			endTime: "13:00",
			publishedAt: localInstant("2026-03-02", "10:00", org.timezone),
		});

		await expect(
			acknowledgeOnCallShortNotice(db, {
				organizationId: org.id,
				timezone: org.timezone,
				actorUserId: hr.userId,
				shiftId,
				expectedFingerprint: "v1:anything",
				reason: "Agreed",
				now: Temporal.Instant.from("2026-03-04T12:00:00Z"),
			}),
		).rejects.toMatchObject({
			_tag: "ValidationError",
			refusal: "on_call_notice_finding_not_open",
		} satisfies Partial<ValidationError>);
	});

	it("keeps the publish fingerprint steady while an unplanned clock-in runs", async () => {
		const org = await onCall.organization("a");
		const worker = await fx.employee(org, "worker");
		await onCall.onCallTerms(org, worker, { kind: "unspecified" });
		// Assigned later in the week; clocked in today without a shift.
		await onCall.shift(org, {
			employeeId: worker.employeeId,
			date: "2026-03-13",
			startTime: "09:00",
			endTime: "13:00",
			publishedAt: localInstant("2026-03-01", "10:00", org.timezone),
		});
		await onCall.openWork(org, worker, { date: "2026-03-10", startTime: "08:00:42" });
		const evaluate = async (now: Temporal.Instant) => {
			// The service judges at the system clock.
			const clock = vi.spyOn(Temporal.Now, "instant").mockReturnValue(now);
			try {
				return await Effect.runPromise(
					Effect.gen(function* () {
						const service = yield* ScheduleComplianceService;
						return yield* service.evaluateScheduleWindow({
							organizationId: org.id,
							startDate: shiftStoredDate("2026-03-09", org.timezone),
							endDateExclusive: shiftStoredDate("2026-03-16", org.timezone),
							timezone: org.timezone,
						});
					}).pipe(Effect.provide(complianceLayer)),
				);
			} finally {
				clock.mockRestore();
			}
		};
		const usedOf = (result: Awaited<ReturnType<typeof evaluate>>) =>
			result.findings.flatMap((f) =>
				f.type === "statutory" && f.statutoryKind === "on_call_weekly_under_band"
					? [f.summary.used?.value]
					: [],
			);

		const first = await evaluate(localInstant("2026-03-10", "10:00:10", org.timezone));
		const second = await evaluate(localInstant("2026-03-10", "10:01:10", org.timezone));

		// The running clock-in moved the week's total by a minute; the planner's decision did not change.
		expect([usedOf(first), usedOf(second)]).toEqual([[119 + 240], [120 + 240]]);
		expect(second.fingerprint).toBe(first.fingerprint);
	});

	it("keeps the publish fingerprint of a week over its band steady while an unplanned clock-in runs, and makes it stale when the breach deepens", async () => {
		const org = await onCall.organization("a");
		const worker = await fx.employee(org, "worker");
		await onCall.onCallTerms(org, worker, { kind: "unspecified" });
		// 24 h planned Wednesday to Friday against the 20 h default week; clocked in on Tuesday
		// without a shift.
		for (const date of ["2026-03-11", "2026-03-12", "2026-03-13"]) {
			await onCall.shift(org, {
				employeeId: worker.employeeId,
				date,
				startTime: "09:00",
				endTime: "17:00",
				publishedAt: localInstant("2026-03-01", "10:00", org.timezone),
			});
		}
		await onCall.openWork(org, worker, { date: "2026-03-10", startTime: "08:00:42" });
		const evaluate = async (now: Temporal.Instant) => {
			const clock = vi.spyOn(Temporal.Now, "instant").mockReturnValue(now);
			try {
				return await Effect.runPromise(
					Effect.gen(function* () {
						const service = yield* ScheduleComplianceService;
						return yield* service.evaluateScheduleWindow({
							organizationId: org.id,
							startDate: shiftStoredDate("2026-03-09", org.timezone),
							endDateExclusive: shiftStoredDate("2026-03-16", org.timezone),
							timezone: org.timezone,
						});
					}).pipe(Effect.provide(complianceLayer)),
				);
			} finally {
				clock.mockRestore();
			}
		};
		const overBand = (result: Awaited<ReturnType<typeof evaluate>>) =>
			result.findings.flatMap((f) =>
				f.type === "statutory" && f.statutoryKind === "on_call_weekly_over_band"
					? [[f.severity, f.summary.tier, f.summary.used?.value]]
					: [],
			);

		const first = await evaluate(localInstant("2026-03-10", "10:00:10", org.timezone));
		const second = await evaluate(localInstant("2026-03-10", "10:01:10", org.timezone));
		const later = await evaluate(localInstant("2026-03-10", "11:37:55", org.timezone));

		expect([overBand(first), overBand(second)]).toEqual([
			[["warning", "exceeded", 1440 + 119]],
			[["warning", "exceeded", 1440 + 120]],
		]);
		expect(second.fingerprint).toBe(first.fingerprint);
		expect(later.fingerprint).toBe(first.fingerprint);

		// A shift in the next week leaves this week's breach as it is.
		await onCall.shift(org, {
			employeeId: worker.employeeId,
			date: "2026-03-17",
			startTime: "09:00",
			endTime: "13:00",
			publishedAt: localInstant("2026-03-01", "10:00", org.timezone),
		});
		expect((await evaluate(localInstant("2026-03-10", "10:00:10", org.timezone))).fingerprint).toBe(
			first.fingerprint,
		);
		// A planned Saturday deepens it at the same severity and tier.
		await onCall.shift(org, {
			employeeId: worker.employeeId,
			date: "2026-03-14",
			startTime: "10:00",
			endTime: "12:00",
			publishedAt: localInstant("2026-03-01", "10:00", org.timezone),
		});
		const deeper = await evaluate(localInstant("2026-03-10", "10:00:10", org.timezone));
		expect(overBand(deeper)).toEqual([["warning", "exceeded", 1560 + 119]]);
		expect(deeper.fingerprint).not.toBe(first.fingerprint);

		// Clocked out at 10:30: the minutes are fixed, and count.
		await withCanonicalRecords(admin, (client) =>
			client.query(
				`update work_period set end_time = start_time + interval '149 minutes 18 seconds',
				 duration_minutes = 149, is_active = false
				 where organization_id = $1 and employee_id = $2 and is_active`,
				[org.id, worker.employeeId],
			),
		);
		const clockedOut = await evaluate(localInstant("2026-03-10", "11:00:10", org.timezone));
		expect(overBand(clockedOut)).toEqual([["warning", "exceeded", 1560 + 149]]);
		expect(clockedOut.fingerprint).not.toBe(deeper.fingerprint);
	});

	it("keeps the publish fingerprint steady while a clock-in runs past the end of its shift", async () => {
		const org = await onCall.organization("a");
		const worker = await fx.employee(org, "worker", { contractType: "hourly" });
		await onCall.onCallTerms(org, worker, { kind: "unspecified" });
		// 24 h planned Wednesday to Friday, and a 2 h Tuesday morning call clocked in at 08:00:42.
		for (const [date, startTime, endTime] of [
			["2026-03-10", "08:00", "10:00"],
			["2026-03-11", "09:00", "17:00"],
			["2026-03-12", "09:00", "17:00"],
			["2026-03-13", "09:00", "17:00"],
		] as const) {
			await onCall.shift(org, {
				employeeId: worker.employeeId,
				date,
				startTime,
				endTime,
				publishedAt: localInstant("2026-03-01", "10:00", org.timezone),
			});
		}
		await onCall.openWork(org, worker, { date: "2026-03-10", startTime: "08:00:42" });
		const fingerprintAt = async (time: string) => {
			const clock = vi
				.spyOn(Temporal.Now, "instant")
				.mockReturnValue(localInstant("2026-03-10", time, org.timezone));
			try {
				return (
					await Effect.runPromise(
						Effect.gen(function* () {
							const service = yield* ScheduleComplianceService;
							return yield* service.evaluateScheduleWindow({
								organizationId: org.id,
								startDate: shiftStoredDate("2026-03-09", org.timezone),
								endDateExclusive: shiftStoredDate("2026-03-16", org.timezone),
								timezone: org.timezone,
							});
						}).pipe(Effect.provide(complianceLayer)),
					)
				).fingerprint;
			} finally {
				clock.mockRestore();
			}
		};

		const within = await fingerprintAt("09:30:10");
		for (const time of ["09:59:30", "10:00:50", "10:45:20", "12:13:14"]) {
			expect(await fingerprintAt(time)).toBe(within);
		}
	});

	it("keeps the publish fingerprint steady while a clock-in made before its shift runs into it", async () => {
		const org = await onCall.organization("a");
		const worker = await fx.employee(org, "worker", { contractType: "hourly" });
		await onCall.onCallTerms(org, worker, { kind: "unspecified" });
		// 24 h planned Wednesday to Friday, and a Tuesday 10:00–12:00 call clocked in early at 08:00:42.
		for (const [date, startTime, endTime] of [
			["2026-03-10", "10:00", "12:00"],
			["2026-03-11", "09:00", "17:00"],
			["2026-03-12", "09:00", "17:00"],
			["2026-03-13", "09:00", "17:00"],
		] as const) {
			await onCall.shift(org, {
				employeeId: worker.employeeId,
				date,
				startTime,
				endTime,
				publishedAt: localInstant("2026-03-01", "10:00", org.timezone),
			});
		}
		await onCall.openWork(org, worker, { date: "2026-03-10", startTime: "08:00:42" });
		const fingerprintAt = async (time: string) => {
			const clock = vi
				.spyOn(Temporal.Now, "instant")
				.mockReturnValue(localInstant("2026-03-10", time, org.timezone));
			try {
				return (
					await Effect.runPromise(
						Effect.gen(function* () {
							const service = yield* ScheduleComplianceService;
							return yield* service.evaluateScheduleWindow({
								organizationId: org.id,
								startDate: shiftStoredDate("2026-03-09", org.timezone),
								endDateExclusive: shiftStoredDate("2026-03-16", org.timezone),
								timezone: org.timezone,
							});
						}).pipe(Effect.provide(complianceLayer)),
					)
				).fingerprint;
			} finally {
				clock.mockRestore();
			}
		};

		const early = await fingerprintAt("09:59:10");
		for (const time of ["10:00:10", "10:00:50", "11:00:10", "12:30:10"]) {
			expect(await fingerprintAt(time)).toBe(early);
		}

		// Another planned shift in the week deepens the breach.
		await onCall.shift(org, {
			employeeId: worker.employeeId,
			date: "2026-03-14",
			startTime: "10:00",
			endTime: "12:00",
			publishedAt: localInstant("2026-03-01", "10:00", org.timezone),
		});
		expect(await fingerprintAt("10:00:10")).not.toBe(early);
	});

	describe.each([
		// 24 h planned Wednesday to Friday plus Tuesday's 8 h: over the deemed 20 h week.
		{ band: "over", kind: "on_call_weekly_over_band", otherDays: true, expected: 1_440 + 480 },
		// Tuesday's 8 h alone: under an exact 20 h week.
		{ band: "under", kind: "on_call_weekly_under_band", otherDays: false, expected: 480 },
	] as const)(
		"a week $band its band while nobody is clocked in on a started shift",
		({ kind, otherDays, expected }) => {
			/** The week with Tuesday 08:00–16:00 planned; returns the window's state at a Tuesday time. */
			async function plannedWeek() {
				const org = await onCall.organization("a");
				const worker = await fx.employee(org, "worker", { contractType: "hourly" });
				await onCall.onCallTerms(
					org,
					worker,
					otherDays ? { kind: "unspecified" } : { kind: "exact", weeklyMinutes: 1_200 },
				);
				const days: (readonly [string, string, string])[] = [["2026-03-10", "08:00", "16:00"]];
				if (otherDays) {
					for (const date of ["2026-03-11", "2026-03-12", "2026-03-13"]) {
						days.push([date, "09:00", "17:00"]);
					}
				}
				for (const [date, startTime, endTime] of days) {
					await onCall.shift(org, {
						employeeId: worker.employeeId,
						date,
						startTime,
						endTime,
						publishedAt: localInstant("2026-03-01", "10:00", org.timezone),
					});
				}
				const stateAt = async (time: string) => {
					const clock = vi
						.spyOn(Temporal.Now, "instant")
						.mockReturnValue(localInstant("2026-03-10", time, org.timezone));
					try {
						const result = await Effect.runPromise(
							Effect.gen(function* () {
								const service = yield* ScheduleComplianceService;
								return yield* service.evaluateScheduleWindow({
									organizationId: org.id,
									startDate: shiftStoredDate("2026-03-09", org.timezone),
									endDateExclusive: shiftStoredDate("2026-03-16", org.timezone),
									timezone: org.timezone,
								});
							}).pipe(Effect.provide(complianceLayer)),
						);
						return {
							fingerprint: result.fingerprint,
							used: result.findings.flatMap((finding) =>
								finding.type === "statutory" && finding.statutoryKind === kind
									? [finding.summary.used?.value]
									: [],
							),
						};
					} finally {
						clock.mockRestore();
					}
				};
				return { org, worker, stateAt };
			}

			it("keeps the band figures and the publish fingerprint through a clocked-out lunch break", async () => {
				const { org, worker, stateAt } = await plannedWeek();
				await onCall.work(org, worker, {
					date: "2026-03-10",
					startTime: "08:00",
					endTime: "12:00",
				});

				const first = await stateAt("12:01:10");
				expect(first.used).toEqual([expected]);
				for (const time of ["12:10:00", "12:29:50"]) {
					expect(await stateAt(time)).toEqual(first);
				}
			});

			it("keeps them while nobody has clocked in for a shift that has started", async () => {
				const { stateAt } = await plannedWeek();

				const first = await stateAt("08:05:00");
				expect(first.used).toEqual([expected]);
				expect(await stateAt("08:30:20")).toEqual(first);
			});

			it("keeps them through a shift nobody works", async () => {
				const { stateAt } = await plannedWeek();

				const first = await stateAt("07:59:00");
				expect(first.used).toEqual([expected]);
				for (const time of ["08:00:30", "12:00:00", "15:59:10"]) {
					expect(await stateAt(time)).toEqual(first);
				}
			});
		},
	);

	describe.each([
		{
			scenario: "a night split at midnight, clocked in across it",
			shifts: [
				["2026-03-15", "18:00", "00:00"],
				["2026-03-16", "00:00", "06:00"],
			],
			clockIn: "18:00:42",
		},
		{
			scenario: "a clock-in on Sunday evening for a shift from Monday midnight",
			shifts: [["2026-03-16", "00:00", "06:00"]],
			clockIn: "23:45:42",
		},
	] as const)(
		"a running clock-in crossing into the next week: $scenario",
		({ shifts, clockIn }) => {
			// Sunday 2026-03-15 closes 2026-W11, over the deemed 20 h with 24 h worked Tuesday to Thursday
			// (its severity does not change when the week ends at midnight); Monday 2026-03-16 opens
			// 2026-W12, under it.
			async function plannedNight() {
				const org = await onCall.organization("a");
				const worker = await fx.employee(org, "worker", { contractType: "hourly" });
				await onCall.onCallTerms(org, worker, { kind: "unspecified" });
				for (const date of ["2026-03-10", "2026-03-11", "2026-03-12"]) {
					await onCall.work(org, worker, { date, startTime: "09:00", endTime: "17:00" });
				}
				for (const [date, startTime, endTime] of shifts) {
					await onCall.shift(org, {
						employeeId: worker.employeeId,
						date,
						startTime,
						endTime,
						publishedAt: localInstant("2026-03-01", "10:00", org.timezone),
					});
				}
				await onCall.openWork(org, worker, { date: "2026-03-15", startTime: clockIn });
				/** Each week's band findings, as the monitor reports them for `window`. */
				const bandsAt = async (
					now: Temporal.Instant,
					window: { start: string; endExclusive: string },
				) =>
					Object.fromEntries(
						(
							await evaluateOnCallFindings(db, {
								organizationId: org.id,
								timezone: org.timezone,
								window,
								employeeIds: [worker.employeeId],
								now,
							})
						)
							.filter((f) => f.kind.startsWith("on_call_weekly_"))
							.map((f) => [
								f.subjectKey,
								[f.kind, f.severity, f.summary.used?.value, f.stableDepth?.used ?? null],
							]),
					);
				const fingerprintAt = async (now: Temporal.Instant) => {
					const clock = vi.spyOn(Temporal.Now, "instant").mockReturnValue(now);
					try {
						return (
							await Effect.runPromise(
								Effect.gen(function* () {
									const service = yield* ScheduleComplianceService;
									return yield* service.evaluateScheduleWindow({
										organizationId: org.id,
										startDate: shiftStoredDate("2026-03-09", org.timezone),
										endDateExclusive: shiftStoredDate("2026-03-23", org.timezone),
										timezone: org.timezone,
									});
								}).pipe(Effect.provide(complianceLayer)),
							)
						).fingerprint;
					} finally {
						clock.mockRestore();
					}
				};
				return { org, worker, bandsAt, fingerprintAt };
			}
			const samples = [
				["2026-03-15", "23:50:10"],
				["2026-03-16", "00:00:10"],
				["2026-03-16", "00:01:10"],
				["2026-03-16", "03:00:10"],
				["2026-03-16", "05:59:10"],
			] as const;
			const bothWeeks = { start: "2026-03-09", endExclusive: "2026-03-23" };

			it("keeps each week's band figures and the publish fingerprint steady while the clock runs", async () => {
				const { org, bandsAt, fingerprintAt } = await plannedNight();
				const at = ([date, time]: readonly [string, string]) =>
					localInstant(date, time, org.timezone);

				// The week's figures without the minutes a running clock-in grows by outside any shift.
				const steadyAt = async (sample: readonly [string, string]) =>
					Object.fromEntries(
						Object.entries(await bandsAt(at(sample), bothWeeks)).map(
							([week, [kind, severity, used, stableUsed]]) => [
								week,
								[kind, severity, stableUsed ?? used],
							],
						),
					);

				const first = await steadyAt(samples[0]);
				expect(first).toEqual({
					"2026-W11": [
						"on_call_weekly_over_band",
						"warning",
						1_440 + (shifts.length === 2 ? 359 : 0),
					],
					"2026-W12": ["on_call_weekly_under_band", "info", 360],
				});
				const fingerprint = await fingerprintAt(at(samples[0]));
				for (const sample of samples.slice(1)) {
					expect(await steadyAt(sample)).toEqual(first);
					expect(await fingerprintAt(at(sample))).toBe(fingerprint);
				}
			});

			it("gives each week the same figures in a one-week window as in a two-week one", async () => {
				const { org, bandsAt } = await plannedNight();

				for (const [date, time] of samples) {
					const now = localInstant(date, time, org.timezone);
					const both = await bandsAt(now, bothWeeks);
					expect({
						...(await bandsAt(now, { start: "2026-03-09", endExclusive: "2026-03-16" })),
						...(await bandsAt(now, { start: "2026-03-16", endExclusive: "2026-03-23" })),
					}).toEqual(both);
				}
			});

			it("makes the publish fingerprint stale when the next week is planned further", async () => {
				const { org, worker, fingerprintAt } = await plannedNight();
				const now = localInstant("2026-03-16", "03:00:10", org.timezone);
				const before = await fingerprintAt(now);

				await onCall.shift(org, {
					employeeId: worker.employeeId,
					date: "2026-03-18",
					startTime: "09:00",
					endTime: "13:00",
					publishedAt: localInstant("2026-03-01", "10:00", org.timezone),
				});
				expect(await fingerprintAt(now)).not.toBe(before);
			});
		},
	);

	describe("a clock-in left running for days into a later shift", () => {
		// An exact 20 h week; Monday 2026-03-09 08:00–12:00 planned, clocked in at 08:00 and never
		// clocked out. Only shifts up to the day after the clock-in's start day take its minutes: a
		// later shift's minutes count outside every shift, on Monday, and nobody works that shift.
		async function forgottenClockIn(laterShift: string) {
			const org = await onCall.organization("a");
			const worker = await fx.employee(org, "worker", { contractType: "hourly" });
			await onCall.onCallTerms(org, worker, { kind: "exact", weeklyMinutes: 1_200 });
			for (const date of ["2026-03-09", laterShift]) {
				await onCall.shift(org, {
					employeeId: worker.employeeId,
					date,
					startTime: "08:00",
					endTime: "12:00",
					publishedAt: localInstant("2026-03-01", "10:00", org.timezone),
				});
			}
			await onCall.openWork(org, worker, { date: "2026-03-09", startTime: "08:00" });
			const window = { start: "2026-03-09", endExclusive: "2026-03-23" };
			/** Each week's band finding as [kind, severity, stable used], and the publish fingerprint. */
			const stateAt = async (time: string) => {
				const now = localInstant(laterShift, time, org.timezone);
				const bands = Object.fromEntries(
					(
						await evaluateOnCallFindings(db, {
							organizationId: org.id,
							timezone: org.timezone,
							window,
							employeeIds: [worker.employeeId],
							now,
						})
					)
						.filter((f) => f.kind.startsWith("on_call_weekly_"))
						.map((f) => [
							f.subjectKey,
							[f.kind, f.severity, f.stableDepth?.used ?? f.summary.used?.value],
						]),
				);
				const clock = vi.spyOn(Temporal.Now, "instant").mockReturnValue(now);
				try {
					const { fingerprint } = await Effect.runPromise(
						Effect.gen(function* () {
							const service = yield* ScheduleComplianceService;
							return yield* service.evaluateScheduleWindow({
								organizationId: org.id,
								startDate: shiftStoredDate(window.start, org.timezone),
								endDateExclusive: shiftStoredDate(window.endExclusive, org.timezone),
								timezone: org.timezone,
							});
						}).pipe(Effect.provide(complianceLayer)),
					);
					return { bands, fingerprint };
				} finally {
					clock.mockRestore();
				}
			};
			return { org, worker, stateAt };
		}

		it("holds the week's figures and the publish fingerprint through a later shift of the same week", async () => {
			const { org, worker, stateAt } = await forgottenClockIn("2026-03-11");

			const first = await stateAt("08:00:10");
			// Monday's shift and Wednesday's planned four hours, without the minutes the clock grows by.
			expect(first.bands).toEqual({
				"2026-W11": ["on_call_weekly_over_band", "warning", 480],
				"2026-W12": ["on_call_weekly_under_band", "info", 0],
			});
			for (const time of ["09:00:10", "11:59:10", "12:30:10"]) {
				expect(await stateAt(time)).toEqual(first);
			}

			// Another planned shift in the week deepens the breach.
			await onCall.shift(org, {
				employeeId: worker.employeeId,
				date: "2026-03-12",
				startTime: "08:00",
				endTime: "12:00",
				publishedAt: localInstant("2026-03-01", "10:00", org.timezone),
			});
			const deeper = await stateAt("09:00:10");
			expect(deeper.bands["2026-W11"]).toEqual(["on_call_weekly_over_band", "warning", 720]);
			expect(deeper.fingerprint).not.toBe(first.fingerprint);
		});

		it("holds the later shift's week while the shift runs", async () => {
			const { stateAt } = await forgottenClockIn("2026-03-16");

			const first = await stateAt("08:00:10");
			expect(first.bands).toEqual({
				"2026-W11": ["on_call_weekly_over_band", "warning", 240],
				"2026-W12": ["on_call_weekly_under_band", "info", 240],
			});
			for (const time of ["09:00:10", "11:59:10"]) {
				expect(await stateAt(time)).toEqual(first);
			}
		});
	});

	describe("a minimum breached further makes the publish acknowledgement stale", () => {
		/** The publish key of the employee's `kind` finding, as the publish fingerprint hashes it. */
		async function publishKeyOf(
			org: { id: string; timezone: string },
			employeeId: string,
			kind: string,
			now: Temporal.Instant,
		) {
			const { findings, publishKeys } = await evaluateStatutoryScheduleWindow(
				db,
				{
					organizationId: org.id,
					timezone: org.timezone,
					window: { start: "2026-03-09", endExclusive: "2026-03-16" },
					employeeIds: [employeeId],
					now,
				},
				[onCallScheduleContributor],
			);
			const index = findings.findIndex((finding) => finding.statutoryKind === kind);
			expect(index).toBeGreaterThanOrEqual(0);
			return { finding: findings[index], key: publishKeys[index] };
		}

		it("a draft moved from 2 days' notice to none", async () => {
			const org = await onCall.organization("a");
			const worker = await fx.employee(org, "worker");
			await onCall.onCallTerms(org, worker, { kind: "unspecified" });
			const shiftId = await onCall.shift(org, {
				employeeId: worker.employeeId,
				date: "2026-03-12",
				startTime: "09:00",
				endTime: "13:00",
				status: "draft",
				publishedAt: null,
			});
			const now = localInstant("2026-03-09", "12:00", org.timezone);
			const before = await publishKeyOf(org, worker.employeeId, "on_call_short_notice", now);
			expect(before.finding?.summary).toMatchObject({
				used: { value: 2 },
				limit: { value: 4 },
				limitDirection: "floor",
			});

			await admin.query("update shift set date = $2 where id = $1", [
				shiftId,
				shiftStoredDate("2026-03-10", org.timezone),
			]);
			const after = await publishKeyOf(org, worker.employeeId, "on_call_short_notice", now);
			expect(after.finding?.summary.used?.value).toBe(0);
			expect(after.key).not.toBe(before.key);
		});

		it("a planned call shortened from 150 to 30 minutes", async () => {
			const org = await onCall.organization("a");
			const worker = await fx.employee(org, "worker");
			await onCall.onCallTerms(org, worker, { kind: "unspecified" });
			const shiftId = await onCall.shift(org, {
				employeeId: worker.employeeId,
				date: "2026-03-12",
				startTime: "10:00",
				endTime: "12:30",
				publishedAt: localInstant("2026-03-01", "10:00", org.timezone),
			});
			const now = localInstant("2026-03-02", "12:00", org.timezone);
			const before = await publishKeyOf(org, worker.employeeId, "on_call_short_call", now);
			expect(before.finding?.summary.used?.value).toBe(150);

			await admin.query("update shift set end_time = '10:30' where id = $1", [shiftId]);
			const after = await publishKeyOf(org, worker.employeeId, "on_call_short_call", now);
			expect(after.finding?.summary.used?.value).toBe(30);
			expect(after.key).not.toBe(before.key);
			// Staffing judges a proposal by the same rule: the call is deeper below its minimum.
			if (!before.finding || !after.finding) throw new Error("no short-call finding");
			expect(deepensBreachedLimit(before.finding, after.finding)).toBe(true);
		});

		it("a worked call corrected from 150 to 30 minutes", async () => {
			const org = await onCall.organization("a");
			const worker = await fx.employee(org, "worker", { contractType: "hourly" });
			await onCall.onCallTerms(org, worker, { kind: "unspecified" });
			await onCall.work(org, worker, { date: "2026-03-10", startTime: "10:00", endTime: "12:30" });
			const now = localInstant("2026-03-11", "12:00", org.timezone);
			const before = await publishKeyOf(org, worker.employeeId, "on_call_short_work_call", now);
			expect(before.finding?.summary.used?.value).toBe(150);

			await withCanonicalRecords(admin, (client) =>
				client.query(
					`update work_period set end_time = start_time + interval '30 minutes',
					 duration_minutes = 30
					 where organization_id = $1 and employee_id = $2`,
					[org.id, worker.employeeId],
				),
			);
			const after = await publishKeyOf(org, worker.employeeId, "on_call_short_work_call", now);
			expect(after.finding?.summary.used?.value).toBe(30);
			expect(after.key).not.toBe(before.key);
		});
	});

	it("tells Staffing that an on-call candidate's short-notice, short call would add findings", async () => {
		const org = await onCall.organization("a");
		const onCallWorker = await fx.employee(org, "oncall");
		await onCall.onCallTerms(org, onCallWorker, { kind: "minimum", weeklyMinutes: 600 });
		const regular = await fx.employee(org, "regular");
		await onCall.regularTerms(org, regular);

		const added = await addedStatutoryScheduleFindings(
			db,
			{
				organizationId: org.id,
				timezone: org.timezone,
				window: { start: "2026-03-06", endExclusive: "2026-03-07" },
				employeeIds: [onCallWorker.employeeId, regular.employeeId],
				now: Temporal.Instant.from("2026-03-04T12:00:00Z"),
				proposedShift: { date: "2026-03-06", startTime: "10:00", endTime: "12:00" },
				replacesShiftId: null,
			},
			[onCallScheduleContributor],
		);

		expect(
			added
				.get(onCallWorker.employeeId)
				?.map((f) => [f.statutoryKind, f.subjectKey, f.summary.used?.value])
				.toSorted(),
		).toEqual(
			[
				["on_call_short_call", "proposed:2026-03-06T10:00", 120],
				["on_call_short_notice", "proposed:2026-03-06T10:00", 1],
			].toSorted(),
		);
		expect(added.get(regular.employeeId)).toBeUndefined();
	});

	it("tells Staffing that keeping the shift's own assignee announces nothing new", async () => {
		const org = await onCall.organization("a");
		const assignee = await fx.employee(org, "assignee");
		await onCall.onCallTerms(org, assignee, { kind: "unspecified" });
		const other = await fx.employee(org, "other");
		await onCall.onCallTerms(org, other, { kind: "unspecified" });
		// Published for the assignee on Monday 2026-03-02, ten days before Thursday's shift.
		const shiftId = await onCall.shift(org, {
			employeeId: assignee.employeeId,
			date: "2026-03-12",
			startTime: "08:00",
			endTime: "14:00",
			publishedAt: Temporal.Instant.from("2026-03-02T09:00:00Z"),
			assignmentChangedAt: Temporal.Instant.from("2026-03-02T09:00:00Z"),
		});

		// Staffing on Tuesday 2026-03-10, two days before the shift.
		const added = await addedStatutoryScheduleFindings(
			db,
			{
				organizationId: org.id,
				timezone: org.timezone,
				window: { start: "2026-03-12", endExclusive: "2026-03-13" },
				employeeIds: [assignee.employeeId, other.employeeId],
				now: Temporal.Instant.from("2026-03-10T12:00:00Z"),
				proposedShift: { date: "2026-03-12", startTime: "08:00", endTime: "14:00" },
				replacesShiftId: shiftId,
			},
			[onCallScheduleContributor],
		);

		const notices = (employeeId: string) =>
			(added.get(employeeId) ?? [])
				.filter((f) => f.statutoryKind === "on_call_short_notice")
				.map((f) => f.summary.used?.value);
		expect(notices(assignee.employeeId)).toEqual([]);
		expect(notices(other.employeeId)).toEqual([1]);
	});

	it("tells Staffing that a call proposed on a holiday would take the week over its band", async () => {
		const org = await onCall.organization("a");
		const worker = await fx.employee(org, "oncall");
		await onCall.onCallTerms(org, worker, { kind: "maximum", weeklyMinutes: 600 });
		await onCall.holiday(org, worker, "2026-03-09");
		await onCall.holiday(org, worker, "2026-03-11");
		await onCall.shift(org, {
			employeeId: worker.employeeId,
			date: "2026-03-10",
			startTime: "08:00",
			endTime: "11:00",
			publishedAt: Temporal.Instant.from("2026-02-01T09:00:00Z"),
		});

		const added = await addedStatutoryScheduleFindings(
			db,
			{
				organizationId: org.id,
				timezone: org.timezone,
				window: { start: "2026-03-09", endExclusive: "2026-03-10" },
				employeeIds: [worker.employeeId],
				now: Temporal.Instant.from("2026-03-02T12:00:00Z"),
				proposedShift: { date: "2026-03-09", startTime: "08:00", endTime: "16:00" },
				replacesShiftId: null,
			},
			[onCallScheduleContributor],
		);

		// Wednesday, neither planned nor worked, stays released: six callable days, at most
		// 600 × 6/7 = 514 minutes, and 480 + 180 = 660 planned.
		expect(
			added
				.get(worker.employeeId)
				?.map((f) => [f.statutoryKind, f.summary.used?.value, f.summary.limit?.value]),
		).toEqual([["on_call_weekly_over_band", 660, 514]]);
	});
});
