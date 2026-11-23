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
import { integrationAdminPool } from "@/test/integration-database";
import { statutoryFixture } from "@/test/statutory-fixtures";
import {
	addedStatutoryScheduleFindings,
	evaluateStatutoryScheduleFindings,
} from "../scheduling/evaluate";
import { statutoryScheduleContributors } from "../scheduling/contributors";
import { acknowledgeOnCallShortNotice } from "./acknowledge";
import { onCallScheduleContributor } from "./contributor";
import { evaluateOnCallFindings } from "./monitor";
import { localInstant, onCallFixture } from "./testing/on-call-fixture";

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
				{ used: { unit: "days", value: 2 }, limit: { unit: "days", value: 4 } },
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
