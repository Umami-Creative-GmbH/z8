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
import { checkComplianceAfterClockOut } from "@/lib/time-tracking/clock-out-effects";
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
