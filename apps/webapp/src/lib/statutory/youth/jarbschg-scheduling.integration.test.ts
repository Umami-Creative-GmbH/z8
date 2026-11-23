/**
 * #1993: JArbSchG youth protection in Scheduling (real PostgreSQL): youth findings for under-18
 * shifts and the exact 18th-birthday switch, the optional publish block and its lifting by an
 * acknowledged sector exception, and `executive_exempt` adults without adult ArbZG findings.
 */
import { Effect, Layer } from "effect";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { type Instant, systemClock } from "@/lib/datetime/temporal-core";
import { DatabaseServiceLive } from "@/lib/effect/services/database.service";
import {
	ScheduleComplianceService,
	ScheduleComplianceServiceLive,
} from "@/lib/effect/services/schedule-compliance.service";
import {
	ShiftRequestService,
	ShiftRequestServiceLive,
} from "@/lib/effect/services/shift-request.service";
import {
	StaffingSuggestionService,
	StaffingSuggestionServiceLive,
} from "@/lib/effect/services/staffing-suggestion.service";
import {
	WorkPolicyService,
	WorkPolicyServiceLive,
} from "@/lib/effect/services/work-policy.service";
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
import { recordApprenticeRelease } from "../employee-context";
import { loadOrganizationStatutoryPreferences } from "../preferences";
import { STATUTORY_PUBLICATION_BLOCKED } from "../scheduling/publication-block";
import { jarbschgScheduleContributor } from "./jarbschg-contributor";
import { localInstant, youthSeed } from "./testing/youth-seed";

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

const { publishShifts, upsertShift } =
	await import("@/app/[locale]/(app)/scheduling/actions/shift-actions");

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

	describe("editing a published shift runs the publish block", () => {
		const published = (who: FixtureEmployee, date: string, startTime: string, endTime: string) =>
			seed.shift(org, who, {
				subareaId,
				creatorUserId: owner.userId,
				date,
				startTime,
				endTime,
				status: "published",
			});
		const shiftRow = async (id: string) =>
			(
				await admin.query<{ employee_id: string; start_time: string; notes: string | null }>(
					"select employee_id, start_time, notes from shift where id = $1",
					[id],
				)
			).rows[0];

		it("refuses moving a published shift to Saturday night for a minor", async () => {
			await seed.blockJarbschgPublish(org);
			const minor = await fx.employee(org, "moved", { birthday: "2011-01-01" });
			const id = await published(minor, "2027-03-02", "10:00", "14:00");

			const refused = await upsertShift({
				id,
				employeeId: minor.employeeId,
				subareaId,
				date: "2027-03-06",
				startTime: "21:00",
				endTime: "01:00",
			});
			expect(refused).toMatchObject({
				success: false,
				code: "ValidationError",
				refusal: STATUTORY_PUBLICATION_BLOCKED,
			});
			expect((await shiftRow(id))?.start_time).toBe("10:00");
		});

		it("refuses reassigning a published shift to a 16-year-old it puts in breach", async () => {
			await seed.blockJarbschgPublish(org);
			const adult = await fx.employee(org, "adult", { birthday: "1990-01-01" });
			const minor = await fx.employee(org, "sixteen", { birthday: "2010-06-01" });
			const id = await published(adult, "2027-03-02", "07:00", "18:00");

			expect(
				await upsertShift({
					id,
					employeeId: minor.employeeId,
					subareaId,
					date: "2027-03-02",
					startTime: "07:00",
					endTime: "18:00",
				}),
			).toMatchObject({ success: false, refusal: STATUTORY_PUBLICATION_BLOCKED });
			expect((await shiftRow(id))?.employee_id).toBe(adult.employeeId);
		});

		it("refuses approving a pickup that gives a published Saturday evening shift to a 16-year-old", async () => {
			await seed.blockJarbschgPublish(org);
			const minor = await fx.employee(org, "pickup", { birthday: "2010-06-01" });
			const id = await published(owner, "2027-03-06", "18:00", "23:00");
			await admin.query("update shift set employee_id = null where id = $1", [id]);
			const requests = (
				run: (service: ShiftRequestService["Service"]) => Effect.Effect<unknown, unknown>,
			) =>
				Effect.runPromise(
					Effect.gen(function* () {
						return yield* run(yield* ShiftRequestService);
					}).pipe(
						Effect.provide(ShiftRequestServiceLive.pipe(Layer.provide(DatabaseServiceLive))),
						Effect.result,
					),
				);
			const requested = await requests((service) =>
				service.requestPickup(org.id, { shiftId: id, requesterId: minor.employeeId }),
			);
			if (requested._tag !== "Success") throw new Error(JSON.stringify(requested));
			const requestId = (requested.success as { id: string }).id;

			try {
				const approved = await requests((service) =>
					service.approveRequest(org.id, requestId, owner.employeeId),
				);
				expect(approved).toMatchObject({
					_tag: "Failure",
					failure: { _tag: "ValidationError", refusal: STATUTORY_PUBLICATION_BLOCKED },
				});
				expect((await shiftRow(id))?.employee_id).toBeNull();
			} finally {
				// The fixture cleanup does not know shift requests.
				await admin.query("delete from shift_request where shift_id = $1", [id]);
			}
		});

		it("saves a published shift whose sector exception is current, and drafts as before", async () => {
			await seed.blockJarbschgPublish(org);
			const minor = await fx.employee(org, "weekend", { birthday: "2011-01-01" });
			const saturday = await published(minor, "2027-03-06", "10:00", "14:00");
			await acknowledgeSectorExceptions(minor);

			expect(
				await upsertShift({
					id: saturday,
					employeeId: minor.employeeId,
					subareaId,
					date: "2027-03-06",
					startTime: "10:00",
					endTime: "14:00",
					notes: "Inventory",
				}),
			).toMatchObject({ success: true });
			expect((await shiftRow(saturday))?.notes).toBe("Inventory");

			const draft = await shift(minor, "2027-03-02", "10:00", "14:00");
			expect(
				await upsertShift({
					id: draft,
					employeeId: minor.employeeId,
					subareaId,
					date: "2027-03-07",
					startTime: "21:00",
					endTime: "01:00",
				}),
			).toMatchObject({ success: true });
		});
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

	async function apprentice(key: string) {
		const who = await fx.employee(org, key, { birthday: "2011-01-01" });
		await seed.terms(who, {
			from: "2026-01-01",
			createdBy: owner.userId,
			employmentProfile: "apprentice",
		});
		return who;
	}

	const release = (
		who: FixtureEmployee,
		input: Omit<
			Parameters<typeof recordApprenticeRelease>[1],
			"organizationId" | "employeeId" | "actorUserId"
		>,
	) =>
		recordApprenticeRelease(db, {
			organizationId: org.id,
			employeeId: who.employeeId,
			actorUserId: owner.userId,
			...input,
		});

	it("counts a full school day as an 8 h working day toward the week and the five-day week", async () => {
		const learner = await apprentice("schoolday");
		await release(learner, {
			releaseKind: "vocational_school_day",
			startsOn: "2027-03-02",
			endsOn: "2027-03-02",
			lessonCount: 6,
		});
		let saturday = "";
		for (const date of ["2027-03-01", "2027-03-03", "2027-03-04", "2027-03-05", "2027-03-06"]) {
			saturday = await shift(learner, date, "08:00", "17:00"); // 8 h of work each.
		}

		const { findings } = await evaluateWeek();
		const onSaturday = findings.flatMap((finding) =>
			finding.type === "statutory" && finding.subjectKey === `shift:${saturday}`
				? [finding.statutoryKind]
				: [],
		);
		expect(onSaturday).toEqual(
			expect.arrayContaining(["jarbschg_weekly_max", "jarbschg_days_per_week"]),
		);
	});

	describe("Staffing sees what a proposal breaks on neighbouring days", () => {
		const staffingLayer = StaffingSuggestionServiceLive.pipe(
			Layer.provide(
				Layer.succeed(WorkPolicyService, {
					getEffectivePolicyAt: () => Effect.succeed(null),
				} as never),
			),
			Layer.provide(DatabaseServiceLive),
		);
		const youthWarnings = (
			who: FixtureEmployee,
			date: string,
			startTime: string,
			endTime: string,
		) =>
			Effect.runPromise(
				Effect.gen(function* () {
					const service = yield* StaffingSuggestionService;
					const suggestions = yield* service.suggestForShift({
						organizationId: org.id,
						timezone: org.timezone,
						candidates: [{ employeeId: who.employeeId, displayName: "Minor", isActive: true }],
						shift: { subareaId, date, startTime, endTime },
					});
					return (suggestions[0]?.warnings ?? []).flatMap((warning) =>
						warning.type === "compliance" && warning.finding.type === "statutory"
							? [warning.finding.statutoryKind]
							: [],
					);
				}).pipe(Effect.provide(staffingLayer)),
			);

		it("warns about the rest period a Monday evening shift cuts short before Tuesday 06:00", async () => {
			const minor = await fx.employee(org, "early", { birthday: "2011-01-01" });
			await shift(minor, "2027-03-02", "06:00", "12:00");
			expect(await youthWarnings(minor, "2027-03-01", "14:00", "20:00")).toContain(
				"jarbschg_rest_period",
			);
		});

		it("counts a block-release week as 40 h: an extra Saturday shift breaks the week", async () => {
			const learner = await apprentice("blockweek");
			await release(learner, {
				releaseKind: "vocational_school_block_week",
				startsOn: "2027-03-01",
				endsOn: "2027-03-05",
				schoolMinutes: 1800,
			});
			expect(await youthWarnings(learner, "2027-03-06", "10:00", "12:00")).toContain(
				"jarbschg_weekly_max",
			);
		});

		it("warns about the weekly maximum and sixth day a Monday shift causes later in the week", async () => {
			const minor = await fx.employee(org, "busy", { birthday: "2011-01-01" });
			for (const date of ["2027-03-02", "2027-03-03", "2027-03-04", "2027-03-05", "2027-03-06"]) {
				await shift(minor, date, "08:00", "16:12"); // 7.2 h of work each: 36 h over five days.
			}
			const warnings = await youthWarnings(minor, "2027-03-01", "07:00", "17:00");
			expect(warnings).toEqual(
				expect.arrayContaining(["jarbschg_weekly_max", "jarbschg_days_per_week"]),
			);
		});
	});

	describe("work in progress", () => {
		const evaluateAt = async (who: FixtureEmployee, now: Instant) =>
			jarbschgScheduleContributor.evaluate({
				db,
				organizationId: org.id,
				timezone: org.timezone,
				window: { start: WEEK.startDate, endExclusive: WEEK.endDateExclusive },
				employeeIds: [who.employeeId],
				proposedShifts: [],
				replacesShiftId: null,
				preferences: await loadOrganizationStatutoryPreferences(db, org.id),
				now,
			});

		it("counts today's completed work together with today's later shift", async () => {
			const minor = await fx.employee(org, "today", { birthday: "2011-01-01" });
			await seed.work(org, minor, "2027-03-01", "08:00", 240);
			const afternoon = await shift(minor, "2027-03-01", "13:00", "19:00");
			const findings = await evaluateAt(minor, localInstant("2027-03-01", "12:30", org.timezone));
			expect(findings).toContainEqual(
				expect.objectContaining({ kind: "jarbschg_daily_max", subjectKey: `shift:${afternoon}` }),
			);
		});

		it("keeps an open night clock-in after midnight", async () => {
			const minor = await fx.employee(org, "nightowl", { birthday: "2011-01-01" });
			const night = await shift(minor, "2027-03-01", "22:00", "02:00");
			await seed.openWork(org, minor, "2027-03-01", "22:00");
			const findings = await evaluateAt(minor, localInstant("2027-03-02", "01:00", org.timezone));
			expect(findings).toContainEqual(
				expect.objectContaining({
					kind: "jarbschg_night_work",
					subjectKey: `shift:${night}`,
					summary: expect.objectContaining({ used: { unit: "minutes", value: 240 } }),
				}),
			);
		});
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
