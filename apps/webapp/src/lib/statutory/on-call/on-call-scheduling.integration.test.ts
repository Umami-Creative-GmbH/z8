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
import { ShiftService, ShiftServiceLive } from "@/lib/effect/services/shift.service";
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
import { localInstant, onCallFixture } from "./testing/on-call-fixture";

const shiftLayer = ShiftServiceLive.pipe(Layer.provide(DatabaseServiceLive));

describe("§ 12 TzBfG on-call in Scheduling and Staffing (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	const fx = statutoryFixture(admin, "t1992-schedule");
	const onCall = onCallFixture(admin, fx);

	beforeEach(fx.cleanup);
	afterAll(fx.cleanup);

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

		await acknowledgeOnCallShortNotice(db, {
			organizationId: org.id,
			timezone: org.timezone,
			actorUserId: hr.userId,
			shiftId,
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
				reason: "Agreed",
				now: Temporal.Instant.from("2026-03-04T12:00:00Z"),
			}),
		).rejects.toMatchObject({
			_tag: "ValidationError",
			refusal: "on_call_notice_finding_not_open",
		} satisfies Partial<ValidationError>);
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
});
