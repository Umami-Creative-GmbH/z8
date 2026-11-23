/**
 * #1993: JArbSchG in the clock-out compliance check (real PostgreSQL). Youth limits apply on
 * every day the employee is under 18, are recorded in `work_policy_violation` without a work
 * policy, switch off on the exact 18th birthday, survive `executive_exempt`, honour an
 * acknowledged sector exception, and never block the clock-out.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { runtime } from "@/lib/effect/runtime";
import { runAutoClockOutFollowUps } from "@/lib/time-tracking/automatic-clock-out/follow-ups";
import {
	automaticClockOutComplianceEffects,
	checkComplianceAfterClockOut,
} from "@/lib/time-tracking/clock-out-effects";
import { integrationAdminPool } from "@/test/integration-database";
import {
	type FixtureEmployee,
	type FixtureOrganization,
	statutoryFixture,
} from "@/test/statutory-fixtures";
import {
	recordStatutoryAcknowledgement,
	statutoryAcknowledgementSubjectOf,
} from "../acknowledgements";
import { recordApprenticeRelease } from "../employee-context";
import { DEFAULT_STATUTORY_PREFERENCES } from "../preferences";
import { jarbschgScheduleContributor } from "./jarbschg-contributor";
import { localInstant, youthSeed } from "./testing/youth-seed";

vi.mock("@/lib/effect/runtime", async () => {
	const { Layer } = await import("effect");
	const { DatabaseServiceLive } = await import("@/lib/effect/services/database.service");
	const { WorkPolicyServiceLive } = await import("@/lib/effect/services/work-policy.service");
	return (await import("@/test/effect-runtime")).runtimeModuleOver(
		WorkPolicyServiceLive.pipe(Layer.provide(DatabaseServiceLive)),
	);
});

describe("JArbSchG at clock-out (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	const fx = statutoryFixture(admin, "t1993co");
	const seed = youthSeed(admin);
	let org: FixtureOrganization;
	let owner: FixtureEmployee;

	beforeEach(async () => {
		await fx.cleanup();
		org = await fx.organization("a");
		owner = await fx.employee(org, "owner", { role: "admin" });
		await fx.membership(org, owner, "owner");
	});
	afterAll(async () => {
		try {
			await fx.cleanup();
		} finally {
			await runtime.dispose();
		}
	});

	async function clockOut(who: FixtureEmployee, date: string, time: string, minutes: number) {
		const work = await seed.work(org, who, date, time, minutes);
		const warnings = await checkComplianceAfterClockOut(
			{
				organizationId: org.id,
				employeeId: who.employeeId,
				workPeriodId: work.id,
				work,
				timezone: org.timezone,
			},
			{ throwOnError: true },
		);
		return { work, warnings };
	}

	const types = async (who: FixtureEmployee) =>
		(await seed.violations(who)).map((row) => row.violation_type);

	it("records youth violations for an under-18 employee without any work policy", async () => {
		const minor = await fx.employee(org, "minor", { birthday: "2010-06-01" });
		// Monday 13:00–21:00 without a break: night work, missing breaks, too long uninterrupted.
		const { work } = await clockOut(minor, "2026-03-02", "13:00", 480);

		const recorded = await seed.violations(minor);
		expect(recorded.map((row) => row.violation_type)).toEqual([
			"jarbschg_break",
			"jarbschg_night_work",
			"jarbschg_uninterrupted",
		]);
		expect(recorded.every((row) => row.policy_id === null && row.work_period_id === work.id)).toBe(
			true,
		);
		const night = recorded.find((row) => row.violation_type === "jarbschg_night_work");
		expect(JSON.parse(night?.details ?? "{}")).toMatchObject({
			actualMinutes: 60,
			limitMinutes: 0,
			legalReference: "§ 14 JArbSchG",
		});

		// A later check of the same day records each rule once.
		await clockOut(minor, "2026-03-02", "21:15", 10);
		expect(await types(minor)).toEqual([
			"jarbschg_break",
			"jarbschg_night_work",
			"jarbschg_uninterrupted",
		]);
	});

	it.each([
		{ name: "25 December", date: "2025-12-25", time: "09:00", holiday: true },
		{ name: "24 December after 14:00", date: "2025-12-24", time: "12:00", holiday: false },
		{ name: "1 May", date: "2026-05-01", time: "09:00", holiday: true },
	])(
		"records work on $name as prohibited holiday work, not as a sector exception",
		async (scenario) => {
			if (scenario.holiday) await seed.publicHoliday(org, owner, scenario.date);
			const minor = await fx.employee(org, "holiday", { birthday: "2010-06-01" });
			await clockOut(minor, scenario.date, scenario.time, 240);

			const recorded = await seed.violations(minor);
			expect(recorded.map((row) => row.violation_type)).toEqual(["jarbschg_holiday_prohibited"]);
			expect(JSON.parse(recorded[0]?.details ?? "{}")).toMatchObject({
				legalReference: "§ 18 Abs. 1, 2 JArbSchG",
			});
		},
	);

	describe("a later clock-out the same day", () => {
		const recorded = async (who: FixtureEmployee, type: string) => {
			const row = (await seed.violations(who)).filter((entry) => entry.violation_type === type);
			expect(row).toHaveLength(1);
			return { ...row[0], details: JSON.parse(row[0]?.details ?? "{}") };
		};

		it("refreshes the day's holiday work to everything worked after 14:00 on 24 December", async () => {
			const minor = await fx.employee(org, "eve-split", { birthday: "2010-06-01" });
			await clockOut(minor, "2025-12-24", "13:00", 120); // 13:00–15:00: 60 min after 14:00.
			const { work } = await clockOut(minor, "2025-12-24", "16:00", 240); // 16:00–20:00.

			const holiday = await recorded(minor, "jarbschg_holiday_prohibited");
			expect(holiday.details).toMatchObject({ actualMinutes: 300 });
			expect(holiday.work_period_id).toBe(work.id);
		});

		it("leaves an acknowledged violation as it was reviewed", async () => {
			const minor = await fx.employee(org, "eve-reviewed", { birthday: "2010-06-01" });
			const { work: first } = await clockOut(minor, "2025-12-24", "13:00", 120);
			await admin.query(
				`update work_policy_violation set acknowledged_at = now(), acknowledged_by = $3
				 where organization_id = $1 and employee_id = $2`,
				[org.id, minor.employeeId, owner.employeeId],
			);
			await clockOut(minor, "2025-12-24", "16:00", 240);

			const holiday = await recorded(minor, "jarbschg_holiday_prohibited");
			expect(holiday.details).toMatchObject({ actualMinutes: 60 });
			expect(holiday.work_period_id).toBe(first.id);
		});

		it("refreshes the daily maximum and night work the same way", async () => {
			const minor = await fx.employee(org, "long-day", { birthday: "2010-06-01" });
			// 07:00–16:00 (540 min), then 16:30–17:30: 600 min in the day.
			await clockOut(minor, "2026-03-02", "07:00", 540);
			await clockOut(minor, "2026-03-02", "16:30", 60);
			expect((await recorded(minor, "jarbschg_daily_max")).details).toMatchObject({
				actualMinutes: 600,
			});

			const night = await fx.employee(org, "late-night", { birthday: "2010-06-01" });
			// 17:00–21:00 is 60 min past 20:00; 21:15–22:15 another 60.
			await clockOut(night, "2026-03-03", "17:00", 240);
			const { work } = await clockOut(night, "2026-03-03", "21:15", 60);
			const recordedNight = await recorded(night, "jarbschg_night_work");
			expect(recordedNight.details).toMatchObject({ actualMinutes: 120 });
			expect(recordedNight.work_period_id).toBe(work.id);
		});
	});

	it("records an ordinary public holiday as holiday work", async () => {
		await seed.publicHoliday(org, owner, "2026-04-06"); // Easter Monday.
		const minor = await fx.employee(org, "easter", { birthday: "2010-06-01" });
		await clockOut(minor, "2026-04-06", "09:00", 240);
		expect(await types(minor)).toEqual(["jarbschg_holiday_work"]);
	});

	it("drops the day's break violation once later breaks satisfy § 11 (15 + 15 minutes over 6 h)", async () => {
		const minor = await fx.employee(org, "split", { birthday: "2010-06-01" });
		// 08:00–11:00, 15 min break, 11:15–13:45: 330 min worked with only 15 min of break so far.
		await clockOut(minor, "2026-03-02", "08:00", 180);
		await clockOut(minor, "2026-03-02", "11:15", 150);
		// 14:00–14:30 after a second 15 min break: 360 min worked, 30 min of break.
		await clockOut(minor, "2026-03-02", "14:00", 30);
		expect(await types(minor)).toEqual([]);
	});

	it("drops the day's break violation once a second 30 min break follows 375 min of work", async () => {
		const minor = await fx.employee(org, "second", { birthday: "2010-06-01" });
		// 07:00–11:00, 30 min break, 11:30–13:45: 375 min worked, 30 min of break so far.
		await clockOut(minor, "2026-03-02", "07:00", 240);
		await clockOut(minor, "2026-03-02", "11:30", 135);
		// 14:15–15:15 after a second 30 min break: 435 min worked, 60 min of break.
		await clockOut(minor, "2026-03-02", "14:15", 60);
		expect(await types(minor)).toEqual([]);
	});

	it("keeps the break violation of a day that really lacks the breaks", async () => {
		const minor = await fx.employee(org, "short", { birthday: "2010-06-01" });
		await clockOut(minor, "2026-03-02", "08:00", 180);
		await clockOut(minor, "2026-03-02", "11:15", 150);
		// Two more stretches after 15 min breaks each: 420 min worked needs 60 min, only 45 taken.
		await clockOut(minor, "2026-03-02", "14:00", 30);
		await clockOut(minor, "2026-03-02", "14:45", 60);
		expect(await types(minor)).toEqual(["jarbschg_break"]);
	});

	it("counts an apprentice's school time toward the daily maximum", async () => {
		const learner = await fx.employee(org, "learner", { birthday: "2010-06-01" });
		await seed.terms(learner, {
			from: "2026-01-01",
			createdBy: owner.userId,
			employmentProfile: "apprentice",
		});
		// Tuesday: four lessons (3 h of school time), then 8 h of work with breaks.
		await recordApprenticeRelease(db, {
			organizationId: org.id,
			employeeId: learner.employeeId,
			actorUserId: owner.userId,
			releaseKind: "vocational_school_day",
			startsOn: "2026-03-03",
			endsOn: "2026-03-03",
			lessonCount: 4,
		});
		await seed.work(org, learner, "2026-03-03", "10:00", 120);
		await seed.work(org, learner, "2026-03-03", "12:30", 120);
		await seed.work(org, learner, "2026-03-03", "15:00", 120);
		await clockOut(learner, "2026-03-03", "17:30", 120);

		const daily = (await seed.violations(learner)).find(
			(row) => row.violation_type === "jarbschg_daily_max",
		);
		expect(JSON.parse(daily?.details ?? "{}")).toMatchObject({ actualMinutes: 660 });
	});

	it("switches to adult rules on the exact 18th birthday", async () => {
		const turning = await fx.employee(org, "turning", { birthday: "2008-03-04" });
		await clockOut(turning, "2026-03-03", "17:00", 240); // 17:00–21:00, the day before.
		expect(await types(turning)).toEqual(["jarbschg_night_work"]);

		await clockOut(turning, "2026-03-04", "17:00", 240); // Birthday: an adult now.
		expect(await types(turning)).toEqual(["jarbschg_night_work"]);
	});

	it("suppresses adult ArbZG violations for executive-exempt adults, never youth limits", async () => {
		await seed.regulatedPolicy(org, { createdBy: owner.userId, maxDailyMinutes: 480 });
		const standard = await fx.employee(org, "standard", { birthday: "1990-01-01" });
		const executive = await fx.employee(org, "executive", { birthday: "1990-01-01" });
		const minorExecutive = await fx.employee(org, "minorexec", { birthday: "2010-01-01" });
		for (const who of [executive, minorExecutive]) {
			await seed.terms(who, {
				from: "2026-01-01",
				createdBy: owner.userId,
				arbzgScope: "executive_exempt",
			});
		}

		const { warnings: standardWarnings } = await clockOut(standard, "2026-03-02", "08:00", 600);
		expect(standardWarnings).toContainEqual(expect.objectContaining({ type: "max_daily" }));
		expect(await types(standard)).toEqual(["max_daily"]);

		const { warnings: executiveWarnings } = await clockOut(executive, "2026-03-02", "08:00", 600);
		expect(executiveWarnings).toEqual([]);
		expect(await types(executive)).toEqual([]);

		await clockOut(minorExecutive, "2026-03-02", "08:00", 600);
		const youth = await types(minorExecutive);
		expect(youth).toContain("jarbschg_daily_max");
		expect(youth).not.toContain("max_daily");
	});

	it("does not record night work covered by an acknowledged sector exception", async () => {
		const minor = await fx.employee(org, "baker", { birthday: "2010-06-01" });
		const subareaId = await seed.subarea(org, owner);
		const shiftId = await seed.shift(org, minor, {
			subareaId,
			creatorUserId: owner.userId,
			date: "2026-03-03",
			startTime: "17:00",
			endTime: "21:00",
		});
		const findings = await jarbschgScheduleContributor.evaluate({
			db,
			organizationId: org.id,
			timezone: org.timezone,
			window: { start: "2026-03-02", endExclusive: "2026-03-09" },
			employeeIds: [minor.employeeId],
			proposedShifts: [],
			replacesShiftId: null,
			preferences: DEFAULT_STATUTORY_PREFERENCES,
			now: localInstant("2026-03-01", "12:00", org.timezone),
		});
		const night = findings.find((finding) => finding.kind === "jarbschg_night_work");
		expect(night).toMatchObject({ subjectKey: `shift:${shiftId}` });
		const subject = night ? statutoryAcknowledgementSubjectOf(night) : null;
		if (!night || !subject) throw new Error("expected an acknowledgeable night finding");
		await recordStatutoryAcknowledgement(db, {
			...subject,
			organizationId: org.id,
			actorUserId: owner.userId,
			inputFingerprint: night.inputFingerprint,
			reason: "Bakery: § 14 Abs. 2 Nr. 2 JArbSchG allows work until 22:00 for 16-year-olds",
		});

		await clockOut(minor, "2026-03-03", "17:05", 235);
		expect(await types(minor)).toEqual([]);

		// Work the shift does not cover is still recorded.
		await clockOut(minor, "2026-03-05", "17:00", 240);
		expect(await types(minor)).toEqual(["jarbschg_night_work"]);
	});

	it("records each day's own night minutes of a night shift clocked across midnight", async () => {
		const minor = await fx.employee(org, "split-night", { birthday: "2010-06-01" });
		const subareaId = await seed.subarea(org, owner);
		await seed.shift(org, minor, {
			subareaId,
			creatorUserId: owner.userId,
			date: "2026-03-03",
			startTime: "22:00",
			endTime: "06:00",
		});

		const { work: tuesday } = await clockOut(minor, "2026-03-03", "22:00", 150); // Until 00:30.
		const { work: wednesday } = await clockOut(minor, "2026-03-04", "00:45", 135); // Until 03:00.

		const night = (await seed.violations(minor))
			.filter((row) => row.violation_type === "jarbschg_night_work")
			.map((row) => ({ workPeriodId: row.work_period_id, details: JSON.parse(row.details) }));
		// A piece of work belongs to the local day it starts on, as for the daily rules.
		expect(night).toHaveLength(2);
		expect(night).toEqual(
			expect.arrayContaining([
				{
					workPeriodId: tuesday.id,
					details: expect.objectContaining({ actualMinutes: 150 }),
				},
				{
					workPeriodId: wednesday.id,
					details: expect.objectContaining({ actualMinutes: 135 }),
				},
			]),
		);
	});

	it("records night work that overruns an acknowledged shift", async () => {
		const minor = await fx.employee(org, "overrun", { birthday: "2010-06-01" });
		const subareaId = await seed.subarea(org, owner);
		await seed.shift(org, minor, {
			subareaId,
			creatorUserId: owner.userId,
			date: "2026-03-03",
			startTime: "17:00",
			endTime: "21:00",
		});
		const findings = await jarbschgScheduleContributor.evaluate({
			db,
			organizationId: org.id,
			timezone: org.timezone,
			window: { start: "2026-03-02", endExclusive: "2026-03-09" },
			employeeIds: [minor.employeeId],
			proposedShifts: [],
			replacesShiftId: null,
			preferences: DEFAULT_STATUTORY_PREFERENCES,
			now: localInstant("2026-03-01", "12:00", org.timezone),
		});
		const night = findings.find((finding) => finding.kind === "jarbschg_night_work");
		const subject = night ? statutoryAcknowledgementSubjectOf(night) : null;
		if (!night || !subject) throw new Error("expected an acknowledgeable night finding");
		await recordStatutoryAcknowledgement(db, {
			...subject,
			organizationId: org.id,
			actorUserId: owner.userId,
			inputFingerprint: night.inputFingerprint,
			reason: "Hospitality until 21:00",
		});

		// Worked 17:00–01:30: the exception covered the shift, not four and a half hours past it.
		await clockOut(minor, "2026-03-03", "17:00", 510);
		expect(await types(minor)).toContain("jarbschg_night_work");
	});

	it("honours a night exception for unplanned work up to the acknowledged span, not beyond", async () => {
		/** Clocked in at 17:00 without a shift; the exception is acknowledged at 20:50. */
		async function acknowledgedOpenWork(key: string) {
			const minor = await fx.employee(org, key, { birthday: "2010-06-01" });
			const open = await seed.openWork(org, minor, "2026-03-03", "17:00");
			const findings = await jarbschgScheduleContributor.evaluate({
				db,
				organizationId: org.id,
				timezone: org.timezone,
				window: { start: "2026-03-02", endExclusive: "2026-03-09" },
				employeeIds: [minor.employeeId],
				proposedShifts: [],
				replacesShiftId: null,
				preferences: DEFAULT_STATUTORY_PREFERENCES,
				now: localInstant("2026-03-03", "20:50", org.timezone),
			});
			const night = findings.find((finding) => finding.kind === "jarbschg_night_work");
			expect(night).toMatchObject({ subjectKey: `work:${open.id}` });
			const subject = night ? statutoryAcknowledgementSubjectOf(night) : null;
			if (!night || !subject) throw new Error("expected an acknowledgeable night finding");
			await recordStatutoryAcknowledgement(db, {
				...subject,
				organizationId: org.id,
				actorUserId: owner.userId,
				inputFingerprint: night.inputFingerprint,
				reason: "Hospitality: § 14 Abs. 2 Nr. 1 JArbSchG allows work until 22:00",
			});
			return { minor, open };
		}
		async function clockOutOpen(
			who: FixtureEmployee,
			open: { id: string; start: ReturnType<typeof localInstant> },
			minutes: number,
		) {
			const work = await seed.closeWork(org, who, open, minutes);
			await checkComplianceAfterClockOut(
				{
					organizationId: org.id,
					employeeId: who.employeeId,
					workPeriodId: work.id,
					work,
					timezone: org.timezone,
				},
				{ throwOnError: true },
			);
		}

		// Clocked out at 21:00: within the acknowledged span.
		const onTime = await acknowledgedOpenWork("ontime");
		await clockOutOpen(onTime.minor, onTime.open, 240);
		expect(await types(onTime.minor)).not.toContain("jarbschg_night_work");

		// Clocked out at 23:30: the exception never covered two and a half more hours of night.
		const late = await acknowledgedOpenWork("late");
		await clockOutOpen(late.minor, late.open, 390);
		expect(await types(late.minor)).toContain("jarbschg_night_work");
	});

	it("records adult and youth violations once when an automatic clock-out retries a failed youth check", async () => {
		await seed.regulatedPolicy(org, { createdBy: owner.userId, maxDailyMinutes: 480 });
		const minor = await fx.employee(org, "retried", { birthday: "2010-06-01" });
		// Monday 08:00–18:00 without a break.
		const work = await seed.work(org, minor, "2026-03-02", "08:00", 600);
		const recordYouthProtection = vi
			.fn(automaticClockOutComplianceEffects.recordYouthProtection)
			.mockRejectedValueOnce(new Error("connection reset"));
		const effects = {
			...automaticClockOutComplianceEffects,
			recordYouthProtection,
			enforceBreaks: async () => ({ wasAdjusted: false, affectedWorkPeriodIds: [work.id] }),
			reconcileSurcharges: async () => {},
			markBalanceDirty: async () => {},
			checkProjectBudget: async () => {},
		};
		const closure = {
			...work,
			organizationId: org.id,
			employeeId: minor.employeeId,
			actorUserId: owner.userId,
			workPeriodId: work.id,
			projectId: null,
			surchargeSnapshot: null,
			balanceRefreshCommitted: true,
			timezone: org.timezone,
		};
		const progress: Record<string, unknown> = {};
		const context = {
			recordProgress: async (patch: Record<string, unknown>) => {
				Object.assign(progress, patch);
			},
		};

		await expect(runAutoClockOutFollowUps(closure, progress, context, effects)).rejects.toThrow(
			"connection reset",
		);
		expect(await types(minor)).toEqual(["max_daily"]);
		await runAutoClockOutFollowUps(closure, progress, context, effects);

		expect(await types(minor)).toEqual([
			"jarbschg_break",
			"jarbschg_daily_max",
			"jarbschg_uninterrupted",
			"max_daily",
		]);
		expect(recordYouthProtection).toHaveBeenCalledTimes(2);
	});

	it("records youth violations but never blocks the clock-out, even with publish blocking on", async () => {
		await seed.blockJarbschgPublish(org);
		const minor = await fx.employee(org, "sunday", { birthday: "2010-06-01" });
		const sunday = parsePlainDate("2026-03-08");
		expect(sunday.dayOfWeek).toBe(7);
		await expect(clockOut(minor, sunday.toString(), "10:00", 240)).resolves.toMatchObject({
			warnings: [],
		});
		expect(await types(minor)).toEqual(["jarbschg_sunday_work"]);
	});
});
