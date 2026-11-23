/**
 * #1993: JArbSchG youth protection in Scheduling (real PostgreSQL): youth findings for under-18
 * shifts and the exact 18th-birthday switch, the optional publish block and its lifting by an
 * acknowledged sector exception, and `executive_exempt` adults without adult ArbZG findings.
 */
import { Effect, Layer } from "effect";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { systemClock } from "@/lib/datetime/temporal-core";
import { DatabaseServiceLive } from "@/lib/effect/services/database.service";
import {
	ScheduleComplianceService,
	ScheduleComplianceServiceLive,
} from "@/lib/effect/services/schedule-compliance.service";
import { WorkPolicyServiceLive } from "@/lib/effect/services/work-policy.service";
import { shiftDateBounds } from "@/lib/scheduling/shift-date";
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
import { loadOrganizationStatutoryPreferences } from "../preferences";
import { jarbschgScheduleContributor } from "./jarbschg-contributor";
import { youthSeed } from "./testing/youth-seed";

const caller = vi.hoisted(() => ({ userId: "", organizationId: "" }));

vi.mock("@/lib/effect/runtime", async () => {
	const { Layer } = await import("effect");
	const { db } = await import("@/db");
	const { ShiftServiceLive } = await import("@/lib/effect/services/shift.service");
	const { CoverageServiceLive } = await import("@/lib/effect/services/coverage.service");
	const { WorkPolicyServiceLive } = await import("@/lib/effect/services/work-policy.service");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	const boundary = organizationActionStubLayer(
		() => ({
			userId: caller.userId,
			activeOrganizationId: caller.organizationId,
			membershipRole: "owner",
			employee: null,
		}),
		{ db },
	);
	return (await import("@/test/effect-runtime")).runtimeModuleOver(
		Layer.mergeAll(ShiftServiceLive, CoverageServiceLive, WorkPolicyServiceLive).pipe(
			Layer.provideMerge(boundary),
		),
	);
});

const { publishShifts } = await import("@/app/[locale]/(app)/scheduling/actions/shift-actions");

const WEEK = { startDate: "2027-03-01", endDateExclusive: "2027-03-08" };

const complianceLayer = ScheduleComplianceServiceLive.pipe(
	Layer.provide(WorkPolicyServiceLive),
	Layer.provide(DatabaseServiceLive),
);

describe("JArbSchG in Scheduling (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	const fx = statutoryFixture(admin, "t1993sc");
	const seed = youthSeed(admin);
	let org: FixtureOrganization;
	let owner: FixtureEmployee;
	let subareaId: string;

	beforeEach(async () => {
		await fx.cleanup();
		org = await fx.organization("a");
		owner = await fx.employee(org, "owner", { role: "admin" });
		await fx.membership(org, owner, "owner");
		subareaId = await seed.subarea(org, owner);
		caller.userId = owner.userId;
		caller.organizationId = org.id;
	});
	afterAll(fx.cleanup);

	const shift = (who: FixtureEmployee, date: string, startTime: string, endTime: string) =>
		seed.shift(org, who, { subareaId, creatorUserId: owner.userId, date, startTime, endTime });

	const evaluateWeek = () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* ScheduleComplianceService;
				return yield* service.evaluateScheduleWindow({
					organizationId: org.id,
					startDate: shiftDateBounds(WEEK.startDate, org.timezone).start,
					endDateExclusive: shiftDateBounds(WEEK.endDateExclusive, org.timezone).start,
					timezone: org.timezone,
				});
			}).pipe(Effect.provide(complianceLayer)),
		);

	async function acknowledgeSectorExceptions(who: FixtureEmployee) {
		const findings = await jarbschgScheduleContributor.evaluate({
			db,
			organizationId: org.id,
			timezone: org.timezone,
			window: { start: WEEK.startDate, endExclusive: WEEK.endDateExclusive },
			employeeIds: [who.employeeId],
			proposedShifts: [],
			replacesShiftId: null,
			preferences: await loadOrganizationStatutoryPreferences(db, org.id),
			now: systemClock.nowInstant(),
		});
		for (const finding of findings) {
			const subject = statutoryAcknowledgementSubjectOf(finding);
			if (!subject) continue;
			await recordStatutoryAcknowledgement(db, {
				...subject,
				organizationId: org.id,
				actorUserId: owner.userId,
				inputFingerprint: finding.inputFingerprint,
				reason: "Hospitality: § 14 Abs. 2 Nr. 1 JArbSchG allows work until 22:00 at 16+",
			});
		}
		return findings;
	}

	const shiftStatus = async (id: string) =>
		(await admin.query<{ status: string }>("select status from shift where id = $1", [id])).rows[0]
			?.status;

	it("judges under-18 shifts by youth limits and switches to adult rules on the 18th birthday", async () => {
		const turning = await fx.employee(org, "turning", { birthday: "2009-03-03" });
		const minor = await fx.employee(org, "minor", { birthday: "2011-01-01" });
		const tuesday = await shift(turning, "2027-03-02", "17:00", "21:00");
		await shift(turning, "2027-03-03", "17:00", "21:00"); // 18th birthday.
		const sunday = await shift(minor, "2027-03-07", "10:00", "14:00");

		const result = await evaluateWeek();
		const statutory = result.findings.filter((finding) => finding.type === "statutory");
		expect(statutory).toHaveLength(2);
		expect(statutory).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					employeeId: turning.employeeId,
					statutoryKind: "jarbschg_night_work",
					domain: "youth_protection",
					subjectKey: `shift:${tuesday}`,
					legalReference: "§ 14 JArbSchG",
					summary: {
						tier: "exceeded",
						used: { unit: "minutes", value: 60 },
						limit: { unit: "minutes", value: 0 },
					},
					acknowledgementStatus: "none",
					blocksPublication: false,
				}),
				expect.objectContaining({
					employeeId: minor.employeeId,
					statutoryKind: "jarbschg_sunday_work",
					subjectKey: `shift:${sunday}`,
				}),
			]),
		);
		expect(result.summary.byType.statutory).toBe(2);
	});

	it("refuses to publish blocked youth findings until the sector exception is acknowledged", async () => {
		await seed.blockJarbschgPublish(org);
		const minor = await fx.employee(org, "late", { birthday: "2011-01-01" });
		const late = await shift(minor, "2027-03-02", "17:00", "21:00");

		const refused = await publishShifts(WEEK);
		expect(refused).toMatchObject({ success: false, code: "ValidationError" });
		expect(refused.success ? "" : refused.error).toMatch(/youth protection/);
		expect(await shiftStatus(late)).toBe("draft");
		expect((await evaluateWeek()).findings).toContainEqual(
			expect.objectContaining({ statutoryKind: "jarbschg_night_work", blocksPublication: true }),
		);

		await acknowledgeSectorExceptions(minor);
		const handshake = await publishShifts(WEEK);
		if (!handshake.success || handshake.data.published) {
			throw new Error(`expected the compliance handshake, got ${JSON.stringify(handshake)}`);
		}
		expect((await evaluateWeek()).findings).toContainEqual(
			expect.objectContaining({
				statutoryKind: "jarbschg_night_work",
				acknowledgementStatus: "current",
				blocksPublication: false,
			}),
		);
		const published = await publishShifts(WEEK, {
			evaluationFingerprint: handshake.data.evaluationFingerprint,
		});
		expect(published).toMatchObject({ success: true, data: { published: true, count: 1 } });
		expect(await shiftStatus(late)).toBe("published");
	});

	it("keeps hard limits blocking: a sector exception cannot lift a too-long day", async () => {
		await seed.blockJarbschgPublish(org);
		const minor = await fx.employee(org, "long", { birthday: "2011-01-01" });
		await shift(minor, "2027-03-02", "07:00", "18:00");
		await acknowledgeSectorExceptions(minor);
		expect(await publishShifts(WEEK)).toMatchObject({ success: false, code: "ValidationError" });
	});

	it("only asks for acknowledgement when the organization does not block youth findings", async () => {
		const minor = await fx.employee(org, "free", { birthday: "2011-01-01" });
		const late = await shift(minor, "2027-03-02", "17:00", "21:00");
		const result = await publishShifts(WEEK);
		expect(result).toMatchObject({
			success: true,
			data: { published: false, requiresAcknowledgment: true },
		});
		expect(await shiftStatus(late)).toBe("draft");
	});

	it("drops adult ArbZG findings for executive-exempt adults, never youth limits", async () => {
		await seed.regulatedPolicy(org, { createdBy: owner.userId, maxDailyMinutes: 480 });
		const standard = await fx.employee(org, "standard", { birthday: "1990-01-01" });
		const executive = await fx.employee(org, "executive", { birthday: "1990-01-01" });
		const minorExecutive = await fx.employee(org, "minorexec", { birthday: "2011-01-01" });
		for (const who of [executive, minorExecutive]) {
			await seed.terms(who, {
				from: "2026-01-01",
				createdBy: owner.userId,
				arbzgScope: "executive_exempt",
			});
		}
		for (const who of [standard, executive, minorExecutive]) {
			await shift(who, "2027-03-02", "07:00", "18:00");
		}

		const { findings } = await evaluateWeek();
		const of = (who: FixtureEmployee) =>
			findings
				.filter((finding) => finding.employeeId === who.employeeId)
				.map((finding) => (finding.type === "statutory" ? finding.statutoryKind : finding.type));
		expect(of(standard)).toEqual(["maxHours"]);
		expect(of(executive)).toEqual([]);
		expect(of(minorExecutive)).toEqual(["jarbschg_daily_max"]);
	});
});
